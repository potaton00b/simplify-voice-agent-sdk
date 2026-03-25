# Custom Adapters

Implement `STTProvider` or `TTSProvider` to plug in any speech service not built into the SDK.

## STT Adapter

An STT adapter opens a persistent streaming connection for the duration of one call. The SDK calls `connect()` once when the call starts, forwards audio via `sendMedia()`, and closes via `close()` when the call ends.

```typescript
import type { STTProvider, STTConnection } from 'voice-agent-sdk';

export class MySTT implements STTProvider {
  constructor(private apiKey: string) {}

  async connect(onTranscript: (text: string) => void): Promise<STTConnection> {
    // Open a streaming connection to your STT service.
    // Call onTranscript(text) each time a finalized transcript chunk is ready.
    // The SDK accumulates these in a buffer until the caller presses #.

    const connection = await openMySTTConnection(this.apiKey, {
      onFinal: (text) => onTranscript(text),
    });

    return {
      sendMedia(buffer: Buffer): void {
        // buffer is raw mulaw 8kHz mono audio from Twilio.
        // Convert if your service requires a different format.
        connection.sendAudio(buffer);
      },
      close(): void {
        connection.disconnect();
      },
    };
  }
}
```

### Interfaces

```typescript
interface STTProvider {
  connect(onTranscript: (text: string) => void): Promise<STTConnection>;
}

interface STTConnection {
  sendMedia(buffer: Buffer): void;
  close(): void;
}
```

---

## TTS Adapter

A TTS adapter creates one stream per LLM response. The SDK calls `createStream()` once per turn, passes text chunks via `sendText()` as the LLM generates them, and calls `close()` when the LLM finishes.

```typescript
import type { TTSProvider, TTSStream } from 'voice-agent-sdk';

export class MyTTS implements TTSProvider {
  constructor(private apiKey: string) {}

  createStream(onAudio: (base64Chunk: string) => void): TTSStream {
    // Open a streaming TTS connection.
    // Call onAudio(base64) for each mulaw 8kHz audio chunk you receive.
    // The SDK forwards these chunks to Twilio to play to the caller.

    const ws = openMyTTSWebSocket(this.apiKey, {
      onAudioChunk: (rawBuffer) => {
        // Convert raw bytes to base64
        onAudio(rawBuffer.toString('base64'));
      },
    });

    const textQueue: string[] = [];
    let isReady = false;

    ws.on('open', () => {
      isReady = true;
      for (const chunk of textQueue) ws.sendText(chunk);
      textQueue.length = 0;
    });

    return {
      sendText(chunk: string): void {
        if (isReady) ws.sendText(chunk);
        else textQueue.push(chunk);  // queue until socket opens
      },
      close(): void {
        ws.sendEOS();  // signal end of text to your TTS service
      },
    };
  }
}
```

### Interfaces

```typescript
interface TTSProvider {
  createStream(onAudio: (base64Chunk: string) => void): TTSStream;
}

interface TTSStream {
  sendText(chunk: string): void;
  close(): void;
}
```

---

## Audio Format

Twilio uses **mulaw 8kHz mono** audio throughout:

- **STT adapters receive** mulaw 8kHz buffers in `sendMedia()`. If your service requires a different format, convert internally.
- **TTS adapters must produce** base64-encoded mulaw 8kHz audio in the `onAudio()` callback.

See `src/adapters/OpenAISTT.ts` for a reference implementation that converts mulaw 8kHz → PCM16 24kHz inline (no extra dependencies).

---

## Tips

- **Queue text chunks** that arrive before your WebSocket opens — the LLM may start streaming before the TTS connection is established. See all built-in TTS adapters for the pattern.
- **Handle `close()` before open** — if `close()` is called before the WebSocket opens, set a `pendingClose` flag and send the EOS message in the `open` handler.
- **Don't hold a reference to the Twilio socket** — TTS adapters communicate exclusively via the `onAudio` callback. The SDK wires that to Twilio.
