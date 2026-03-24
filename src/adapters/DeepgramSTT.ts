import { createClient } from '@deepgram/sdk';
import type { STTProvider, STTConnection } from '../types.js';

// =============================================================================
// DeepgramSTT — STT adapter for Deepgram
//
// Ported from 18.26 VoiceAgent/voice-agent/src/services/deepgram.ts
//
// Opens a persistent WebSocket to Deepgram for the duration of one call.
// Twilio sends mulaw audio at 8kHz — we configure Deepgram to match.
// Fires onTranscript() for each speech_final chunk as the caller speaks.
// The SDK accumulates these in a buffer until the caller presses #.
// =============================================================================

export interface DeepgramSTTConfig {
  apiKey: string;
  /** Deepgram model to use. Defaults to 'nova-3'. */
  model?: string;
}

export class DeepgramSTT implements STTProvider {
  private config: Required<DeepgramSTTConfig>;

  constructor(config: DeepgramSTTConfig) {
    this.config = {
      model: 'nova-3',
      ...config,
    };
  }

  async connect(onTranscript: (text: string) => void): Promise<STTConnection> {
    const { apiKey, model } = this.config;
    const deepgram = createClient(apiKey);

    // Open a live streaming connection to Deepgram.
    // Twilio phone audio is always mulaw, 8kHz, mono.
    const connection = deepgram.listen.live({
      model,
      encoding: 'mulaw',
      sample_rate: 8000,
      channels: 1,

      // interim_results: true gives us speech_final chunks as the caller speaks,
      // so the buffer is populated before the caller presses #.
      // We do NOT use utterance_end_ms — DTMF (#) is our only trigger.
      interim_results: true,
    });

    // All event handlers are registered inside the 'open' event.
    // This is the Deepgram SDK pattern — the connection object is not
    // ready for event listeners until the WebSocket is open.
    await new Promise<void>((resolve, reject) => {
      connection.on('open', () => {
        console.log('[DeepgramSTT] Connected');

        connection.on('Results', (data) => {
          // speech_final: true means Deepgram is confident this phrase is complete.
          // We only fire onTranscript for finalized chunks, not partials.
          if (data.speech_final === true) {
            const transcript: string = data.channel?.alternatives?.[0]?.transcript ?? '';
            if (transcript.length > 0) {
              console.log('[DeepgramSTT] Transcript chunk:', transcript);
              onTranscript(transcript);
            }
          }
        });

        connection.on('close', () => {
          console.log('[DeepgramSTT] Disconnected');
        });

        connection.on('error', (err) => {
          console.error('[DeepgramSTT] Error:', err);
        });

        resolve();
      });

      connection.on('error', reject);
    });

    return {
      sendMedia(buffer: Buffer): void {
        connection.send(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
      },
      close(): void {
        connection.finish();
      },
    };
  }
}
