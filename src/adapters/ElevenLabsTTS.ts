import WebSocket from 'ws';
import type { TTSProvider, TTSStream } from '../types.js';

// =============================================================================
// ElevenLabsTTS — TTS adapter for ElevenLabs
//
// Ported from 18.26 VoiceAgent/voice-agent/src/services/elevenlabs.ts
//
// Opens a new WebSocket to ElevenLabs for each LLM response.
// Accepts text chunks via sendText() as the LLM streams them.
// ElevenLabs returns base64-encoded mulaw audio chunks, which we pass
// to the onAudio() callback — the SDK wires that to Twilio.
//
// KEY CHANGE vs. reference: instead of writing audio directly to the
// Twilio socket (which coupled ElevenLabs to Twilio), we call onAudio().
// The SDK's VoiceAgent class owns the Twilio write. This means ElevenLabs
// can be swapped for any other TTS without touching Twilio code.
//
// WHY RAW WEBSOCKET (not the elevenlabs npm package)?
//   The ElevenLabs streaming TTS is a straightforward JSON WebSocket protocol.
//   Using raw ws avoids pulling in a heavy SDK for a simple wire format,
//   and keeps this adapter dependency-free (ws is a peer dependency).
// =============================================================================

export interface ElevenLabsTTSConfig {
  apiKey: string;
  voiceId: string;
  /** ElevenLabs model. Defaults to 'eleven_turbo_v2_5' (lowest latency). */
  modelId?: string;
  /**
   * Audio output format. Defaults to 'ulaw_8000' — raw mulaw at 8kHz,
   * which is exactly what Twilio expects. No conversion needed.
   */
  outputFormat?: string;
}

export class ElevenLabsTTS implements TTSProvider {
  private config: Required<ElevenLabsTTSConfig>;

  constructor(config: ElevenLabsTTSConfig) {
    this.config = {
      modelId: 'eleven_turbo_v2_5',
      outputFormat: 'ulaw_8000',
      ...config,
    };
  }

  createStream(onAudio: (base64Chunk: string) => void): TTSStream {
    const { apiKey, voiceId, modelId, outputFormat } = this.config;

    // Open a new WebSocket to ElevenLabs for this response.
    // URL encodes the voice, model, and audio format ElevenLabs needs.
    const ws = new WebSocket(
      `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input` +
      `?model_id=${modelId}&output_format=${outputFormat}`
    );

    // Text chunks that arrive before the WebSocket is open are queued here
    // and flushed the moment the socket opens. Without this, the first few
    // LLM tokens would be dropped during connection setup.
    const textQueue: string[] = [];
    let isReady = false;
    // If close() is called before the socket opens, we set this flag and
    // send the EOS (end-of-stream) message as soon as the open handler runs.
    let pendingClose = false;

    ws.on('open', () => {
      console.log('[ElevenLabsTTS] Connected');

      // ElevenLabs requires a "Beginning of Stream" (BOS) message first.
      // text: ' ' (a single space, not empty — empty string is the EOS signal)
      // xi_api_key: authentication
      ws.send(JSON.stringify({
        text: ' ',
        xi_api_key: apiKey,
      }));

      isReady = true;

      // Flush any text chunks that arrived before the socket opened
      for (const chunk of textQueue) {
        ws.send(JSON.stringify({ text: chunk, try_trigger_generation: true }));
      }
      textQueue.length = 0;

      // If close() was called before we opened, send EOS now
      if (pendingClose) {
        ws.send(JSON.stringify({ text: '' }));
      }
    });

    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;

      if (msg['error']) {
        // ElevenLabs sends errors as JSON messages, not WebSocket error events
        console.error('[ElevenLabsTTS] Error:', msg['error']);
      }

      if (msg['audio']) {
        // Pass the base64 audio chunk to the SDK via callback.
        // The SDK writes it to Twilio. ElevenLabs never touches Twilio directly.
        onAudio(msg['audio'] as string);
      }

      if (msg['isFinal']) {
        console.log('[ElevenLabsTTS] Stream complete');
      }
    });

    ws.on('error', (err) => {
      console.error('[ElevenLabsTTS] WebSocket error:', err);
    });

    ws.on('close', (code, reason) => {
      console.log('[ElevenLabsTTS] Disconnected. Code:', code, 'Reason:', reason.toString());
    });

    return {
      sendText(chunk: string): void {
        if (isReady && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ text: chunk, try_trigger_generation: true }));
        } else {
          // Socket not open yet — queue for the open handler to flush
          textQueue.push(chunk);
        }
      },

      close(): void {
        if (ws.readyState === WebSocket.OPEN) {
          // EOS — empty string tells ElevenLabs "that's all the text, flush audio"
          ws.send(JSON.stringify({ text: '' }));
        } else {
          // Socket not open yet — flag it so the open handler sends EOS after flush
          pendingClose = true;
        }
      },
    };
  }
}
