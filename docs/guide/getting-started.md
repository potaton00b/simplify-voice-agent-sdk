# Getting Started

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
                                    ▼                     │
                             your onMessage()  ───────────┘
                            (any LLM you want)
```

The SDK owns the Twilio WebSocket and the audio pipeline. You own the LLM logic.

## Installation

```bash
npm install voice-agent-sdk
npm install fastify @fastify/websocket @fastify/formbody ws
```

## Quick Start

A complete voice agent in ~30 lines:

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

const server = Fastify({ logger: true });
server.register(fastifyWebsocket);
server.register(fastifyFormbody);

server.post('/incoming-call', agent.handleIncomingCall());

// WebSocket route must be inside a register block
server.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, agent.handleMediaStream());
});

await server.listen({ port: 3000, host: '0.0.0.0' });
```

::: tip WebSocket route registration
The `/media-stream` route **must** be registered inside `server.register(async (fastify) => { ... })`. This ensures `@fastify/websocket`'s `onRoute` hook has run before the route is processed.
:::

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
        content:
          'You are a helpful voice assistant on a phone call. ' +
          'Keep responses concise and conversational — no markdown, no bullet points.',
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

Any LLM works — Claude, Gemini, local models, the OpenAI Agents SDK, LangChain, etc. The `onText` / `onDone` callback shape is all the SDK needs.

## Environment Variables

```bash
NGROK_URL=your-ngrok-subdomain.ngrok-free.app  # no https://, no trailing slash
DEEPGRAM_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
OPENAI_API_KEY=...
CARTESIA_API_KEY=...
PORT=3000
```

## Running Locally

1. Copy `.env.example` to `.env` in `examples/basic-agent/` and fill in your keys
2. `cd examples/basic-agent && npm install && npm run dev`
3. In a separate terminal: `ngrok http 3000`
4. In your [Twilio console](https://console.twilio.com), set your number's **A call comes in** webhook to `https://<ngrok-url>/incoming-call`
5. Call your Twilio number — speak, then press `#`
