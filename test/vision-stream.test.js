import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVisionStream, VISION_STREAM_LIMITS } from '../public/vision-stream.js';

function harness(over = {}) {
  let clock = 0; const timers = []; const results = []; const statuses = [];
  const stream = createVisionStream({
    capture: async () => 'frame', analyze: async () => 'ok', onResult: (r) => results.push(r), onStatus: (s) => statuses.push(s),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}, now: () => clock, ...over,
  });
  const step = async () => { const t = timers.pop(); await t.fn(); };
  return { stream, timers, results, statuses, step, advance: (ms) => { clock += ms; } };
}

test('never starts without explicit user confirmation', () => {
  const { stream } = harness();
  assert.throws(() => stream.start({}), /explicit user confirmation/);
  assert.throws(() => stream.start({ userConfirmed: 'yes' }), /explicit user confirmation/);
});

test('enforces minimum interval and frame budget, then stops itself', async () => {
  const h = harness();
  h.stream.start({ userConfirmed: true, intervalMs: 1, maxFrames: 2 });
  await h.step();
  assert.equal(h.timers.at(-1).ms, VISION_STREAM_LIMITS.minIntervalMs);
  await h.step(); await h.step();
  assert.equal(h.results.length, 2);
  assert.equal(h.stream.getState().running, false);
  assert.equal(h.stream.getState().reason, 'frame-budget-reached');
});

test('caps absurd frame budgets and stops at the time limit', async () => {
  const h = harness();
  h.stream.start({ userConfirmed: true, maxFrames: 10_000 });
  await h.step();
  h.advance(VISION_STREAM_LIMITS.maxDurationMs);
  await h.step();
  assert.equal(h.stream.getState().reason, 'time-limit-reached');
});

test('stop() aborts an in-flight analysis and discards its result', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const h = harness({ analyze: async () => { await gate; return 'late'; } });
  h.stream.start({ userConfirmed: true });
  const pending = h.step();
  h.stream.stop('user-stopped');
  release(); await pending;
  assert.equal(h.results.length, 0);
  assert.equal(h.stream.getState().reason, 'user-stopped');
  assert.equal(h.timers.length, 0);
});

test('a capture error stops the stream with a reason and does not overlap runs', async () => {
  const h = harness({ capture: async () => { throw new Error('camera lost'); } });
  h.stream.start({ userConfirmed: true });
  await h.step();
  assert.match(h.stream.getState().reason, /camera lost/);
  assert.throws(() => { h.stream.start({ userConfirmed: true }); h.stream.start({ userConfirmed: true }); }, /already running/);
});
