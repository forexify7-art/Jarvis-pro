import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildGeminiLiveSetup,
  decodePcm16Base64,
  encodePcm16Base64,
  GEMINI_LIVE_MODEL,
  GeminiLiveVoice,
  getGeminiLiveWebSocketUrl,
  resampleAudio,
} from '../voice/gemini-live.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const preload = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');

test('encodes and decodes signed little-endian PCM16 audio', () => {
  const encoded = encodePcm16Base64(new Float32Array([-1, -0.5, 0, 0.5, 1]));
  assert.deepEqual([...decodePcm16Base64(encoded)], [-32768, -16384, 0, 16383, 32767]);
});

test('resamples microphone audio to the Gemini 16 kHz input rate', () => {
  const samples = new Float32Array([0, 1, 0, -1, 0, 1]);
  const resampled = resampleAudio(samples, 48_000);
  assert.equal(resampled.length, 2);
  assert.equal(resampled[0], 0);
  assert.equal(resampled[1], -1);
  assert.equal(resampleAudio(samples, 16_000), samples);
});

test('builds a bilingual native-audio Live setup with transcriptions', () => {
  const session = buildGeminiLiveSetup('hi').setup;
  assert.equal(GEMINI_LIVE_MODEL, 'gemini-3.8-live');
  assert.equal(session.model, 'models/gemini-3.8-live');
  assert.deepEqual(session.generationConfig.responseModalities, ['AUDIO']);
  assert.equal(session.realtimeInputConfig.automaticActivityDetection.silenceDurationMs, 600);
  assert.equal(session.realtimeInputConfig.activityHandling, 'START_OF_ACTIVITY_INTERRUPTS');
  assert.ok(session.inputAudioTranscription);
  assert.ok(session.outputAudioTranscription);
  assert.match(session.systemInstruction.parts[0].text, /Hindi, English/);
  assert.match(session.systemInstruction.parts[0].text, /Pronounce Hindi and English accurately/);
  assert.equal(
    buildGeminiLiveSetup('hi', false, 'Aoede').setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
    'Aoede',
  );
  assert.equal(buildGeminiLiveSetup('en', true).setup.inputAudioTranscription, undefined);
});

test('uses the constrained Google WebSocket endpoint with an encoded ephemeral token', () => {
  const url = new URL(getGeminiLiveWebSocketUrl('auth_tokens/test token'));
  assert.equal(url.protocol, 'wss:');
  assert.equal(url.hostname, 'generativelanguage.googleapis.com');
  assert.match(url.pathname, /BidiGenerateContentConstrained$/);
  assert.equal(url.searchParams.get('access_token'), 'auth_tokens/test token');
});

test('routes Gemini voice input and typed turns through Live while preserving speech fallback', () => {
  const microphoneHandler = app.match(/function startListeningFromUserGesture\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(microphoneHandler, /isGeminiLiveAvailable\(\)/);
  assert.match(microphoneHandler, /startLiveConversation\(\)/);
  assert.match(microphoneHandler, /startListening\('command', false, false, true\)/);
  assert.match(app, /geminiLiveVoice\.sendTextMessage\(outgoingText\)/);
  assert.match(app, /geminiLiveVoice\.speakText\(speechText/);
  assert.match(app, /forceBrowser: true/);
  assert.match(app, /onInputTranscript\(text, \{ final \}\)[\s\S]*?addMessage\(\{ role: 'user', content: text\.trim\(\) \}\)/);
});

test('keeps permanent Gemini API key entry and Electron key IPC out of the frontend', () => {
  assert.match(index, /GEMINI_API_KEY in the server/);
  assert.doesNotMatch(index, /gemini-key-save|gemini-key-unlock|Google Gemini API key/);
  assert.doesNotMatch(app, /saveBrowserGeminiKey|saveGeminiApiKey|unlockSavedGeminiApiKey/);
  assert.doesNotMatch(preload, /GeminiApiKey|gemini-key|apiKey/);
});

test('streams mono PCM16 input, interrupts playback, releases resources, and handles microphone termination', async () => {
  const globalNames = ['navigator', 'AudioContext', 'AudioWorkletNode'];
  const descriptors = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const createInputTrack = () => {
    const listeners = new Map();
    return {
      stopped: false,
      readyState: 'live',
      addEventListener(type, listener) { listeners.set(type, listener); },
      stop() { this.stopped = true; },
      end() {
        this.readyState = 'ended';
        listeners.get('ended')?.();
      },
    };
  };
  const inputTrack = createInputTrack();
  const revokedTrack = createInputTrack();
  const timedTrack = createInputTrack();
  let streamIndex = 0;
  const contexts = [];
  const sources = [];
  const sentMessages = [];
  let liveSocket;

  class FakeNode {
    connect() {}
    disconnect() { this.disconnected = true; }
  }

  class FakeAudioContext {
    constructor(options = {}) {
      this.sampleRate = options.sampleRate || 48_000;
      this.state = 'running';
      this.currentTime = 1;
      this.destination = {};
      this.audioWorklet = { addModule: async () => {} };
      contexts.push(this);
    }

    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createMediaStreamSource() { return new FakeNode(); }
    createBuffer(_channels, length, sampleRate) {
      return {
        duration: length / sampleRate,
        sampleRate,
        getChannelData: () => new Float32Array(length),
      };
    }
    createBufferSource() {
      const source = {
        connect() {},
        start(time) { this.startTime = time; },
        stop() { this.stopped = true; },
        onended: null,
      };
      sources.push(source);
      return source;
    }
  }

  class FakeAudioWorkletNode extends FakeNode {
    static instances = [];

    constructor() {
      super();
      this.port = {};
      FakeAudioWorkletNode.instances.push(this);
    }
  }

  class FakeWebSocket {
    static OPEN = 1;
    readyState = 0;
    bufferedAmount = 0;

    constructor(url) {
      this.url = url;
      liveSocket = this;
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      });
    }

    send(value) {
      const message = JSON.parse(value);
      sentMessages.push(message);
      if (message.setup) {
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) }));
      }
    }

    close() {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    }
  }

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          const track = [inputTrack, revokedTrack, timedTrack][streamIndex++];
          return { getTracks: () => [track], getAudioTracks: () => [track] };
        },
      },
    },
  });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext });
  Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: FakeAudioWorkletNode });

  try {
    const events = [];
    const audioLevels = [];
    const voice = new GeminiLiveVoice({
      fetcher: async () => new Response(JSON.stringify({ token: 'auth_tokens/mock' }), { status: 200 }),
      WebSocketConstructor: FakeWebSocket,
    });
    assert.equal(await voice.startConversation({
      voiceName: 'Aoede',
      callbacks: {
        onAudioStart: () => events.push('audio-start'),
        onAudioEnd: () => events.push('audio-end'),
        onAudioLevel: (level) => audioLevels.push(level),
        onInterrupted: () => events.push('interrupted'),
        onError: (error) => { throw error; },
      },
    }), true);
    const setup = sentMessages.find((message) => message.setup).setup;
    assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Aoede');

    FakeAudioWorkletNode.instances[0].port.onmessage({
      data: { samples: new Float32Array(512).fill(0.25), sampleRate: 48_000 },
    });
    const inputAudio = sentMessages.find((message) => message.realtimeInput?.audio).realtimeInput.audio;
    assert.equal(inputAudio.mimeType, 'audio/pcm;rate=16000');
    assert.equal(decodePcm16Base64(inputAudio.data).length, 170);

    await liveSocket.onmessage({
      data: JSON.stringify({
        serverContent: {
          modelTurn: { parts: [{ inlineData: { data: encodePcm16Base64(new Float32Array(240).fill(0.2)) } }] },
        },
      }),
    });
    assert.equal(contexts[0].sampleRate, 48_000);
    assert.equal(sources[0].buffer.sampleRate, 24_000);
    assert.ok(audioLevels[0] > 0.79 && audioLevels[0] < 0.81);
    assert.deepEqual(events, ['audio-start']);

    await liveSocket.onmessage({ data: JSON.stringify({ serverContent: { interrupted: true } }) });
    assert.equal(sources[0].stopped, true);
    assert.equal(audioLevels.at(-1), 0);
    assert.deepEqual(events, ['audio-start', 'audio-end', 'interrupted']);
    assert.match(app, /onAudioLevel: syncAvatarAudioLevel/);

    await voice.stop();
    assert.equal(inputTrack.stopped, true);
    assert.ok(contexts.some((context) => context.state === 'closed'));
    assert.equal(voice.isConversationActive, false);

    const terminationEvents = [];
    assert.equal(await voice.startConversation({
      callbacks: {
        onError(error) { terminationEvents.push(error.code); },
        onClosed() { terminationEvents.push('closed'); },
      },
    }), true);
    revokedTrack.end();
    assert.deepEqual(terminationEvents, ['MICROPHONE_TRACK_ENDED', 'closed']);
    assert.equal(revokedTrack.stopped, true);
    assert.equal(voice.isConversationActive, false);
    assert.match(app, /error\.code === 'MICROPHONE_TRACK_ENDED'[\s\S]*?state\.liveReconnectWanted = false/);

    let expireSession;
    const timeoutVoice = new GeminiLiveVoice({
      fetcher: async () => new Response(JSON.stringify({ token: 'auth_tokens/mock' }), { status: 200 }),
      WebSocketConstructor: FakeWebSocket,
      conversationTimeoutMs: 30_000,
      setTimer(callback) { expireSession = callback; return 1; },
      clearTimer() {},
    });
    const timeoutEvents = [];
    assert.equal(await timeoutVoice.startConversation({
      callbacks: {
        onError(error) { timeoutEvents.push(error.code); },
        onClosed() { timeoutEvents.push('closed'); },
      },
    }), true);
    expireSession();
    assert.deepEqual(timeoutEvents, ['LIVE_SESSION_TIMEOUT', 'closed']);
    assert.equal(timedTrack.stopped, true);
    assert.equal(timeoutVoice.isConversationActive, false);
    assert.match(app, /error\.code === 'LIVE_SESSION_TIMEOUT'[\s\S]*?state\.liveReconnectWanted = false/);
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});