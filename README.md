# voice-agent-sdk

Lightweight TypeScript SDK for building Twilio voice agents with swappable STT and TTS providers. **You bring the LLM.**

---

## How it works

```
Caller speaks → Twilio (mulaw audio) → voice-agent-sdk
                                              │
                                    ┌─────────┴──────────┐
                                    ▼                     ▼
                              STT Provider          TTS Provider
                           (Deepgram / OpenAI    (ElevenLabs / Cartesia
                             / Cartesia)           / Deepgram)
                                    │                     ▲
                                    ▼                     │
                             transcript buffer      audio chunks
                                    │                     │
                              caller presses #            │
                                    │                     │
                                    ▼                     │
                             your onMessage()  ───────────┘
                            (any LLM you want)
```

```
Caller speaks
    │
    ▼
Twilio WebSocket ──► STT streams transcript into buffer
                                     │
                           caller presses # (DTMF)
                                     │
                                     ▼
                           your onMessage(transcript, { onText, onDone })
                                     │
                           stream LLM tokens via onText()
                                     │
                                     ▼
                           TTS streams audio ──► Twilio ──► caller hears response
```

---

## Features

- **Swappable STT and TTS** — Deepgram, OpenAI, Cartesia, ElevenLabs out of the box. Swap with one line.
- **Bring your own LLM** — you get a transcript and stream text back. OpenAI, Claude, Gemini, LangChain, any agent SDK.
- **DTMF `#` turn detection** — caller presses `#` to submit. No VAD timing complexity.
- **Streaming end-to-end** — STT streams as the caller speaks, your LLM streams tokens, TTS streams audio back.
- **Two route handlers, zero boilerplate** — `handleIncomingCall()` and `handleMediaStream()`.

---

## Quick Start

```bash
npm install voice-agent-sdk
npm install fastify @fastify/websocket @fastify/formbody ws
```

```typescript
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import { VoiceAgent, DeepgramSTT, ElevenLabsTTS, simpleResponse } from 'voice-agent-sdk';

const agent = new VoiceAgent({
  host: process.env.NGROK_URL!,           // your tunnel hostname, no protocol
  stt: new DeepgramSTT({ apiKey: process.env.DEEPGRAM_API_KEY! }),
  tts: new ElevenLabsTTS({
    apiKey: process.env.ELEVENLABS_API_KEY!,
    voiceId: process.env.ELEVENLABS_VOICE_ID!,
  }),
  greeting: "Hello! Speak your message, then press pound to send.",
  onMessage: simpleResponse(async (transcript) => {
    return `You said: ${transcript}`;
  }),
});

const server = Fastify();
server.register(fastifyWebsocket);
server.register(fastifyFormbody);

server.post('/incoming-call', agent.handleIncomingCall());

// WebSocket route must be inside a register block
server.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, agent.handleMediaStream());
});

await server.listen({ port: 3000, host: '0.0.0.0' });
```

---

## Streaming LLM Example

For real agents, stream tokens from your LLM instead of returning a string:

```typescript
import OpenAI from 'openai';
import type { OnMessageHandler } from 'voice-agent-sdk';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const myAgent: OnMessageHandler = async (transcript, { onText, onDone }) => {
  const stream = openai.chat.completions.stream({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a helpful voice assistant. Keep responses concise and conversational.',
      },
      { role: 'user', content: transcript },
    ],
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? '';
    if (text) onText(text);
  }

  onDone();
};
```

Any LLM works — Claude, Gemini, local models, the OpenAI Agents SDK, LangChain, etc.

---

## Swapping Providers

Only the `stt:` or `tts:` line changes:

```typescript
// Deepgram STT (default, lowest latency)
stt: new DeepgramSTT({ apiKey: process.env.DEEPGRAM_API_KEY! })

// OpenAI STT (gpt-4o-transcribe)
stt: new OpenAISTT({ apiKey: process.env.OPENAI_API_KEY! })

// Cartesia STT (ink-whisper)
stt: new CartesiaSTT({ apiKey: process.env.CARTESIA_API_KEY! })
```

```typescript
// ElevenLabs TTS
tts: new ElevenLabsTTS({ apiKey: '...', voiceId: '...' })

// Cartesia TTS
tts: new CartesiaTTS({ apiKey: '...', voiceId: '...' })

// Deepgram TTS
tts: new DeepgramTTS({ apiKey: '...' })
```

---

## Providers

### STT

| Provider | Class | Config | Default Model |
|----------|-------|--------|---------------|
| Deepgram | `DeepgramSTT` | `{ apiKey, model? }` | `nova-3` |
| OpenAI | `OpenAISTT` | `{ apiKey, model?, language? }` | `gpt-4o-transcribe` |
| Cartesia | `CartesiaSTT` | `{ apiKey, model?, language? }` | `ink-whisper` |

OpenAISTT automatically converts Twilio's mulaw 8kHz audio to PCM16 24kHz — no setup needed.

### TTS

| Provider | Class | Config | Default Model |
|----------|-------|--------|---------------|
| ElevenLabs | `ElevenLabsTTS` | `{ apiKey, voiceId, modelId?, outputFormat? }` | `eleven_turbo_v2_5` |
| Cartesia | `CartesiaTTS` | `{ apiKey, voiceId, modelId?, language? }` | `sonic-2` |
| Deepgram | `DeepgramTTS` | `{ apiKey, model? }` | `aura-2-thalia-en` |

---

## Custom Adapters

Implement `STTProvider` or `TTSProvider` to plug in any service:

```typescript
import type { STTProvider, STTConnection } from 'voice-agent-sdk';

class MySTT implements STTProvider {
  async connect(onTranscript: (text: string) => void): Promise<STTConnection> {
    // open a streaming connection to your STT service
    // call onTranscript(text) for each finalized transcript chunk
    return {
      sendMedia(buffer: Buffer) { /* forward mulaw 8kHz audio */ },
      close()               { /* clean up */ },
    };
  }
}
```

```typescript
import type { TTSProvider, TTSStream } from 'voice-agent-sdk';

class MyTTS implements TTSProvider {
  createStream(onAudio: (base64Chunk: string) => void): TTSStream {
    // open a streaming connection to your TTS service
    // call onAudio(base64) for each mulaw 8kHz audio chunk
    return {
      sendText(chunk: string) { /* send text to TTS */ },
      close()                 { /* signal end of text */ },
    };
  }
}
```

> **Audio format:** Twilio uses mulaw 8kHz. Your adapter receives and must produce this format. Handle any conversion internally (see `OpenAISTT` for a reference implementation that converts to PCM16 24kHz).

---

## DTMF Behavior

Turn detection is driven by the caller pressing `#` on their keypad — no VAD required.

### Normal Mode

The caller speaks and STT transcribes in real time into a buffer. Pressing `#` submits the buffer to `onMessage`. Other digit keys are ignored.

```
caller speaks → transcript accumulates in buffer
     │
caller presses #
     │
     └──► onMessage(transcript, callbacks)
```

### Collection Mode

Call `switchToDtmfCollection()` from inside `onMessage` to collect a keypad number (e.g. account number, PIN). In this mode digit keys accumulate and `#` submits them.

```typescript
onMessage: async (transcript, { onText, onDone, switchToDtmfCollection }) => {
  onText("Please enter your account number, then press pound.");
  onDone();
  switchToDtmfCollection(); // next # submits "Caller entered: 1234"
}
```

```
Normal Mode ──── # ───────────────► onMessage(transcript)
     │                                      │
     │                         switchToDtmfCollection()
     │                                      │
     │                                      ▼
     │                             Collection Mode
     │                          digits 0-9 accumulate
     │                                      │
     │                          # + digits ─┤
     │                                      ▼
     └──────────────────────────── onMessage("Caller entered: 1234")
                                   (back to Normal Mode)
```

### Slow STT / Pressing `#` early

If `#` is pressed before the transcript has arrived (common with OpenAI STT), the SDK queues the flush and fires `onMessage` automatically when the transcript comes in — no second press needed.

---

## API Reference

### `new VoiceAgent(config)`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stt` | `STTProvider` | ✓ | Speech-to-text provider |
| `tts` | `TTSProvider` | ✓ | Text-to-speech provider |
| `host` | `string` | ✓ | Public hostname (e.g. `abc.ngrok.io`). No protocol, no trailing slash. |
| `onMessage` | `OnMessageHandler` | ✓ | Your LLM handler |
| `mediaStreamPath` | `string` | | WebSocket path. Default: `"/media-stream"` |
| `greeting` | `string` | | Text spoken when the call connects |

**Methods:**

- **`agent.handleIncomingCall()`** — Returns a Fastify handler for `POST /incoming-call`. Responds with TwiML telling Twilio to open a WebSocket to `wss://{host}{mediaStreamPath}`.
- **`agent.handleMediaStream()`** — Returns a Fastify WebSocket handler. Contains the full per-call pipeline.

### `simpleResponse(fn)`

Wraps a `(transcript) => Promise<string>` function into the streaming `OnMessageHandler` shape. Useful for simple bots or testing.

```typescript
onMessage: simpleResponse(async (transcript) => {
  return 'You said: ' + transcript;
})
```

### `OnMessageHandler`

```typescript
type OnMessageHandler = (
  transcript: string,
  callbacks: {
    onText: (chunk: string) => void;       // call per streaming LLM token
    onDone: () => void;                    // call when LLM finishes
    switchToDtmfCollection: () => void;    // enter digit-collection mode
  }
) => void | Promise<void>;
```

---

## Running the Example

```bash
cd examples/basic-agent
npm install
cp .env.example .env
# Fill in your API keys in .env
npm run dev
```

In a separate terminal:
```bash
ngrok http 3000
```

In your [Twilio console](https://console.twilio.com), set your phone number's **A call comes in** webhook to:
```
https://<your-ngrok-url>/incoming-call
```

Call your Twilio number and speak. Press `#` to submit.

---

## Development

```bash
npm run build       # tsup — builds ESM + CJS + .d.ts to dist/
npm run dev         # watch mode build
npm run typecheck   # tsc --noEmit
```

---

## License

MIT
