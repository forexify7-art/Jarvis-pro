# J.A.R.V.I.S. — final audit report (2026-11-07)

## Current Re-audit Snapshot (2026-11-08)

The newer implementation/report state is in `FEATURE_COMPLETION_MATRIX.md` and `FINAL_CERTIFICATION_REPORT.md`: **60.65% complete (61% rounded), 39.35% remaining**, with current test counts and caveats in the matrix. Google Workspace and Telegram connectors are implemented and mock-tested, but not live-verified. Browser E2E is blocked locally by missing host libraries; CI now installs those dependencies but has not run. Windows installer CI is configured but unexecuted, and Android still needs native toolchains/device verification. This file's sections below remain the dated 2026-11-07 historical report.

Work was done on a copy; the original ZIPs were not modified. No network was available in the audit
sandbox, so `npm install`, `pip install`, crates.io and model downloads could not run (see "Not tested").

## 1. Files removed (2) and why
| File | Reason |
| --- | --- |
| `public/5234e417739a8221c0d6ce9c25d690ff69dd8de1860b0b9394bad1a30df599e4.png` (2.2 MB) | Hash-named screenshot; referenced by no HTML, CSS, JS, test or doc. |
| `public/ai-avatar.jpg` (64 KB) | Not used by any page (tests assert the HTML no longer references it); the live portrait is `jarvis-portrait.webp`. |

## 2. Files moved (nothing else was deleted)
| From | To | Reason |
| --- | --- | --- |
| `HANDOFF.md`, `HANDOVER.md`, `PROJECT_HANDOFF.md` | `docs/handoff/` | Three overlapping handoff notes cluttered the root; content kept. |
| `voice/gemini-live-genai-python-sdk/`, `voice/gemini-live-ephemeral-tokens-websocket/`, `voice/command-line/`, `voice/README.md`, `voice/JARVIS_VOICE_README.md` | `docs/reference/gemini-live-examples/` | Reference samples that are not runtime code (their own docs say so); they were also publicly downloadable through `/voice/`. |

Kept on purpose: `browser/` (vendored Browser Use, used by the optional Browser Research feature), the Electron shell, all tests, licences, `.vscode`, `.devcontainer`.
Kept but unused by the UI as documented in the README: the agent-core modules.

## 3. Bugs / vulnerabilities fixed
1. **Security:** `/voice/*` served the entire voice folder (Python sources, `.env.example`, lock files). Now an allowlist of three modules.
2. **Packaging bug:** the Electron installer did not include `voice/*.js`, so the packaged desktop app would fail to load `app.js` (404 on `/voice/gemini-live.js`). Added to `build.files`.
3. **Offline/PWA:** five modules imported by `app.js` (`api-response`, `chat-context`, `focus-timer`, `voice/speech-input`, plus new ones) were missing from the service-worker shell; added, cache bumped to `v97`. (`avatar-cues.js` stays out because an existing test deliberately keeps it out.)
4. **Rate limiting behind a proxy:** all visitors shared the proxy's IP. Opt-in `TRUST_PROXY=1` (set in `render.yaml`).
5. **Cross-origin apps:** no CORS existed, so a packaged app could not call the server. Strict allowlist added.
6. **Voice without `speechSynthesis`:** the Preview Voice button and voice toggle refused to work when only a neural engine was available; fixed.
7. Service worker no longer registers inside the native Tauri shell (stale-cache risk).

## 4. Features integrated
- OmniVoice local TTS (Hindi + English): Python sidecar, `/api/tts`, client player with chunking, lip-sync level, settings toggle, health detection, three-level fallback.
- Tauri 2 project (`src-tauri/`): minimal capability set (no native APIs for the web UI), strict CSP, staged frontend, Android manifest patch script, runtime API-base selection.
- One-click launchers (`run-jarvis.bat/.sh`, `run-omnivoice.bat`) and `START_HERE.md`.
- 25 new Node tests (`tts-server`, `local-tts`, `runtime-config`, `tauri-config`) + 5 Python tests for the sidecar protocol (`test/omnivoice_server_test.py`, stub engine).

## 5. Verification actually performed
- `node --test`: 323 tests (298 originally); 322 pass. The one failure, `test/avatar3d.test.js`, needs the `three` package (not installable offline) — it failed identically on the untouched original.
- Real Chromium end-to-end run (Playwright) against the real Node server and a **stand-in** OmniVoice server returning a generated WAV: page loads without errors; Settings detects the engine; Preview Voice calls `/api/tts`, the audio element plays and ends; the toggle stops further requests; when the engine is killed the call returns 503, the UI marks it unavailable and falls back; no horizontal overflow at 390 px width.
- `tauri.conf.json` and the capability file validate against the Tauri 2.12 JSON schema from the supplied source; Rust files pass `rustfmt --check`.

## 6. NOT tested / needs your configuration
- **The real OmniVoice model was never run** (needs PyTorch + a multi-GB Hugging Face download). Only the protocol around it is tested. Speed on CPU-only or 4 GB RAM PCs is unknown and likely too slow — keep it off there (the app works without it).
- **Tauri was not compiled** (no crates.io access, no Windows/Android toolchain). Android additionally needs Android Studio SDK/NDK and `npm run tauri:android:init`. Android System WebView has no Web Speech *recognition*, so voice input in the APK needs Gemini Live (mic permission is patched in) or use the Chrome PWA instead; this must be tried on a device.
- Gemini/Ollama calls with real keys, Gemini Live audio, microphone/speech recognition, wake word, Android audio routing, `npm run desktop:dist` (Electron build), Playwright suites in `browser-tests/`, `npm run build:avatar` (needs `npm install`).
- `npm install` will regenerate nothing in `package-lock.json` (no dependency was added; Tauri CLI is run through `npx`).
- Hindi OmniVoice quality is documented by the model authors but unverified here.
