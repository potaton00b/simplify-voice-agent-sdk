import type { FastifyRequest, FastifyReply } from 'fastify';
import type { WebSocket } from 'ws';
import type {
  VoiceAgentConfig,
  CallState,
  OnMessageHandler,
  TTSProvider,
} from './types.js';
import { buildTwiML, sendAudioToTwilio } from './internal/twilioMessages.js';

// =============================================================================
// VoiceAgent — the core SDK class
//
// Wires Twilio + STT + TTS + your LLM into a voice agent pipeline.
// The user instantiates this once and registers its route handlers on
// their Fastify server.
//
// PIPELINE (per call):
//   Twilio audio → STT → transcript buffer → [caller presses #] →
//   onMessage() → LLM response chunks → TTS → audio back to Twilio
//
// DTMF STATE MACHINE:
//   Normal mode:     any digit ignored; # submits transcript to LLM
//   Collection mode: digits accumulate; # submits digits as "account number"
//                    (triggered by calling switchToDtmfCollection() in onMessage)
// =============================================================================

export class VoiceAgent {
  private config: Required<Pick<VoiceAgentConfig, 'mediaStreamPath'>> & VoiceAgentConfig;

  constructor(config: VoiceAgentConfig) {
    this.config = {
      mediaStreamPath: '/media-stream',
      ...config,
    };
  }

  // ---------------------------------------------------------------------------
  // handleIncomingCall()
  //
  // Returns a Fastify route handler for POST /incoming-call.
  // Twilio calls this URL when someone dials your number. We respond with
  // TwiML XML that tells Twilio to open a WebSocket media stream to our server.
  // ---------------------------------------------------------------------------
  handleIncomingCall() {
    const { host, mediaStreamPath } = this.config;
    return async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.type('text/xml').send(buildTwiML(host, mediaStreamPath));
    };
  }

  // ---------------------------------------------------------------------------
  // handleMediaStream()
  //
  // Returns a Fastify WebSocket handler for GET /media-stream.
  // This is where the entire call pipeline lives. Called once per incoming call.
  // All state is local to this function — concurrent calls never share state.
  // ---------------------------------------------------------------------------
  handleMediaStream() {
    const { stt, tts, greeting, onMessage } = this.config;

    return async (socket: WebSocket, _request: FastifyRequest) => {
      console.log('[VoiceAgent] Call connected');

      // Per-call state — created fresh for every call
      const state: CallState = {
        streamSid: '',
        transcriptBuffer: '',
        isCollectingDtmf: false,
        dtmfBuffer: '',
        sttConnection: null,
      };

      // -----------------------------------------------------------------------
      // runLlm — orchestrates one LLM turn
      //
      // 1. Opens a TTS stream (wired to write audio back to Twilio)
      // 2. Calls the user's onMessage with the transcript + callbacks
      // 3. User calls onText(chunk) per LLM token → each chunk goes to TTS
      // 4. User calls onDone() → TTS stream is closed, audio flushes to caller
      // -----------------------------------------------------------------------
      function runLlm(userMessage: string) {
        const ttsStream = tts.createStream((base64Chunk) => {
          sendAudioToTwilio(socket, state.streamSid, base64Chunk);
        });

        Promise.resolve(
          onMessage(userMessage, {
            onText: (chunk) => ttsStream.sendText(chunk),
            onDone: () => ttsStream.close(),
            switchToDtmfCollection: () => {
              console.log('[VoiceAgent] Switching to DTMF collection mode');
              state.isCollectingDtmf = true;
              state.dtmfBuffer = '';
              state.transcriptBuffer = ''; // discard pending speech
            },
          })
        ).catch((err: unknown) => {
          console.error('[VoiceAgent] onMessage error:', err);
          ttsStream.close();
        });
      }

      // -----------------------------------------------------------------------
      // Twilio message handler — registered BEFORE the STT await
      //
      // IMPORTANT: We register this handler synchronously before awaiting
      // stt.connect(). If we awaited first, Twilio messages that arrive
      // during connection setup would be lost. This matches the pattern
      // in the reference implementation.
      // -----------------------------------------------------------------------
      socket.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;

        // start: first message Twilio sends — gives us the streamSid we need
        // to include in every outbound audio message
        if (msg['event'] === 'start') {
          const start = msg['start'] as { streamSid: string };
          state.streamSid = start.streamSid;
          console.log('[VoiceAgent] Stream started:', state.streamSid);
        }

        // media: raw audio chunk from the caller
        // Forward to STT unless we're in DTMF collection mode (no point
        // transcribing audio while the caller is typing a number)
        if (msg['event'] === 'media') {
          if (!state.sttConnection) return;
          if (!state.isCollectingDtmf) {
            const media = msg['media'] as { payload: string };
            const audioBuffer = Buffer.from(media.payload, 'base64');
            state.sttConnection.sendMedia(audioBuffer);
          }
        }

        // dtmf: caller pressed a key on the phone keypad
        if (msg['event'] === 'dtmf') {
          const dtmf = msg['dtmf'] as { digit: string };
          handleDtmf(dtmf.digit, state, runLlm);
        }
      });

      // -----------------------------------------------------------------------
      // STT connection — awaited AFTER the message handler is registered
      // -----------------------------------------------------------------------
      state.sttConnection = await stt.connect((transcript) => {
        if (!state.isCollectingDtmf) {
          state.transcriptBuffer += ' ' + transcript;
          console.log('[VoiceAgent] Buffer:', state.transcriptBuffer.trim());
        }
      });

      // -----------------------------------------------------------------------
      // Greeting — spoken immediately after STT is ready
      // -----------------------------------------------------------------------
      if (greeting && state.streamSid) {
        const greetingStream = tts.createStream((base64Chunk) => {
          sendAudioToTwilio(socket, state.streamSid, base64Chunk);
        });
        greetingStream.sendText(greeting);
        greetingStream.close();
      }

      // -----------------------------------------------------------------------
      // Close handler
      // -----------------------------------------------------------------------
      socket.on('close', () => {
        console.log('[VoiceAgent] Call ended');
        state.sttConnection?.close();
      });
    };
  }
}

// =============================================================================
// DTMF state machine — extracted for testability
//
// Normal mode:
//   - Any digit other than # is ignored
//   - # submits the accumulated transcript to the LLM (if non-empty)
//
// Collection mode (entered by calling switchToDtmfCollection in onMessage):
//   - Digits 0-9 and * accumulate in dtmfBuffer
//   - # submits the collected digits to the LLM as "Caller entered: {digits}"
//   - Empty digit buffer on # → stay in collection mode, wait for digits
// =============================================================================

function handleDtmf(
  digit: string,
  state: CallState,
  runLlm: (msg: string) => void
): void {
  console.log('[VoiceAgent] DTMF digit:', digit);

  if (state.isCollectingDtmf) {
    if (digit === '#') {
      const digits = state.dtmfBuffer.trim();
      state.dtmfBuffer = '';

      if (!digits) {
        // No digits entered yet — stay in collection mode
        console.log('[VoiceAgent] # pressed but no digits — staying in collection mode');
        return;
      }

      state.isCollectingDtmf = false;
      console.log('[VoiceAgent] Digits collected:', digits);
      runLlm(`Caller entered: ${digits}`);
    } else {
      state.dtmfBuffer += digit;
      console.log('[VoiceAgent] Digit buffer:', state.dtmfBuffer);
    }
  } else {
    if (digit === '#') {
      const utterance = state.transcriptBuffer.trim();
      state.transcriptBuffer = '';

      if (!utterance) {
        console.log('[VoiceAgent] # pressed but buffer was empty — ignoring');
        return;
      }

      console.log('[VoiceAgent] Sending to LLM:', utterance);
      runLlm(utterance);
    }
    // Any other digit in normal mode is ignored
  }
}

// =============================================================================
// simpleResponse — convenience helper for non-streaming LLM responses
//
// Wraps a plain async function that returns a string into the OnMessageHandler
// shape. Useful for simple bots or testing.
//
// @example
// onMessage: simpleResponse(async (transcript) => {
//   return 'You said: ' + transcript
// })
// =============================================================================

export function simpleResponse(
  fn: (transcript: string) => Promise<string>
): OnMessageHandler {
  return async (transcript, { onText, onDone }) => {
    const result = await fn(transcript);
    onText(result);
    onDone();
  };
}

// Export handleDtmf for unit testing
export { handleDtmf };
