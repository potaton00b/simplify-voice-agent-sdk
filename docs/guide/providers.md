# Providers

## Swapping Providers

Only the `stt:` or `tts:` line in your `VoiceAgent` config changes:

```typescript
// STT options — pick one
stt: new DeepgramSTT({ apiKey: process.env.DEEPGRAM_API_KEY! })
stt: new OpenAISTT({ apiKey: process.env.OPENAI_API_KEY! })
stt: new CartesiaSTT({ apiKey: process.env.CARTESIA_API_KEY! })

// TTS options — pick one
tts: new ElevenLabsTTS({ apiKey: '...', voiceId: '...' })
tts: new CartesiaTTS({ apiKey: '...', voiceId: '...' })
tts: new DeepgramTTS({ apiKey: '...' })
```

---

## STT Providers

### DeepgramSTT

Uses the [Deepgram](https://deepgram.com) streaming API. The only provider that requires `@deepgram/sdk` (included as a direct dependency — no extra install needed).

```typescript
import { DeepgramSTT } from 'voice-agent-sdk';

new DeepgramSTT({
  apiKey: 'your-deepgram-api-key',
  model: 'nova-3',   // optional, default: 'nova-3'
})
```

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | required | Deepgram API key |
| `model` | `string` | `'nova-3'` | Transcription model |

Get an API key at [console.deepgram.com](https://console.deepgram.com).

---

### OpenAISTT

Uses the [OpenAI Realtime Transcription API](https://platform.openai.com/docs/guides/realtime-transcription) (`gpt-4o-transcribe`). Includes built-in audio conversion: Twilio's mulaw 8kHz is automatically converted to PCM16 24kHz as required by OpenAI.

```typescript
import { OpenAISTT } from 'voice-agent-sdk';

new OpenAISTT({
  apiKey: 'your-openai-api-key',
  model: 'gpt-4o-transcribe',   // optional
  language: 'en',               // optional, omit for auto-detection
})
```

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | required | OpenAI API key |
| `model` | `string` | `'gpt-4o-transcribe'` | Transcription model |
| `language` | `string` | auto-detect | ISO-639-1 language code (e.g. `'en'`, `'fr'`). Omit for auto-detection. |

::: tip Latency note
OpenAI STT has slightly higher latency than Deepgram. The SDK handles the case where `#` is pressed before the transcript arrives — it queues the flush and fires `onMessage` automatically.
:::

---

### CartesiaSTT

Uses the [Cartesia Ink](https://cartesia.ai) streaming WebSocket API. Accepts mulaw 8kHz directly — no audio conversion needed.

```typescript
import { CartesiaSTT } from 'voice-agent-sdk';

new CartesiaSTT({
  apiKey: 'your-cartesia-api-key',
  model: 'ink-whisper',   // optional
  language: 'en',         // optional
})
```

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | required | Cartesia API key |
| `model` | `string` | `'ink-whisper'` | Transcription model |
| `language` | `string` | `'en'` | ISO-639-1 language code |

Get an API key at [play.cartesia.ai/keys](https://play.cartesia.ai/keys).

---

## TTS Providers

### ElevenLabsTTS

Uses the [ElevenLabs](https://elevenlabs.io) streaming WebSocket API. Implemented as a raw WebSocket (no `elevenlabs` npm package required).

```typescript
import { ElevenLabsTTS } from 'voice-agent-sdk';

new ElevenLabsTTS({
  apiKey: 'your-elevenlabs-api-key',
  voiceId: 'your-voice-id',
  modelId: 'eleven_turbo_v2_5',   // optional
  outputFormat: 'ulaw_8000',       // optional
})
```

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | required | ElevenLabs API key |
| `voiceId` | `string` | required | Voice ID from ElevenLabs voice library |
| `modelId` | `string` | `'eleven_turbo_v2_5'` | TTS model |
| `outputFormat` | `string` | `'ulaw_8000'` | Audio output format |

Find voice IDs at [elevenlabs.io/app/voice-library](https://elevenlabs.io/app/voice-library).

---

### CartesiaTTS

Uses the [Cartesia Sonic](https://cartesia.ai) streaming WebSocket API. Each LLM response gets a unique `context_id` for in-order audio delivery.

```typescript
import { CartesiaTTS } from 'voice-agent-sdk';

new CartesiaTTS({
  apiKey: 'your-cartesia-api-key',
  voiceId: 'your-voice-id',
  modelId: 'sonic-2',   // optional
  language: 'en',       // optional
})
```

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | required | Cartesia API key |
| `voiceId` | `string` | required | Voice ID from Cartesia |
| `modelId` | `string` | `'sonic-2'` | TTS model |
| `language` | `string` | `'en'` | ISO-639-1 language code |

---

### DeepgramTTS

Uses the [Deepgram Aura](https://deepgram.com/product/text-to-speech) streaming WebSocket API. Deepgram sends raw binary audio frames — the adapter converts them to base64 automatically.

```typescript
import { DeepgramTTS } from 'voice-agent-sdk';

new DeepgramTTS({
  apiKey: 'your-deepgram-api-key',
  model: 'aura-2-thalia-en',   // optional
})
```

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | required | Deepgram API key |
| `model` | `string` | `'aura-2-thalia-en'` | Aura voice model |

Browse available Aura voice models in the [Deepgram docs](https://developers.deepgram.com/docs/tts-models).
