// Client for the optional local OmniVoice engine (served through POST /api/tts).
// Everything here degrades to "return false" so the caller can fall back to the
// browser speech engine; nothing reports success unless audio actually played.

const PREFERENCE_KEY = 'jarvis.localTtsEnabled';
const DEFAULT_CHUNK_CHARS = 380;
const REQUEST_TIMEOUT_MS = 120_000;

export function splitForTts(text, maxChars = DEFAULT_CHUNK_CHARS) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  // Sentence enders for English and Hindi (danda), keeping the punctuation.
  const sentences = clean.match(/[^.!?।\n]+[.!?।]*\s*/gu) || [clean];
  const chunks = [];
  let current = '';
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      push();
      for (let index = 0; index < sentence.length; index += maxChars) {
        const part = sentence.slice(index, index + maxChars).trim();
        if (part) chunks.push(part);
      }
      continue;
    }
    if ((current + sentence).length > maxChars) push();
    current += sentence;
  }
  push();
  return chunks;
}

export function readLocalTtsPreference(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(PREFERENCE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeLocalTtsPreference(enabled, storage = globalThis.localStorage) {
  try {
    storage?.setItem(PREFERENCE_KEY, enabled ? '1' : '0');
  } catch {
    // Storage can be blocked; the preference then lasts for this page only.
  }
}

export function createLocalTts({
  fetchImpl = (...args) => globalThis.fetch(...args),
  AudioConstructor = globalThis.Audio,
  urlApi = globalThis.URL,
  AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext,
} = {}) {
  let available = false;
  let session = 0;
  let activeAudio = null;
  let activeUrl = '';
  let levelTimer = null;
  let audioContext = null;

  function release() {
    if (levelTimer) clearInterval(levelTimer);
    levelTimer = null;
    if (activeAudio) {
      try { activeAudio.pause(); } catch { /* already stopped */ }
      activeAudio.onended = null;
      activeAudio.onerror = null;
    }
    activeAudio = null;
    if (activeUrl) urlApi.revokeObjectURL(activeUrl);
    activeUrl = '';
  }

  async function fetchChunk(text, language, headers, signal) {
    const response = await fetchImpl('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ text, language }),
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      const error = new Error(`Local voice request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('Local voice returned empty audio.');
    return blob;
  }

  function watchLevel(audio, onLevel) {
    if (!onLevel || !AudioContextConstructor) return;
    try {
      audioContext ||= new AudioContextConstructor();
      const source = audioContext.createMediaElementSource(audio);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(audioContext.destination);
      const data = new Uint8Array(analyser.fftSize);
      levelTimer = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) sum += ((value - 128) / 128) ** 2;
        onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      }, 70);
    } catch {
      // Level metering is cosmetic; playback continues without it.
    }
  }

  function playBlob(blob, mySession, { onStart, onLevel }) {
    return new Promise((resolve, reject) => {
      if (mySession !== session) { resolve(false); return; }
      activeUrl = urlApi.createObjectURL(blob);
      const audio = new AudioConstructor(activeUrl);
      activeAudio = audio;
      audio.onended = () => resolve(true);
      audio.onerror = () => reject(new Error('Local voice audio could not be played.'));
      watchLevel(audio, onLevel);
      Promise.resolve(audio.play()).then(() => {
        if (mySession === session) onStart?.();
      }).catch(reject);
    });
  }

  return {
    get available() { return available; },
    setAvailable(value) { available = Boolean(value); },
    stop() {
      session += 1;
      release();
    },
    /**
     * Speaks `text` chunk by chunk. Resolves true when everything played,
     * false when it was stopped, and rejects before any audio started so the
     * caller can fall back to another voice. After audio started, a later
     * failure resolves false (no replay of already-spoken text).
     */
    async speak(text, { language = 'en', headers = {}, onStart, onLevel } = {}) {
      const chunks = splitForTts(text);
      if (!chunks.length) return false;
      const mySession = ++session;
      release();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let started = false;
      try {
        let pending = fetchChunk(chunks[0], language, headers, controller.signal);
        for (let index = 0; index < chunks.length; index += 1) {
          const blob = await pending;
          if (mySession !== session) return false;
          if (index + 1 < chunks.length) {
            pending = fetchChunk(chunks[index + 1], language, headers, controller.signal);
            pending.catch(() => {});
          }
          const finished = await playBlob(blob, mySession, {
            onStart: () => {
              if (!started) { started = true; onStart?.(); }
            },
            onLevel,
          });
          release();
          if (!finished) return false;
        }
        return true;
      } catch (error) {
        release();
        if (mySession !== session) return false;
        if (started) return false;
        throw error;
      } finally {
        clearTimeout(timeout);
        if (mySession === session) controller.abort();
      }
    },
  };
}
