# Voice and wake-word specification

## User experience
- Push-to-talk is the default.
- Hands-free/wake-word mode is opt-in per device.
- A persistent microphone indicator and one-tap mute/stop are mandatory.
- User can interrupt speech at any time.
- Hindi and English can be selected independently for recognition and response.
- Captions/transcript are visible and user-controllable.

## Technical behavior
- Use a voice-session state machine: idle, requesting_permission, listening, processing, speaking, interrupted, error.
- Every session has a timeout and cancellation token.
- Wake-word detection should be local where feasible; do not stream continuous raw audio to a cloud provider just to detect the wake word.
- Send only the minimum audio required after activation.
- Provide clear fallback when microphone, network, or TTS engine is unavailable.
- Do not retain raw audio by default.

## Tests
- Permission denied; permission revoked mid-session.
- Mute during listening; stop during TTS.
- Hindi/English switching.
- Network loss and reconnect.
- Duplicate wake activation; false activation handling.
- Background/resume on Android.
