import type { TTSProvider, TTSStream } from '../../src/types.js';

/**
 * A single fake TTS stream. Captures text sent to it.
 * Use simulateAudio() to fire audio callbacks as if ElevenLabs returned audio.
 */
export class FakeTTSStream implements TTSStream {
  public textChunks: string[] = [];
  public closed = false;
  private _onAudio: (base64: string) => void;

  constructor(onAudio: (base64: string) => void) {
    this._onAudio = onAudio;
  }

  sendText(chunk: string): void {
    this.textChunks.push(chunk);
  }

  close(): void {
    this.closed = true;
  }

  /** Convenience: get all text joined together. */
  get fullText(): string {
    return this.textChunks.join('');
  }

  /** Test helper: simulate ElevenLabs returning an audio chunk. */
  simulateAudio(base64: string): void {
    this._onAudio(base64);
  }
}

/**
 * Fake TTS provider for unit tests.
 * Does not open any network connections.
 * Captures all streams created; each stream captures all text sent to it.
 */
export class FakeTTS implements TTSProvider {
  public streams: FakeTTSStream[] = [];

  createStream(onAudio: (base64Chunk: string) => void): TTSStream {
    const stream = new FakeTTSStream(onAudio);
    this.streams.push(stream);
    return stream;
  }

  /** The most recently created stream. */
  get lastStream(): FakeTTSStream {
    return this.streams[this.streams.length - 1];
  }
}
