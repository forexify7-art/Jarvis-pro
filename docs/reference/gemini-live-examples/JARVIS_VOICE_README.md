# J.A.R.V.I.S. – Voice Resources (Gemini Live API)

This folder contains the voice/audio-related examples extracted from the supplied
`gemini-live-api-examples-main.zip`.

## Included implementations

1. `gemini-live-genai-python-sdk/` – Full browser + Python/FastAPI example.
   - `frontend/media-handler.js`: microphone capture and audio playback
   - `frontend/pcm-processor.js`: PCM AudioWorklet processing
   - `frontend/gemini-client.js`: browser WebSocket client
   - `gemini_live.py` and `main.py`: backend Live API session handling
2. `gemini-live-ephemeral-tokens-websocket/` – Vanilla JS browser client using
   short-lived/ephemeral tokens, audio worklets, and direct WebSocket streaming.
3. `command-line/node/` – Node.js microphone streaming and spoken responses.
4. `command-line/python/` – Python microphone streaming, playback, and a
   real-time audio translation example.

## J.A.R.V.I.S. integration status

- The app voice feature is integrated through `voice/gemini-live.js`,
  `voice/live-audio-processor.js`, `voice/speech-input.js`, `public/app.js`,
  and the server-side `/api/live-token` route.
- Gemini Live uses a short-lived token created by the Node server. Browser
  speech recognition and synthesis fallback remain available.
- The examples in this folder are still **reference implementations**, not
  runtime dependencies of J.A.R.V.I.S. Their standalone UIs and Python
  backends are not started by the main app.
- Browser/device microphone, speaker, model-access, and permission checks still
  require testing on the target device.

## Security and maintenance

- Do not overwrite your existing J.A.R.V.I.S. files blindly. Keep a Git backup
  and compare the code first.
- Never put a permanent `GEMINI_API_KEY` in browser JavaScript or commit it to
  Git. Keep it on the server in an environment variable. The ephemeral-token
  example demonstrates a short-lived-token pattern.
- Check the model names, API version, supported voice names, and SDK versions
  against current Gemini Live API documentation before running; examples may
  change over time.
- The command-line examples are for local testing, not production deployment.
- Use headphones while testing to reduce microphone/speaker feedback.

## Suggested starting point for J.A.R.V.I.S.

For a web-based J.A.R.V.I.S. app with an existing HTML/CSS/JavaScript frontend
and a Node.js server, first study:
- `gemini-live-ephemeral-tokens-websocket/frontend/audio-processors/`
- `gemini-live-ephemeral-tokens-websocket/frontend/mediaUtils.js`
- `gemini-live-ephemeral-tokens-websocket/frontend/geminilive.js`
- `gemini-live-ephemeral-tokens-websocket/server.py`

If you prefer a Python backend, study the complete
`gemini-live-genai-python-sdk/` example instead. Do not combine both backend
architectures without a deliberate design decision.

## File inventory

- `README.md`\n- `command-line/node/README.md`\n- `command-line/node/main.mts`\n- `command-line/node/mic.d.ts`\n- `command-line/node/package-lock.json`\n- `command-line/node/package.json`\n- `command-line/node/tsconfig.json`\n- `command-line/python/README.md`\n- `command-line/python/main.py`\n- `command-line/python/translate.py`\n- `gemini-live-ephemeral-tokens-websocket/.env.example`\n- `gemini-live-ephemeral-tokens-websocket/.gitignore`\n- `gemini-live-ephemeral-tokens-websocket/README.md`\n- `gemini-live-ephemeral-tokens-websocket/frontend/audio-processors/capture.worklet.js`\n- `gemini-live-ephemeral-tokens-websocket/frontend/audio-processors/playback.worklet.js`\n- `gemini-live-ephemeral-tokens-websocket/frontend/geminilive.js`\n- `gemini-live-ephemeral-tokens-websocket/frontend/index.html`\n- `gemini-live-ephemeral-tokens-websocket/frontend/mediaUtils.js`\n- `gemini-live-ephemeral-tokens-websocket/frontend/script.js`\n- `gemini-live-ephemeral-tokens-websocket/frontend/tools.js`\n- `gemini-live-ephemeral-tokens-websocket/pyproject.toml`\n- `gemini-live-ephemeral-tokens-websocket/requirements.txt`\n- `gemini-live-ephemeral-tokens-websocket/server.py`\n- `gemini-live-ephemeral-tokens-websocket/uv.lock`\n- `gemini-live-genai-python-sdk/.dockerignore`\n- `gemini-live-genai-python-sdk/.env.example`\n- `gemini-live-genai-python-sdk/.gitignore`\n- `gemini-live-genai-python-sdk/Dockerfile`\n- `gemini-live-genai-python-sdk/README.md`\n- `gemini-live-genai-python-sdk/deployment_cloud_run.md`\n- `gemini-live-genai-python-sdk/frontend/gemini-client.js`\n- `gemini-live-genai-python-sdk/frontend/index.html`\n- `gemini-live-genai-python-sdk/frontend/main.js`\n- `gemini-live-genai-python-sdk/frontend/media-handler.js`\n- `gemini-live-genai-python-sdk/frontend/pcm-processor.js`\n- `gemini-live-genai-python-sdk/frontend/style.css`\n- `gemini-live-genai-python-sdk/gemini_live.py`\n- `gemini-live-genai-python-sdk/main.py`\n- `gemini-live-genai-python-sdk/requirements.txt`\n- `gemini-live-genai-python-sdk/twilio_handler.py`