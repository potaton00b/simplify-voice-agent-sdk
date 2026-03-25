import WebSocket from 'ws';
import type { TTSProvider, TTSStream } from '../types.js';

// =============================================================================
// DeepgramTTS — TTS adapter for Deepgram Aura
//
// Opens a new WebSocket to Deepgram for each LLM response.
// Accepts text chunks via sendText() as the LLM streams them.
//
// IMPORTANT: Deepgram sends audio as raw binary WebSocket frames (not base64).
// We convert them with buffer.toString('base64') before passing to onAudio(),
// because Twilio expects base64-encoded mulaw in the media stream JSON.
//
// WHY RAW WEBSOCKET (not @deepgram/sdk's deepgram.speak.live())?
//   The SDK wraps the same WebSocket protocol but adds event abstractions that
//   don't map cleanly to our simple TTSStream interface. Raw ws is simpler here.
// =============================================================================

export interface DeepgramTTSConfig {
  apiKey: string;
  /** Deepgram Aura model. Defaults to 'aura-2-thalia-en'. */
  model?: string;
}

export class DeepgramTTS implements TTSProvider {
  private config: Required<DeepgramTTSConfig>;

  constructor(config: DeepgramTTSConfig) {
    this.config = {
      model: 'aura-2-thalia-en',
      ...config,
    };
  }

  createStream(onAudio: (base64Chunk: string) => void): TTSStream {
    const { apiKey, model } = this.config;

    const url =
      `wss://api.deepgram.com/v1/speak` +
      `?model=${encodeURIComponent(model)}` +
      `&encoding=mulaw` +
      `&sample_rate=8000` +
      `&container=none`;

    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    });

    // Text chunks that arrive before the WebSocket opens are queued here
    // and flushed once the socket opens.
    const textQueue: string[] = [];
    let isReady = false;
    // If close() is called before the socket opens, we set this flag so the
    // open handler sends the Flush message after draining the queue.
    let pendingClose = false;

    ws.on('open', () => {
      console.log('[DeepgramTTS] Connected');
      isReady = true;

      for (const chunk of textQueue) {
        ws.send(JSON.stringify({ type: 'Speak', text: chunk }));
      }
      textQueue.length = 0;

      if (pendingClose) {
        ws.send(JSON.stringify({ type: 'Flush' }));
      }
    });

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // Deepgram sends raw binary mulaw audio frames.
        // Convert to base64 so the SDK can write it to Twilio.
        onAudio(data.toString('base64'));
      } else {
        // Text frames carry metadata/status events — log errors, ignore the rest.
        try {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          if (msg['type'] === 'Warning') {
            console.warn('[DeepgramTTS] Warning:', msg['description']);
          } else if (msg['type'] === 'Error') {
            console.error('[DeepgramTTS] Error:', msg['description']);
          } else if (msg['type'] === 'Flushed') {
            console.log('[DeepgramTTS] Flush complete');
          }
        } catch {
          // ignore unparseable frames
        }
      }
    });

    ws.on('error', (err) => {
      console.error('[DeepgramTTS] WebSocket error:', err);
    });

    ws.on('close', (code, reason) => {
      console.log('[DeepgramTTS] Disconnected. Code:', code, 'Reason:', reason.toString());
    });

    return {
      sendText(chunk: string): void {
        if (isReady && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'Speak', text: chunk }));
        } else {
          textQueue.push(chunk);
        }
      },

      close(): void {
        if (ws.readyState === WebSocket.OPEN) {
          // Flush tells Deepgram "that's all the text — finish and send remaining audio"
          ws.send(JSON.stringify({ type: 'Flush' }));
        } else {
          pendingClose = true;
        }
      },
    };
  }
}
