import { describe, it, expect, vi } from 'vitest';
import { VoiceAgent, simpleResponse } from '../src/VoiceAgent.js';
import { handleDtmf } from '../src/VoiceAgent.js';
import { buildTwiML, buildTwilioMediaMessage } from '../src/internal/twilioMessages.js';
import { FakeSTT } from './fakes/FakeSTT.js';
import { FakeTTS } from './fakes/FakeTTS.js';
import { MockTwilioSocket } from './helpers/MockTwilioSocket.js';
import type { CallState } from '../src/types.js';

// =============================================================================
// Helpers
// =============================================================================

function makeAgent(overrides: Partial<Parameters<typeof VoiceAgent>[0]> = {}) {
  const stt = new FakeSTT();
  const tts = new FakeTTS();
  const onMessage = vi.fn(async (_transcript: string, { onText, onDone }: { onText: (t: string) => void; onDone: () => void }) => {
    onText('Hello!');
    onDone();
  });

  const agent = new VoiceAgent({
    host: 'test.ngrok.io',
    stt,
    tts,
    onMessage,
    ...overrides,
  });

  return { agent, stt, tts, onMessage };
}

/** Run the media stream handler with a mock socket. Returns a promise that
 *  resolves once the STT connection is set up (i.e. after the await inside). */
async function connectCall(agent: VoiceAgent, socket: MockTwilioSocket, streamSid = 'MX123') {
  const handler = agent.handleMediaStream();
  const handlerPromise = handler(socket as never, {} as never);
  // Yield so the async handler can run up to the stt.connect() await
  await Promise.resolve();
  await Promise.resolve();
  socket.simulateStart(streamSid);
  await handlerPromise;
  return handlerPromise;
}

// =============================================================================
// buildTwiML (pure function)
// =============================================================================

describe('buildTwiML', () => {
  it('returns valid XML with correct wss:// URL', () => {
    const xml = buildTwiML('abc.ngrok.io', '/media-stream');
    expect(xml).toContain('wss://abc.ngrok.io/media-stream');
    expect(xml).toContain('<Stream');
    expect(xml).toContain('<Connect>');
  });

  it('uses custom media stream path', () => {
    const xml = buildTwiML('myapp.railway.app', '/custom-path');
    expect(xml).toContain('wss://myapp.railway.app/custom-path');
  });
});

// =============================================================================
// buildTwilioMediaMessage (pure function)
// =============================================================================

describe('buildTwilioMediaMessage', () => {
  it('returns correct JSON shape', () => {
    const msg = JSON.parse(buildTwilioMediaMessage('MX123', 'base64data'));
    expect(msg).toEqual({
      event: 'media',
      streamSid: 'MX123',
      media: { payload: 'base64data' },
    });
  });
});

// =============================================================================
// handleIncomingCall
// =============================================================================

describe('VoiceAgent.handleIncomingCall()', () => {
  it('returns TwiML with the configured host', async () => {
    const { agent } = makeAgent({ host: 'myhost.ngrok.io' });
    let sentBody = '';
    const reply = {
      type: () => reply,
      send: (body: string) => { sentBody = body; },
    };
    await agent.handleIncomingCall()({} as never, reply as never);
    expect(sentBody).toContain('wss://myhost.ngrok.io/media-stream');
  });

  it('uses custom mediaStreamPath', async () => {
    const { agent } = makeAgent({ host: 'host.io', mediaStreamPath: '/ws' });
    let sentBody = '';
    const reply = {
      type: () => reply,
      send: (body: string) => { sentBody = body; },
    };
    await agent.handleIncomingCall()({} as never, reply as never);
    expect(sentBody).toContain('wss://host.io/ws');
  });
});

// =============================================================================
// DTMF state machine (handleDtmf — pure function)
// =============================================================================

describe('handleDtmf — normal mode', () => {
  function makeState(overrides: Partial<CallState> = {}): CallState {
    return {
      streamSid: 'MX123',
      transcriptBuffer: '',
      isCollectingDtmf: false,
      dtmfBuffer: '',
      sttConnection: null,
      ...overrides,
    };
  }

  it('# with non-empty buffer calls runLlm with trimmed transcript', () => {
    const state = makeState({ transcriptBuffer: ' hello world ' });
    const runLlm = vi.fn();
    handleDtmf('#', state, runLlm);
    expect(runLlm).toHaveBeenCalledWith('hello world');
  });

  it('# clears the transcript buffer', () => {
    const state = makeState({ transcriptBuffer: ' some text ' });
    handleDtmf('#', state, vi.fn());
    expect(state.transcriptBuffer).toBe('');
  });

  it('# with empty buffer does NOT call runLlm', () => {
    const state = makeState({ transcriptBuffer: '   ' });
    const runLlm = vi.fn();
    handleDtmf('#', state, runLlm);
    expect(runLlm).not.toHaveBeenCalled();
  });

  it('non-# digits are ignored in normal mode', () => {
    const state = makeState({ transcriptBuffer: 'hello' });
    const runLlm = vi.fn();
    handleDtmf('5', state, runLlm);
    expect(runLlm).not.toHaveBeenCalled();
    expect(state.transcriptBuffer).toBe('hello');
  });
});

describe('handleDtmf — DTMF collection mode', () => {
  function makeCollectionState(overrides: Partial<CallState> = {}): CallState {
    return {
      streamSid: 'MX123',
      transcriptBuffer: '',
      isCollectingDtmf: true,
      dtmfBuffer: '',
      sttConnection: null,
      ...overrides,
    };
  }

  it('digits accumulate in dtmfBuffer', () => {
    const state = makeCollectionState();
    handleDtmf('1', state, vi.fn());
    handleDtmf('2', state, vi.fn());
    handleDtmf('3', state, vi.fn());
    expect(state.dtmfBuffer).toBe('123');
  });

  it('# with digits calls runLlm with "Caller entered: {digits}"', () => {
    const state = makeCollectionState({ dtmfBuffer: '4567' });
    const runLlm = vi.fn();
    handleDtmf('#', state, runLlm);
    expect(runLlm).toHaveBeenCalledWith('Caller entered: 4567');
  });

  it('# with digits exits collection mode', () => {
    const state = makeCollectionState({ dtmfBuffer: '123' });
    handleDtmf('#', state, vi.fn());
    expect(state.isCollectingDtmf).toBe(false);
  });

  it('# clears dtmfBuffer', () => {
    const state = makeCollectionState({ dtmfBuffer: '123' });
    handleDtmf('#', state, vi.fn());
    expect(state.dtmfBuffer).toBe('');
  });

  it('# with empty dtmfBuffer stays in collection mode', () => {
    const state = makeCollectionState({ dtmfBuffer: '' });
    const runLlm = vi.fn();
    handleDtmf('#', state, runLlm);
    expect(runLlm).not.toHaveBeenCalled();
    expect(state.isCollectingDtmf).toBe(true);
  });
});

// =============================================================================
// simpleResponse helper
// =============================================================================

describe('simpleResponse', () => {
  it('wraps a string-returning function into OnMessageHandler shape', async () => {
    const handler = simpleResponse(async () => 'pong');
    const onText = vi.fn();
    const onDone = vi.fn();
    await handler('ping', { onText, onDone, switchToDtmfCollection: vi.fn() });
    expect(onText).toHaveBeenCalledWith('pong');
    expect(onDone).toHaveBeenCalled();
  });
});

// =============================================================================
// FakeSTT
// =============================================================================

describe('FakeSTT', () => {
  it('simulateTranscript fires the registered onTranscript callback', async () => {
    const fakeSTT = new FakeSTT();
    const received: string[] = [];
    await fakeSTT.connect((t) => received.push(t));
    fakeSTT.simulateTranscript('hello');
    fakeSTT.simulateTranscript('world');
    expect(received).toEqual(['hello', 'world']);
  });

  it('sendMedia records the buffer', async () => {
    const fakeSTT = new FakeSTT();
    const conn = await fakeSTT.connect(() => {});
    const buf = Buffer.from('audio');
    conn.sendMedia(buf);
    expect(fakeSTT.mediaChunks).toContain(buf);
  });

  it('close sets closed flag', async () => {
    const fakeSTT = new FakeSTT();
    const conn = await fakeSTT.connect(() => {});
    conn.close();
    expect(fakeSTT.closed).toBe(true);
  });
});

// =============================================================================
// FakeTTS
// =============================================================================

describe('FakeTTS', () => {
  it('createStream captures text chunks', () => {
    const fakeTTS = new FakeTTS();
    const stream = fakeTTS.createStream(() => {});
    stream.sendText('hello ');
    stream.sendText('world');
    expect(fakeTTS.lastStream.textChunks).toEqual(['hello ', 'world']);
    expect(fakeTTS.lastStream.fullText).toBe('hello world');
  });

  it('simulateAudio fires the onAudio callback', () => {
    const fakeTTS = new FakeTTS();
    const received: string[] = [];
    fakeTTS.createStream((b64) => received.push(b64));
    fakeTTS.lastStream.simulateAudio('abc123');
    expect(received).toEqual(['abc123']);
  });

  it('close sets closed flag on stream', () => {
    const fakeTTS = new FakeTTS();
    const stream = fakeTTS.createStream(() => {});
    stream.close();
    expect(fakeTTS.lastStream.closed).toBe(true);
  });
});
