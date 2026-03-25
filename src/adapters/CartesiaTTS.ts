import WebSocket from 'ws';
import type { TTSProvider, TTSStream } from '../types.js';

// =============================================================================
// CartesiaTTS — TTS adapter for Cartesia Sonic
//
// Opens a new WebSocket to Cartesia for each LLM response.
// Accepts text chunks via sendText() as the LLM streams them.
// Cartesia returns base64-encoded mulaw audio chunks in JSON frames,
// which we pass to the onAudio() callback — the SDK wires that to Twilio.
//
// WHY RAW WEBSOCKET (not the @cartesia/cartesia-js package)?
//   Same reason as CartesiaSTT: the SDK v3 doesn't expose the streaming
//   TTS WebSocket in a way that maps cleanly to our TTSStream interface.
//   Raw ws keeps this adapter dependency-free.
// =============================================================================

export interface CartesiaTTSConfig {
  apiKey: string;
  voiceId: string;
  /** Cartesia TTS model. Defaults to 'sonic-2'. */
  modelId?: string;
  /** Language of the output audio (ISO-639-1). Defaults to 'en'. */
  language?: string;
}

export class CartesiaTTS implements TTSProvider {
  private config: Required<CartesiaTTSConfig>;

  constructor(config: CartesiaTTSConfig) {
    this.config = {
      modelId: 'sonic-2',
      language: 'en',
      ...config,
    };
  }

  createStream(onAudio: (base64Chunk: string) => void): TTSStream {
    const { apiKey, voiceId, modelId } = this.config;

    // Each stream gets a unique context_id. Cartesia uses this to associate
    // all text chunks in a single response and flush audio in order.
    const contextId = Math.random().toString(36).slice(2);

    const ws = new WebSocket('wss://api.cartesia.ai/tts/websocket?cartesia_version=2025-04-16', {
      headers: {
        'X-API-Key': apiKey,
      },
    });

    // Text chunks that arrive before the WebSocket opens are queued here
    // and flushed once the socket opens.
    const textQueue: string[] = [];
    let isReady = false;
    // If close() is called before the socket opens, we set this flag so the
    // open handler sends the EOS message immediately after flushing the queue.
    let pendingClose = false;

    const buildMessage = (text: string, isFinal: boolean) =>
      JSON.stringify({
        model_id: modelId,
        transcript: text,
        voice: { mode: 'id', id: voiceId },
        output_format: { container: 'raw', encoding: 'pcm_mulaw', sample_rate: 8000 },
        context_id: contextId,
        continue: !isFinal,
      });

    ws.on('open', () => {
      console.log('[CartesiaTTS] Connected');
      isReady = true;

      // Flush any text chunks that arrived before the socket opened.
      // All queued chunks use continue: true since we don't know if close()
      // was already called — we check pendingClose after.
      for (const chunk of textQueue) {
        ws.send(buildMessage(chunk, false));
      }
      textQueue.length = 0;

      // If close() was called before we opened, send the EOS now.
      if (pendingClose) {
        ws.send(buildMessage('', true));
      }
    });

    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;

      if (msg['type'] === 'chunk') {
        // data is base64-encoded raw mulaw audio — pass directly to Twilio
        onAudio(msg['data'] as string);
      } else if (msg['type'] === 'done') {
        console.log('[CartesiaTTS] Stream complete');
      } else if (msg['type'] === 'error') {
        console.error('[CartesiaTTS] Error:', msg['error']);
      }
    });

    ws.on('error', (err) => {
      console.error('[CartesiaTTS] WebSocket error:', err);
    });

    ws.on('close', (code, reason) => {
      console.log('[CartesiaTTS] Disconnected. Code:', code, 'Reason:', reason.toString());
    });

    return {
      sendText(chunk: string): void {
        if (isReady && ws.readyState === WebSocket.OPEN) {
          ws.send(buildMessage(chunk, false));
        } else {
          textQueue.push(chunk);
        }
      },

      close(): void {
        if (ws.readyState === WebSocket.OPEN) {
          // Send final message with continue: false — tells Cartesia "that's all the text"
          ws.send(buildMessage('', true));
        } else {
          pendingClose = true;
        }
      },
    };
  }
}
