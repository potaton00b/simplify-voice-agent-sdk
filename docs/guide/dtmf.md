# DTMF Behavior

Turn detection is driven by the caller pressing `#` on their keypad — no voice activity detection (VAD) required.

## Normal Mode

The caller speaks. STT transcribes in real time and the SDK accumulates the text in a buffer. When the caller presses `#`, the buffer is submitted to your `onMessage` handler. Other digit keys (`0–9`, `*`) are ignored in normal mode.

```
caller speaks ──► STT transcribes ──► buffer grows
                                           │
                                  caller presses #
                                           │
                                           ▼
                               onMessage(transcript, callbacks)
```

## Collection Mode

Call `switchToDtmfCollection()` from inside `onMessage` to switch into digit-collection mode. This is useful for collecting account numbers, PINs, or menu selections.

In collection mode:
- Digit keys (`0–9`) accumulate in a separate buffer
- `*` is also accumulated
- Pressing `#` submits the collected digits and returns to normal mode

```typescript
const myAgent: OnMessageHandler = async (transcript, { onText, onDone, switchToDtmfCollection }) => {
  if (transcript.toLowerCase().includes('account')) {
    onText("Please enter your account number, then press pound.");
    onDone();
    switchToDtmfCollection();
    // next # will call onMessage with "Caller entered: 123456"
    return;
  }

  // ... handle other transcripts
};
```

When the caller presses `#` after entering digits, `onMessage` is called with:
```
"Caller entered: 123456"
```

## State Machine

```
Normal Mode ──── # (with text) ──────────────► onMessage(transcript)
     │                                                  │
     │                                   switchToDtmfCollection()
     │                                                  │
     │                                                  ▼
     │                                        Collection Mode
     │                                     0-9 / * accumulate
     │                                                  │
     │                              # (with digits) ────┤
     │                                                  ▼
     └──────────────────────────── onMessage("Caller entered: 1234")
                                     (returns to Normal Mode)
```

**Edge cases:**
- `#` pressed in normal mode with an empty buffer → ignored (or see below)
- `#` pressed in collection mode with no digits → stays in collection mode, waits for digits

## Pressing `#` Before the Transcript Arrives

Some STT providers (notably OpenAI) have higher transcription latency. If the caller presses `#` before the transcript has arrived, the SDK queues the flush and fires `onMessage` automatically as soon as the transcript comes in — **no second press needed**.

```
caller speaks → presses # quickly → transcript arrives 500ms later
                     │                         │
                 pendingFlush = true     auto-flushes → onMessage(transcript)
```

This is handled transparently. You don't need to do anything differently in your `onMessage` handler.
