import WebSocket from 'ws';
import type { STTProvider, STTConnection } from '../types.js';

// =============================================================================
// CartesiaSTT — STT adapter for Cartesia Ink
//
// Uses Cartesia's Ink model (ink-whisper) for real-time speech-to-text over
// a raw WebSocket. The @cartesia/cartesia-js SDK v3 only exposes batch
// transcription — streaming is implemented here as a raw WebSocket connection.
//
// Twilio sends mulaw audio at 8kHz. Cartesia supports pcm_mulaw at 8000Hz,
// so no conversion is needed.
//
// Fires onTranscript() for each isFinal transcript chunk as the caller speaks.
// The SDK accumulates these in a buffer until the caller presses #.
// =============================================================================

export interface CartesiaSTTConfig {
  apiKey: string;
  /** Cartesia STT model. Defaults to 'ink-whisper'. */
  model?: string;
  /** Language of the audio (ISO-639-1). Defaults to 'en'. */
  language?: string;
}

export class CartesiaSTT implements STTProvider {
  private config: Required<CartesiaSTTConfig>;

  constructor(config: CartesiaSTTConfig) {
    this.config = {
      model: 'ink-whisper',
      language: 'en',
      ...config,
    };
  }

  async connect(onTranscript: (text: string) => void): Promise<STTConnection> {
    const { apiKey, model, language } = this.config;

    // Build the WebSocket URL with connection parameters.
    // Cartesia uses query params for auth and audio config on the streaming endpoint.
    const url =
      `wss://api.cartesia.ai/stt/websocket` +
      `?api_key=${encodeURIComponent(apiKey)}` +
      `&cartesia_version=2025-04-16` +
      `&model=${encodeURIComponent(model)}` +
      `&language=${encodeURIComponent(language)}` +
      `&encoding=pcm_mulaw` +
      `&sample_rate=8000`;

    const ws = new WebSocket(url);

    // Wait for the connection to be established before returning.
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        console.log('[CartesiaSTT] Connected');
        resolve();
      });
      ws.once('error', reject);
    });

    // Register message handler after connection is open.
    // isFinal === true means Cartesia has finalized this phrase —
    // equivalent to Deepgram's speech_final flag.
    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;

      if (msg['type'] === 'transcript') {
        if (msg['is_final'] === true) {
          const text = (msg['text'] as string) ?? '';
          if (text.length > 0) {
            console.log('[CartesiaSTT] Transcript chunk:', text);
            onTranscript(text);
          }
        }
      } else if (msg['type'] === 'error') {
        console.error('[CartesiaSTT] Error:', msg['message']);
      }
    });

    ws.on('error', (err) => {
      console.error('[CartesiaSTT] WebSocket error:', err);
    });

    ws.on('close', (code, reason) => {
      console.log('[CartesiaSTT] Disconnected. Code:', code, 'Reason:', reason.toString());
    });

    return {
      sendMedia(buffer: Buffer): void {
        if (ws.readyState === WebSocket.OPEN) {
          const arrayBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
          ) as ArrayBuffer;
          ws.send(arrayBuffer);
        }
      },
      close(): void {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      },
    };
  }
}
