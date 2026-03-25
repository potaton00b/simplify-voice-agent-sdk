import WebSocket from 'ws';
import type { STTProvider, STTConnection } from '../types.js';

// =============================================================================
// OpenAISTT — STT adapter for OpenAI Realtime API
//
// Uses the OpenAI Realtime API (WebSocket) in transcription-only mode.
// Model: gpt-4o-transcribe (latest, best accuracy as of 2026)
//
// AUDIO CONVERSION REQUIRED
// Twilio sends mulaw (μ-law) encoded audio at 8kHz.
// OpenAI Realtime API requires PCM16 at 24kHz.
//
// Pipeline per audio chunk:
//   Buffer (mulaw 8kHz) → decode mulaw → PCM16 8kHz → upsample 3x → PCM16 24kHz → base64
//
// The 3x upsample is exact (24000 / 8000 = 3) so we use linear interpolation.
// Both conversion steps are implemented inline — no extra npm packages needed.
//
// TURN DETECTION
// We use OpenAI's server-side VAD. It fires a completed transcript event each
// time it detects a speech segment end. The SDK accumulates these in its
// transcript buffer until the caller presses #, exactly like DeepgramSTT.
//
// Docs: https://platform.openai.com/docs/guides/realtime-transcription
// =============================================================================

export interface OpenAISTTConfig {
  apiKey: string;
  /** Transcription model. Defaults to 'gpt-4o-transcribe' (latest). */
  model?: string;
  /** Optional language hint (e.g. 'en'). Omit for auto-detection. */
  language?: string;
}

export class OpenAISTT implements STTProvider {
  private config: Required<Omit<OpenAISTTConfig, 'language'>> & { language: string };

  constructor(config: OpenAISTTConfig) {
    this.config = {
      model: 'gpt-4o-transcribe',
      language: '',
      ...config,
    };
  }

  async connect(onTranscript: (text: string) => void): Promise<STTConnection> {
    const { apiKey, model, language } = this.config;

    const ws = new WebSocket(
      'wss://api.openai.com/v1/realtime?intent=transcription',
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      }
    );

    await new Promise<void>((resolve, reject) => {
      ws.once('error', reject);
      ws.once('open', () => {
        console.log('[OpenAISTT] Connected');

        // Configure the transcription session.
        // server_vad: OpenAI detects speech segments automatically and fires
        // a completed transcript event at the end of each segment — same
        // behaviour as Deepgram's speech_final events.
        ws.send(JSON.stringify({
          type: 'transcription_session.update',
          session: {
            input_audio_format: 'pcm16',
            input_audio_transcription: {
              model,
              ...(language ? { language } : {}),
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
            input_audio_noise_reduction: {
              type: 'near_field',
            },
          },
        }));

        resolve();
      });
    });

    // Listen for transcription events
    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;

      // completed: a full speech segment has been transcribed.
      // This is the equivalent of Deepgram's speech_final event.
      if (msg['type'] === 'conversation.item.input_audio_transcription.completed') {
        const transcript = (msg['transcript'] as string | undefined) ?? '';
        if (transcript.length > 0) {
          console.log('[OpenAISTT] Transcript:', transcript);
          onTranscript(transcript);
        }
      }

      if (msg['type'] === 'error') {
        console.error('[OpenAISTT] Error event:', msg['error']);
      }
    });

    ws.on('error', (err) => {
      console.error('[OpenAISTT] WebSocket error:', err);
    });

    ws.on('close', (code, reason) => {
      console.log('[OpenAISTT] Disconnected. Code:', code, 'Reason:', reason.toString());
    });

    return {
      sendMedia(buffer: Buffer): void {
        if (ws.readyState !== WebSocket.OPEN) return;

        // Convert mulaw 8kHz (Twilio) → PCM16 24kHz (OpenAI)
        const pcm24k = mulawToPcm16At24k(buffer);
        const base64 = Buffer.from(pcm24k.buffer, pcm24k.byteOffset, pcm24k.byteLength)
          .toString('base64');

        ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64,
        }));
      },

      close(): void {
        ws.close();
      },
    };
  }
}

// =============================================================================
// Audio conversion helpers
// =============================================================================

/**
 * Decode a buffer of μ-law (mulaw) bytes to PCM16 samples at 24kHz.
 * Combines mulaw decoding and 8kHz → 24kHz upsampling in one pass.
 *
 * Twilio sends mulaw 8kHz mono. OpenAI expects PCM16 24kHz.
 * Since 24000 / 8000 = 3 exactly, we upsample 3x with linear interpolation.
 */
function mulawToPcm16At24k(mulaw: Buffer): Int16Array {
  const pcm8k = decodeMulaw(mulaw);
  return upsample3x(pcm8k);
}

/**
 * Decode μ-law encoded bytes to PCM16 samples.
 * Standard ITU-T G.711 μ-law decoding algorithm.
 */
function decodeMulaw(mulaw: Buffer): Int16Array {
  const pcm = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) {
    // Invert all bits (μ-law encoding inverts)
    const byte = (~mulaw[i]) & 0xFF;
    const sign     = byte & 0x80;
    const exponent = (byte >> 4) & 0x07;
    const mantissa = byte & 0x0F;

    // ITU-T G.711 μ-law decode: t = (mantissa << 3 + 132) << exponent
    let t = (mantissa << 3) + 132;
    t <<= exponent;

    pcm[i] = sign ? (132 - t) : (t - 132);
  }
  return pcm;
}

/**
 * Upsample PCM16 from 8kHz to 24kHz by inserting 2 interpolated samples
 * between each original sample. Ratio is exactly 3x.
 */
function upsample3x(pcm8k: Int16Array): Int16Array {
  const pcm24k = new Int16Array(pcm8k.length * 3);
  for (let i = 0; i < pcm8k.length; i++) {
    const current = pcm8k[i];
    const next    = i + 1 < pcm8k.length ? pcm8k[i + 1] : current;
    const diff    = next - current;

    pcm24k[i * 3]     = current;
    pcm24k[i * 3 + 1] = Math.round(current + diff / 3);
    pcm24k[i * 3 + 2] = Math.round(current + (diff * 2) / 3);
  }
  return pcm24k;
}
