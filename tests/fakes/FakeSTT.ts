import type { STTProvider, STTConnection } from '../../src/types.js';

/**
 * Fake STT provider for unit tests.
 * Does not open any network connections.
 * Use simulateTranscript() to fire transcript events as if Deepgram sent them.
 */
export class FakeSTT implements STTProvider {
  private _onTranscript: ((text: string) => void) | null = null;
  public closed = false;
  public mediaChunks: Buffer[] = [];

  async connect(onTranscript: (text: string) => void): Promise<STTConnection> {
    this._onTranscript = onTranscript;
    return {
      sendMedia: (buf) => { this.mediaChunks.push(buf); },
      close: () => { this.closed = true; },
    };
  }

  /** Test helper: simulate Deepgram recognizing speech. */
  simulateTranscript(text: string): void {
    this._onTranscript?.(text);
  }
}
