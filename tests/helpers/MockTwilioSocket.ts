import { EventEmitter } from 'events';

/**
 * Simulates the Twilio WebSocket for unit tests.
 * Extend EventEmitter so the VoiceAgent can call socket.on('message', ...).
 * Captures all messages sent back to "Twilio" via socket.send().
 */
export class MockTwilioSocket extends EventEmitter {
  /** Simulates WebSocket.OPEN = 1 */
  public readyState = 1;
  /** All raw JSON strings sent back to Twilio (audio, etc.) */
  public sentMessages: string[] = [];

  send(data: string): void {
    this.sentMessages.push(data);
  }

  /** Parsed version of all sent messages. */
  get parsedMessages(): Array<Record<string, unknown>> {
    return this.sentMessages.map((m) => JSON.parse(m));
  }

  /** All audio payloads sent to Twilio (base64 strings). */
  get audioPayloads(): string[] {
    return this.parsedMessages
      .filter((m) => m['event'] === 'media')
      .map((m) => (m['media'] as { payload: string }).payload);
  }

  // ── Helpers to simulate Twilio sending messages ────────────────────────────

  simulateMessage(msg: object): void {
    this.emit('message', Buffer.from(JSON.stringify(msg)));
  }

  simulateStart(streamSid = 'MX_test_stream_sid'): void {
    this.simulateMessage({ event: 'start', start: { streamSid } });
  }

  simulateMedia(base64Audio = 'dGVzdA=='): void {
    this.simulateMessage({ event: 'media', media: { payload: base64Audio } });
  }

  simulateDtmf(digit: string): void {
    this.simulateMessage({ event: 'dtmf', dtmf: { digit } });
  }

  simulateClose(): void {
    this.emit('close');
  }
}
