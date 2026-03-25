---
layout: home

hero:
  name: voice-agent-sdk
  text: Build Twilio voice agents in TypeScript
  tagline: Swappable STT and TTS providers. You bring the LLM.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/potaton00b/simplify-voice-agent-sdk

features:
  - icon: 🔌
    title: Swappable Providers
    details: Deepgram, OpenAI, and Cartesia for STT. ElevenLabs, Cartesia, and Deepgram for TTS. Switch with one line.
  - icon: 🧠
    title: Bring Your Own LLM
    details: The SDK handles audio plumbing. You get a transcript and stream text back. Any LLM, any agent SDK.
  - icon: "#️⃣"
    title: DTMF Turn Detection
    details: Caller presses # to submit. No VAD timing complexity. Also supports digit collection mode for account numbers and PINs.
  - icon: ⚡
    title: Streaming End-to-End
    details: STT streams as the caller speaks, your LLM streams tokens, TTS streams audio back. Low-latency by default.
---
