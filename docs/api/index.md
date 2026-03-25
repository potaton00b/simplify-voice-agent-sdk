# API Reference

## VoiceAgent

The main entry point. Create one instance and register its two route handlers on your Fastify server.

### Constructor

```typescript
new VoiceAgent(config: VoiceAgentConfig)
```

#### `VoiceAgentConfig`

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `stt` | `STTProvider` | ✓ | Speech-to-text provider |
| `tts` | `TTSProvider` | ✓ | Text-to-speech provider |
| `host` | `string` | ✓ | Public hostname of your server (e.g. `abc.ngrok-free.app`). No `https://`, no trailing slash. Used to build the `wss://` URL in the TwiML response. |
| `onMessage` | `OnMessageHandler` | ✓ | Your LLM handler. Called when the caller presses `#`. |
| `mediaStreamPath` | `string` | | WebSocket route path. Must match the route registered on your server. Default: `"/media-stream"` |
| `greeting` | `string` | | Text spoken immediately when the call connects, before the caller says anything. |

### Methods

#### `agent.handleIncomingCall()`

Returns a Fastify route handler for `POST /incoming-call`.

When Twilio calls this endpoint (someone dialled your number), it replies with TwiML XML instructing Twilio to open a WebSocket media stream to `wss://{host}{mediaStreamPath}`.

```typescript
server.post('/incoming-call', agent.handleIncomingCall());
```

#### `agent.handleMediaStream()`

Returns a Fastify WebSocket handler. This is where the full per-call pipeline runs.

Must be registered inside a `server.register()` block:

```typescript
server.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, agent.handleMediaStream());
});
```

Each call gets isolated state — concurrent calls never share data.

---

## simpleResponse

Convenience helper that wraps a `(transcript) => Promise<string>` function into the `OnMessageHandler` shape. Useful for simple bots and testing.

```typescript
function simpleResponse(
  fn: (transcript: string) => Promise<string>
): OnMessageHandler
```

**Example:**

```typescript
onMessage: simpleResponse(async (transcript) => {
  return `You said: ${transcript}`;
})
```

---

## OnMessageHandler

The type for your LLM handler.

```typescript
type OnMessageHandler = (
  transcript: string,
  callbacks: OnMessageCallbacks
) => void | Promise<void>;
```

### `OnMessageCallbacks`

| Callback | Description |
|----------|-------------|
| `onText(chunk: string)` | Call with each streaming token from your LLM. The SDK forwards each chunk to TTS. |
| `onDone()` | Call when your LLM has finished generating. Flushes the TTS stream. |
| `switchToDtmfCollection()` | Switch into digit-collection mode. The next `#` press will call `onMessage` with `"Caller entered: {digits}"`. See [DTMF Behavior](/guide/dtmf). |

---

## STTProvider / STTConnection

Implement these to add a custom STT service.

```typescript
interface STTProvider {
  connect(onTranscript: (text: string) => void): Promise<STTConnection>;
}

interface STTConnection {
  sendMedia(buffer: Buffer): void;
  close(): void;
}
```

See [Custom Adapters](/guide/custom-adapters) for a full example.

---

## TTSProvider / TTSStream

Implement these to add a custom TTS service.

```typescript
interface TTSProvider {
  createStream(onAudio: (base64Chunk: string) => void): TTSStream;
}

interface TTSStream {
  sendText(chunk: string): void;
  close(): void;
}
```

See [Custom Adapters](/guide/custom-adapters) for a full example.

---

## Adapter Config Types

All adapter config types are exported for use in TypeScript projects:

```typescript
import type {
  DeepgramSTTConfig,
  OpenAISTTConfig,
  CartesiaSTTConfig,
  ElevenLabsTTSConfig,
  CartesiaTTSConfig,
  DeepgramTTSConfig,
} from 'voice-agent-sdk';
```

See the [Providers](/guide/providers) page for the fields of each config type.
