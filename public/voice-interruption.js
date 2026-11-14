// Barge-in: cancels assistant speech when the user starts talking over it.
// Requires several consecutive speech frames so a single noise spike does not cut the reply off.
export function createInterruptionController({ cancelSpeech, onInterrupt = () => {}, framesRequired = 4 } = {}) {
  if (typeof cancelSpeech !== 'function') throw new TypeError('cancelSpeech is required.');
  let assistantSpeaking = false;
  let streak = 0;
  return {
    setAssistantSpeaking(value) { assistantSpeaking = Boolean(value); streak = 0; },
    // Feed each frame from the noise gate ({ speaking }).
    handleFrame(frame) {
      if (!assistantSpeaking) return false;
      streak = frame?.speaking ? streak + 1 : 0;
      if (streak < framesRequired) return false;
      assistantSpeaking = false;
      streak = 0;
      cancelSpeech();
      onInterrupt();
      return true;
    },
  };
}
