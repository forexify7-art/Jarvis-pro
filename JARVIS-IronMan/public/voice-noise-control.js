// Noise gate + voice-activity detection on RMS levels (0..1). Adapts to the room's noise floor.
export function computeRms(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function createNoiseGate({ margin = 2.5, minThreshold = 0.015, holdFrames = 6, adaptRate = 0.05 } = {}) {
  let floor = minThreshold / margin;
  let hold = 0;
  let speaking = false;

  return {
    // Feed one audio frame's RMS; returns whether speech is currently detected.
    update(rms) {
      const threshold = Math.max(minThreshold, floor * margin);
      if (rms >= threshold) {
        speaking = true;
        hold = holdFrames;
      } else if (hold > 0) {
        hold -= 1;
      } else {
        speaking = false;
        floor += (rms - floor) * adaptRate; // learn background noise only while silent
      }
      return { speaking, level: rms, threshold: Math.max(minThreshold, floor * margin) };
    },
    reset() { floor = minThreshold / margin; hold = 0; speaking = false; },
  };
}

// Connects a MediaStream to the gate. Needs microphone permission and a browser AudioContext.
export async function startMicrophoneMonitor({ onFrame, mediaDevices = globalThis.navigator?.mediaDevices, AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext, gate = createNoiseGate() }) {
  if (!mediaDevices?.getUserMedia || !AudioContextClass) {
    throw new Error('Microphone monitoring is not supported in this browser.');
  }
  const stream = await mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const context = new AudioContextClass();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buffer);
    onFrame(gate.update(computeRms(buffer)));
  }, 50);
  return {
    stop() {
      clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      context.close?.();
    },
  };
}
