function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function dampMouthOpening(current, target, deltaMs) {
  const from = clamp(Number.isFinite(current) ? current : 0, 0, 0.7);
  const to = clamp(Number.isFinite(target) ? target : 0, 0, 0.7);
  const delta = clamp(Number.isFinite(deltaMs) ? deltaMs : 0, 0, 100);
  const timeConstant = to > from ? 35 : 90;
  return from + (to - from) * (1 - Math.exp(-delta / timeConstant));
}

const MOUTH_SHAPES = Object.freeze({
  aa: Object.freeze({ width: 0.96, height: 1 }),
  ee: Object.freeze({ width: 1.08, height: 0.62 }),
  ih: Object.freeze({ width: 0.86, height: 0.56 }),
  oh: Object.freeze({ width: 0.9, height: 0.86 }),
  ou: Object.freeze({ width: 0.7, height: 0.72 }),
  neutral: Object.freeze({ width: 0.98, height: 0.38 }),
});

export function getMouthShape(viseme) {
  return MOUTH_SHAPES[viseme] || MOUTH_SHAPES.neutral;
}

export function estimateMouthCue(word) {
  const normalized = word.toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
  if (!normalized) return { opening: 0, viseme: 'aa' };
  if (!/^\p{Script=Latin}+$/u.test(normalized.replace(/\p{M}/gu, ''))) {
    const viseme = /(?:उ|ऊ|ु|ू)/u.test(normalized) ? 'ou'
      : /(?:ओ|औ|ो|ौ)/u.test(normalized) ? 'oh'
        : /(?:इ|ई|ि|ी)/u.test(normalized) ? 'ih'
          : /(?:ए|ऐ|े|ै)/u.test(normalized) ? 'ee' : 'aa';
    return { opening: /[मबप]/.test(normalized[0]) ? 0.08 : 0.55, viseme };
  }
  if (/[mbp]/.test(normalized[0])) return { opening: 0.08, viseme: 'aa' };
  const firstVowel = normalized.match(/[aeiou]/)?.[0];
  if (firstVowel === 'u') return { opening: 0.5, viseme: 'ou' };
  if (firstVowel === 'o') return { opening: 0.58, viseme: 'oh' };
  if (firstVowel === 'i') return { opening: 0.28, viseme: 'ih' };
  if (firstVowel === 'e') return { opening: 0.36, viseme: 'ee' };
  if (firstVowel === 'a') return { opening: 0.72, viseme: 'aa' };
  return { opening: 0.16, viseme: 'aa' };
}

export function applySpeechBoundaryCue(text, event, onCue) {
  if (!event || (event.name && event.name !== 'word') || typeof onCue !== 'function') return;
  const start = Number.isInteger(event.charIndex) ? event.charIndex : 0;
  const word = text.slice(start, start + (event.charLength || 0))
    || text.slice(start).match(/^[\p{L}\p{N}']+/u)?.[0]
    || '';
  const { opening, viseme } = estimateMouthCue(word);
  onCue(opening, viseme);
}

export function estimateAudioMouthOpening(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  let count = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) continue;
    sum += sample * sample;
    count += 1;
  }
  if (!count) return 0;
  const rms = Math.sqrt(sum / count);
  return clamp((rms - 0.015) * 4, 0, 0.9);
}
