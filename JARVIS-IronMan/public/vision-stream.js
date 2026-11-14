// Bounded, user-started continuous vision. Samples still frames at a fixed interval and sends each to an
// analyzer one at a time. Never starts by itself; always has a frame budget, a time limit and a stop().
export const VISION_STREAM_LIMITS = Object.freeze({
  minIntervalMs: 2_000,
  defaultIntervalMs: 5_000,
  maxFrames: 30,
  defaultFrames: 12,
  maxDurationMs: 5 * 60_000,
});

export function createVisionStream({ capture, analyze, onResult = () => {}, onStatus = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now() } = {}) {
  if (typeof capture !== 'function' || typeof analyze !== 'function') throw new TypeError('capture and analyze functions are required.');
  let controller = null;
  let timer = null;
  let state = { running: false, frames: 0, reason: 'idle' };

  function publish(patch) {
    state = { ...state, ...patch };
    onStatus({ ...state });
  }

  function stop(reason = 'stopped') {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (controller) { controller.abort(); controller = null; }
    if (state.running) publish({ running: false, reason });
  }

  function start({ intervalMs = VISION_STREAM_LIMITS.defaultIntervalMs, maxFrames = VISION_STREAM_LIMITS.defaultFrames, prompt = 'Describe what changed.', userConfirmed = false } = {}) {
    if (userConfirmed !== true) throw new Error('Continuous vision needs explicit user confirmation.');
    if (state.running) throw new Error('Continuous vision is already running.');
    const interval = Math.max(VISION_STREAM_LIMITS.minIntervalMs, Math.min(Number(intervalMs) || VISION_STREAM_LIMITS.defaultIntervalMs, 60_000));
    const budget = Math.max(1, Math.min(Math.floor(Number(maxFrames) || VISION_STREAM_LIMITS.defaultFrames), VISION_STREAM_LIMITS.maxFrames));
    const startedAt = now();
    controller = new AbortController();
    const { signal } = controller;
    state = { running: true, frames: 0, reason: 'running' };
    onStatus({ ...state });

    const tick = async () => {
      timer = null;
      if (signal.aborted) return;
      if (state.frames >= budget) { stop('frame-budget-reached'); return; }
      if (now() - startedAt >= VISION_STREAM_LIMITS.maxDurationMs) { stop('time-limit-reached'); return; }
      try {
        const frame = await capture({ signal });
        if (signal.aborted) return;
        const text = await analyze({ frame, prompt, signal });
        if (signal.aborted) return;
        publish({ frames: state.frames + 1 });
        onResult({ index: state.frames, text });
      } catch (error) {
        if (signal.aborted) return;
        stop(`error: ${error?.message || 'capture failed'}`);
        return;
      }
      if (!signal.aborted) timer = setTimer(tick, interval);
    };
    timer = setTimer(tick, 0);
    return { stop };
  }

  return { start, stop, getState: () => ({ ...state }) };
}
