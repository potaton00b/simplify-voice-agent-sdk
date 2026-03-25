// =============================================================================
// voice-agent-sdk — public API
// =============================================================================

// Core class
export { VoiceAgent, simpleResponse } from './VoiceAgent.js';

// Built-in adapters
export { DeepgramSTT } from './adapters/DeepgramSTT.js';
export { OpenAISTT } from './adapters/OpenAISTT.js';
export { CartesiaSTT } from './adapters/CartesiaSTT.js';
export { ElevenLabsTTS } from './adapters/ElevenLabsTTS.js';

// Types — everything needed to implement a custom adapter or extend the SDK
export type {
  STTProvider,
  STTConnection,
  TTSProvider,
  TTSStream,
  VoiceAgentConfig,
  OnMessageHandler,
  OnMessageCallbacks,
} from './types.js';

// Adapter config types
export type { DeepgramSTTConfig } from './adapters/DeepgramSTT.js';
export type { OpenAISTTConfig } from './adapters/OpenAISTT.js';
export type { CartesiaSTTConfig } from './adapters/CartesiaSTT.js';
export type { ElevenLabsTTSConfig } from './adapters/ElevenLabsTTS.js';
