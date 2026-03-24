import type { FastifyRequest, FastifyReply } from 'fastify';
import type { WebSocket } from 'ws';

// =============================================================================
// STT (Speech-to-Text) interfaces
//
// STT is a persistent connection for the duration of one call.
// The SDK calls stt.connect() once when the WebSocket opens, and
// keeps sending audio to it until the call ends.
// =============================================================================

/**
 * A live STT connection for one call.
 * Created by STTProvider.connect() and held open until the call ends.
 */
export interface STTConnection {
  /** Send a raw audio chunk (mulaw 8kHz, as received from Twilio) to the STT engine. */
  sendMedia(buffer: Buffer): void;
  /** Cleanly close the STT connection. Called when the Twilio WebSocket closes. */
  close(): void;
}

/**
 * An STT provider. Implement this interface to add a new STT service.
 *
 * @example
 * class MySTT implements STTProvider {
 *   async connect(onTranscript) {
 *     // open connection, call onTranscript() when speech is recognized
 *     return { sendMedia, close }
 *   }
 * }
 */
export interface STTProvider {
  /**
   * Open a streaming STT connection for one call.
   * @param onTranscript - Called with each finalized transcript chunk.
   *   The SDK accumulates these in a buffer until the caller presses #.
   */
  connect(onTranscript: (text: string) => void): Promise<STTConnection>;
}

// =============================================================================
// TTS (Text-to-Speech) interfaces
//
// TTS creates one stream per LLM response. Each stream receives text chunks
// as the LLM generates them and produces audio chunks via the onAudio callback.
// The SDK forwards those audio chunks to Twilio.
// =============================================================================

/**
 * A single TTS stream for one LLM response.
 * Created by TTSProvider.createStream() once per LLM response.
 */
export interface TTSStream {
  /**
   * Send a text chunk from the LLM. Safe to call before the stream is ready —
   * implementations should queue chunks and flush when ready.
   */
  sendText(chunk: string): void;
  /**
   * Signal end-of-text. The TTS engine will flush any buffered audio.
   * No more sendText() calls should be made after this.
   */
  close(): void;
}

/**
 * A TTS provider. Implement this interface to add a new TTS service.
 *
 * The onAudio callback receives base64-encoded mulaw audio chunks ready
 * for Twilio. The SDK wires this to write audio back to the caller.
 *
 * @example
 * class MyTTS implements TTSProvider {
 *   createStream(onAudio) {
 *     // open connection, call onAudio(base64chunk) for each audio chunk
 *     return { sendText, close }
 *   }
 * }
 */
export interface TTSProvider {
  /**
   * Create a new TTS stream for one LLM response.
   * @param onAudio - Called with each base64-encoded mulaw audio chunk.
   *   The SDK forwards these to Twilio to play to the caller.
   */
  createStream(onAudio: (base64Chunk: string) => void): TTSStream;
}

// =============================================================================
// onMessage — the user's LLM hook
//
// The SDK calls this once per caller utterance (when the caller presses #).
// The user streams their LLM response back via onText/onDone callbacks.
// The LLM itself is never abstracted — the user owns it completely.
// =============================================================================

/**
 * Callbacks passed to onMessage. The user must call these to stream the
 * LLM response back to the caller.
 */
export interface OnMessageCallbacks {
  /** Call with each streamed text chunk from your LLM. */
  onText: (chunk: string) => void;
  /** Call when your LLM has finished generating. Flushes the TTS stream. */
  onDone: () => void;
  /**
   * Call this if your agent needs to collect a keypad number from the caller
   * (e.g. account number, PIN). The SDK will switch into DTMF collection mode:
   * the caller's keypad digits accumulate until they press #, then onMessage
   * is called again with "Caller entered: {digits}" as the transcript.
   */
  switchToDtmfCollection: () => void;
}

/**
 * The user's LLM handler. Receives the caller's transcript and must stream
 * a response back via the provided callbacks.
 *
 * @example — with OpenAI streaming:
 * const onMessage: OnMessageHandler = async (transcript, { onText, onDone }) => {
 *   const stream = openai.chat.completions.stream({ ... })
 *   for await (const chunk of stream) {
 *     onText(chunk.choices[0]?.delta?.content ?? '')
 *   }
 *   onDone()
 * }
 *
 * @example — simple string response (use the simpleResponse() helper instead):
 * const onMessage: OnMessageHandler = async (transcript, { onText, onDone }) => {
 *   onText('Hello!')
 *   onDone()
 * }
 */
export type OnMessageHandler = (
  transcript: string,
  callbacks: OnMessageCallbacks
) => void | Promise<void>;

// =============================================================================
// VoiceAgent configuration
// =============================================================================

export interface VoiceAgentConfig {
  /** STT provider. Built-in: DeepgramSTT. */
  stt: STTProvider;
  /** TTS provider. Built-in: ElevenLabsTTS. */
  tts: TTSProvider;
  /**
   * The public hostname of your server (e.g. "abc123.ngrok.io" or "myapp.railway.app").
   * Used to build the wss:// URL in the TwiML response that Twilio connects to.
   * The SDK never reads process.env — pass this in explicitly.
   */
  host: string;
  /**
   * Path for the WebSocket media stream route.
   * Must match the route you register on your server.
   * Defaults to "/media-stream".
   */
  mediaStreamPath?: string;
  /**
   * Optional text to speak immediately when a call connects, before the
   * caller says anything. Uses your configured TTS provider.
   */
  greeting?: string;
  /**
   * Your LLM handler. Called when the caller submits a transcript (presses #).
   * Stream your response back via the provided callbacks.
   */
  onMessage: OnMessageHandler;
}

// =============================================================================
// Internal per-call state (not exported — SDK internal use only)
// =============================================================================

/** @internal */
export interface CallState {
  streamSid: string;
  transcriptBuffer: string;
  isCollectingDtmf: boolean;
  dtmfBuffer: string;
  sttConnection: STTConnection | null;
}

// Re-export Fastify/ws types used by VoiceAgent's public method signatures
export type { FastifyRequest, FastifyReply, WebSocket };
