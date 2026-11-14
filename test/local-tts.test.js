import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalTts, readLocalTtsPreference, splitForTts, writeLocalTtsPreference } from '../public/local-tts.js';

function makeEnvironment({ responses, playBehaviour = 'play' } = {}) {
  const calls = [];
  const played = [];
  const revoked = [];
  class FakeAudio {
    constructor(url) { this.url = url; this.paused = false; played.push(url); }
    play() {
      if (playBehaviour === 'blocked') return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
      queueMicrotask(() => this.onended?.());
      return Promise.resolve();
    }
    pause() { this.paused = true; }
  }
  let urlCounter = 0;
  const urlApi = {
    createObjectURL: () => `blob:fake-${++urlCounter}`,
    revokeObjectURL: (url) => revoked.push(url),
  };
  let index = 0;
  const fetchImpl = async (path, options) => {
    calls.push({ path, body: JSON.parse(options.body), headers: options.headers });
    const next = responses[Math.min(index++, responses.length - 1)];
    if (next instanceof Error) throw next;
    if (typeof next === 'number') return { ok: false, status: next, blob: async () => new Blob([]) };
    return { ok: true, status: 200, blob: async () => new Blob([next]) };
  };
  return { calls, played, revoked, tts: createLocalTts({ fetchImpl, AudioConstructor: FakeAudio, urlApi, AudioContextConstructor: null }) };
}

test('splitForTts keeps sentences whole, handles Hindi danda and hard-splits long runs', () => {
  assert.deepEqual(splitForTts(''), []);
  assert.deepEqual(splitForTts('Hello. How are you?'), ['Hello. How are you?']);
  const chunks = splitForTts('एक वाक्य है। दूसरा वाक्य है। तीसरा वाक्य है।', 20);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 20));
  assert.equal(chunks.join(' ').replace(/\s+/g, ''), 'एकवाक्यहै।दूसरावाक्यहै।तीसरावाक्यहै।');
  const long = splitForTts('a'.repeat(1000), 380);
  assert.deepEqual(long.map((chunk) => chunk.length), [380, 380, 240]);
});

test('speak requests each chunk from /api/tts, plays them in order and reports started once', async () => {
  const { tts, calls, played, revoked } = makeEnvironment({ responses: ['a', 'b'] });
  let starts = 0;
  const finished = await tts.speak(`${'First sentence here. '.repeat(10)}${'Second sentence there. '.repeat(10)}`, {
    language: 'hi',
    headers: { authorization: 'Bearer t' },
    onStart: () => { starts += 1; },
  });
  assert.equal(finished, true);
  assert.equal(starts, 1);
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((call) => call.path === '/api/tts' && call.body.language === 'hi' && call.headers.authorization === 'Bearer t'));
  assert.equal(played.length, calls.length);
  assert.deepEqual(revoked, played, 'every object URL is released');
});

test('speak rejects (so the caller can fall back) when the server is unavailable before any audio', async () => {
  for (const response of [503, new Error('network down')]) {
    const { tts } = makeEnvironment({ responses: [response] });
    await assert.rejects(() => tts.speak('Hello world.'), (error) => error instanceof Error);
  }
});

test('speak rejects when the browser blocks autoplay, instead of pretending success', async () => {
  const { tts } = makeEnvironment({ responses: ['a'], playBehaviour: 'blocked' });
  await assert.rejects(() => tts.speak('Hello world.'), { name: 'NotAllowedError' });
});

test('a failure after audio started resolves false and does not request a replay', async () => {
  const { tts } = makeEnvironment({ responses: ['a', 503] });
  let starts = 0;
  const finished = await tts.speak(`${'Sentence number one is here. '.repeat(15)}`, { onStart: () => { starts += 1; } });
  assert.equal(starts, 1);
  assert.equal(finished, false);
});

test('stop cancels playback and resolves false', async () => {
  const environment = makeEnvironment({ responses: ['a'] });
  const pending = environment.tts.speak('Hello world.');
  environment.tts.stop();
  assert.equal(await pending, false);
});

test('preference defaults to enabled and survives blocked storage', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readLocalTtsPreference(storage), true);
  writeLocalTtsPreference(false, storage);
  assert.equal(readLocalTtsPreference(storage), false);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readLocalTtsPreference(blocked), true);
  assert.doesNotThrow(() => writeLocalTtsPreference(true, blocked));
});
