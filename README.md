# J.A.R.V.I.S. Personal Assistant

A cross-platform assistant with a responsive holographic interface, local conversation history, Gemini Live streaming voice with browser speech fallback, source-linked web lookup, and optional local or hosted AI. The existing Node-served web app can be used in a browser or installed as a PWA, and an optional Electron shell can be packaged as a Windows desktop installer.

The Three.js renderer is loaded only when **Activate 3D Avatar**, **Activate Holographic Earth**, or **Load Custom Avatar** is selected. The built-in projections are procedural and use no remote model, texture, or paid service. **Load Custom Avatar** accepts self-contained `.vrm` or `.glb` files up to 20 MB, parses them locally, and requires a recognized mouth or speech-expression rig; invalid and unsupported files leave the portrait or current projection available and report an error.

The original conversation interface remains the default for new users. Use **New Interface** in the header to open the optional sci-fi dashboard, and **Old Interface** to return to the original conversation view. The selected interface is remembered in this browser. Both use the same chat, voice, provider settings, and backend. The dashboard has desktop status/chat/voice panels, a responsive mobile stack, and a six-action feature dock. CPU, RAM, and storage values are measurements from the app server/container, not necessarily the user's device; unavailable values are not estimated. The dashboard uses the transparent female portrait at `public/jarvis-portrait.png` above the independently rendered holographic Earth; orbital rings, projection platform, and energy beam remain separate stage layers. **Activate 3D Avatar** loads the optional procedural bust; **Activate Holographic Earth** keeps the portrait visible in front of the local procedural Earth. **Load Custom Avatar** opens the local VRM/GLB picker. The portrait image is unchanged; lightweight overlays provide staged blinking and approximate mouth movement during speech, then return to the normal portrait when speech ends. This is not phoneme-accurate lip sync. Reduced-motion preferences disable portrait animation. The static portrait remains visible if WebGL or projection initialization fails. The current interface does not include a tab-audio sync control.

Choose **English** or **Hindi** in Settings to set the language for conversation replies, voice recognition, and conversational search. The preference is saved with this browser's local preferences and restored after reload; application labels and other interface sections remain in English. User-entered content, source-provided headlines and excerpts, URLs, and technical values are not translated.

The dashboard's **News & Briefing** panel and Search results show only source-backed information returned by the available search sources. A displayed headline requires a title and source; source, publication date, and excerpt are shown only when supplied in the result data. Missing dates or excerpts are omitted, duplicate titles are filtered, and an article link is shown only when its URL is a valid HTTP(S) address. Missing or invalid links do not become clickable links. The interface does not invent headlines, sources, dates, or summaries.

The **JARVIS APP HUB** is available in both interfaces. It provides browser-local app shortcuts, search, editing, reordering, deletion, optional raster icon uploads, and a URL Runner. It accepts HTTP/HTTPS destinations, explicit Android `intent://` app links, `tel:` dialer links, and `sms:` message-draft links. Android app links require Full Access; dialer and message links are explicit user actions that ask the browser/OS to hand off, where the user reviews and confirms. In the Electron desktop shell, the Open action can request an HTTPS, dialer, or message link through a narrow, validated IPC bridge; Android `intent://` links remain unsupported there. The browser or operating system may block or fail to confirm a handoff. **Copy text** copies only the text currently entered in URL Runner after you click it. In Electron this uses a bounded, write-only clipboard IPC; in browsers it uses the browser clipboard API when available. J.A.R.V.I.S. does not read the clipboard, place calls, or send messages, and requests no call/SMS permissions. The app cannot detect arbitrary installed apps, execute APKs/native applications, run shell commands, or control the desktop generally. Shortcuts and uploaded icons remain in that browser's local storage.

The Productivity focus timer stores its remaining time and optional active task reference in browser-local storage. A running timer accounts for elapsed wall-clock time after reload or reopening; a paused timer resumes from its saved remaining time. If local storage is unavailable or invalid, the timer falls back to a fresh session-only timer.

**JARVIS Vision** offers the browser's explicit screen picker and a separate **Use camera** action after you choose Vision. Camera capture requests video only (`audio: false`), displays the browser camera indicator while active, captures one frame locally, and stops its camera track before showing the preview. Screen and camera frames are sent only after you enter a question and choose **Send to J.A.R.V.I.S.** The JPEG is limited to 1280 pixels on its longest side and 500 KB. Closing the dialog, disabling Full Access, or pressing **Emergency Stop** stops capture, cancels an active request, and clears the local preview. There is no background camera recording or continuous video analysis, and Vision requests are not automatically retried.

The same web app can be used in a browser, installed as a PWA, or run in the optional Windows desktop shell. The UI and server features are shared; browser history, preferences, and locally selected avatar files remain on each device and are not synchronized. Optional Google Workspace, Telegram, and Facebook Messenger actions are configured by the server administrator and appear in Settings; provider secrets and refresh tokens never enter browser storage.

The project includes server-side Gemini, Ollama, and OpenAI-compatible provider integrations. Provider calls are routed through the selected adapter; browser/device validation remains a separate pending step.

## Run locally

Requires Node.js 22.12 or newer. Install dependencies once:

```sh
npm install
npm start
```

Open `http://localhost:4173`. To run the checks:

```sh
npm test
npm run check
```

### Set up from GitHub in another account

Sign in to GitHub with an account that has access to this repository. Replace `OWNER` below with the repository owner's name, or copy the HTTPS clone URL from the repository's **Code** menu. Do not put a username, password, personal access token, or other credential in the clone URL.

```sh
git clone https://github.com/OWNER/Jarvis-by-khan.git
cd Jarvis-by-khan
npm ci
npm start
```

J.A.R.V.I.S. requires Node.js 22.12 or newer. `npm ci` installs the exact dependency versions recorded in `package-lock.json`; `npm start` serves the app at `http://localhost:4173`. On Windows, use `npm run desktop` for the Electron shell after installing dependencies.

Provider credentials are not copied with the repository. For Gemini, copy `.env.example` to `.env`, enter the key once as `GEMINI_API_KEY`, then run `npm start`; the Node server reads the local file and the browser never accepts or stores the key. Keep `.env` private and untracked. For deployment, set `GEMINI_API_KEY` in the hosting platform's secret manager. The remaining provider settings support OpenAI-compatible services and Ollama. Ollama must be installed and running at an endpoint reachable by the Node server.

For API-free desktop Chromium and Android-sized mobile UI integration tests, install the Playwright browser once and run:

```sh
npx playwright install chromium
npm run test:browser
```

The browser suite mocks all `/api/*` responses locally and blocks external requests. Run only one viewport project with `npm run test:browser:desktop` or `npm run test:browser:mobile`. These commands are test setup instructions, not a claim that browser/device testing has passed.

GitHub Actions runs the Node and Python suites, dependency audit, build checks, and both Chromium viewport projects with the required Linux libraries. A separate Windows runner builds an **unsigned** Electron NSIS installer and uploads it as a short-lived workflow artifact. The workflow is stored at `.github/workflows/ci.yml`; successful remote workflow execution and Windows installer QA are still required before claiming those gates passed.

The Python sidecar tests can be run without starting a service:

```sh
python3 -m unittest discover -s test -p 'browser_service_test.py'
python3 -m unittest discover -s test -p 'omnivoice_server_test.py'
```

### Home Assistant

The optional Home Assistant integration reads only entities explicitly allowlisted by the server administrator. Control is disabled unless a separate light/switch allowlist is configured. Copy these settings from `.env.example` into the server's private `.env` or deployment secret configuration:

```dotenv
HOME_ASSISTANT_URL=http://homeassistant.local:8123
HOME_ASSISTANT_TOKEN=your_dedicated_revocable_home_assistant_token
HOME_ASSISTANT_ENTITIES=sensor.living_room_temperature,light.office
HOME_ASSISTANT_CONTROL_ENTITIES=light.office
```

Use a dedicated, revocable Home Assistant token and restrict it to the minimum access available for your installation. Keep `.env` private; the token is never accepted by the browser or returned by the API. The URL must be an origin with no path or credentials. On a trusted private network, Home Assistant may use HTTP; use HTTPS when crossing an untrusted network. Status reads support allowlisted `sensor`, `binary_sensor`, `light`, and `switch` entities, with a maximum of 50 IDs. The optional control allowlist supports only explicit light/switch `turn_on` or `turn_off` actions. Settings asks for confirmation showing the entity and target state, then verifies the resulting state. In Settings, choose **Refresh entities**. If `APP_ACCESS_TOKEN` protects the J.A.R.V.I.S. server, enter that separate key in Settings first.

This integration does not discover all Home Assistant entities. Do not include locks, alarms, garage doors, covers, or safety-critical devices in either allowlist. A live Home Assistant instance was not configured or tested in this workspace; automated tests use a local mock upstream.

### Google Workspace

The optional Gmail/Calendar connector uses server-side Google OAuth. Configure the OAuth Web client, redirect URI, consent screen, and encryption key as described in [`START_HERE.md`](START_HERE.md#gmail-and-calendar--optional). In Settings, Google Workspace can create Gmail drafts (it never sends email), read a bounded upcoming-event range, and create calendar events only after a confirmation prompt. Tokens are encrypted on the server and removed when you disconnect. No live Google account was configured or tested here; automated tests use mocked Google endpoints.

### Telegram

The optional Telegram connector sends plain-text messages only to numeric chat IDs in the server's `TELEGRAM_ALLOWED_CHAT_IDS` list. Keep `TELEGRAM_BOT_TOKEN` in the server's `.env` or deployment secrets, never in the browser. The Settings panel displays only that allowlist and asks for confirmation with the selected chat and message before sending. The server limits sends to three per minute. Configure a bot with Telegram's BotFather, add only chats you control, then restart JARVIS. No live Telegram bot or recipient was configured or tested here.

### Facebook Messenger

The optional connector sends plain-text replies through your Facebook Page to numeric Page-scoped recipient IDs explicitly listed in `FACEBOOK_ALLOWED_RECIPIENT_IDS`. Configure `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`, and a Meta-supported `FACEBOOK_GRAPH_API_VERSION` as server secrets; never expose the Page token to the browser. Settings shows the allowlisted recipients and asks you to confirm each exact message; sends are limited to three per minute. The recipient must have messaged the Page within Meta's standard 24-hour messaging window. The integration does not read or monitor inboxes, send unsolicited messages, or implement other message types. A live Meta app/Page has not been configured or verified.

### Read-only live integration checks

Keep credentials in an ignored local `.env` file or the deployment's secret manager; never add real values to `.env.example`, source code, issue reports, or logs. `.env` and Google token storage under `.data/` are excluded from Git. Configure only the integrations you want to check, then run:

```sh
npm run test:integrations:live
```

The command reports `NOT VERIFIED` when required credentials/settings or a connected Google OAuth account are unavailable, `FAIL` when a configured check is rejected or unreachable, and `PASS` only after a read-only upstream check succeeds. It checks Gemini model-list access, one Google Calendar event-list request (maximum one result), Telegram bot identity, Facebook Page identity, and Home Assistant API availability. It does not send messages, create drafts/events, or control devices. Output suppresses upstream bodies and error details. Run it from the server environment that can reach the integrations; Google OAuth must first be connected in Settings.

For GitHub Actions, add repository Actions secrets with these names: `GEMINI_API_KEY`; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `APP_ENCRYPTION_KEY`, and `GOOGLE_TOKEN_STORE_ENC`; `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_CHAT_IDS`; `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `FACEBOOK_GRAPH_API_VERSION`, and `FACEBOOK_ALLOWED_RECIPIENT_IDS`; `HOME_ASSISTANT_URL`, `HOME_ASSISTANT_TOKEN`, and `HOME_ASSISTANT_ENTITIES`. `GOOGLE_TOKEN_STORE_ENC` must contain the already-encrypted `.data/google-workspace.tokens.enc` file, not a raw refresh token; it is materialized with owner-only permissions and removed after the job. Manually dispatch **CI** on a non-main branch to run the live job; regular pushes do not make live requests, and the live job is disabled on `main`. The workflow never prints secret values. A hosted runner must be able to reach the Home Assistant URL, otherwise run the same command from a private server environment that can reach it.

On Linux, Playwright also needs its Chromium system libraries. If the browser exits before tests start, install the libraries using the OS package manager or `npx playwright install --with-deps chromium` in an environment where system package installation is authorized.

### GitHub Codespaces and phone

In a Codespace, start one server with:

```sh
npm run codespaces
```

Port `4173` is configured for automatic forwarding with **Private** visibility. The command prints the Codespaces HTTPS URL and starts the existing Node server, which listens on all interfaces for port forwarding. Do not start `npm start` at the same time; the operating system allows only one server to bind port `4173`, and a second launch now reports that conflict clearly. Codespaces may open the forwarded URL in the browser. Browser refreshes and direct opening of `/` or `/index.html` serve the app shell; service-worker updates take effect without forcing a page reload. To use it on your phone, copy the HTTPS URL from the terminal or the VS Code **Ports** tab. The phone must be signed into an account authorized for this private Codespace. No public deployment or public port visibility is configured.

For Gemini in Codespaces, add a repository-authorized **Codespaces secret** named `GEMINI_API_KEY` in GitHub Settings → Codespaces → Codespaces secrets. Do not put the key in project files or the Settings form. Stop and restart the Codespace after creating or changing the secret; `npm run codespaces` inherits it as an environment variable. `/api/health` then reports `providerSource: "environment"` and `aiConfigured: true` without returning the key. If it reports `"none"`, the secret is not available in this Codespace.

To share from the Settings **Share JARVIS** section, use a public HTTPS address. For an existing Codespace, run `npm run codespaces`, set port `4173` visibility to **Public** in the VS Code **Ports** tab, then open the forwarded HTTPS address and use **Share Link** or **Copy Link**. Public visibility lets anyone with the URL reach the app while the Codespace is running. The server keeps AI provider configuration in shared server memory; configure `APP_ACCESS_TOKEN` before public exposure to prevent anonymous API access. Recipients then need that access key separately, so a link alone is not sufficient for them to use protected APIs. Never put access keys or provider keys in the shared link. The share link contains only the app origin, never API keys, access keys, chat history, or preferences. The app does not deploy itself or change port visibility.

### Persistent deployment on Render

Codespaces is a development environment, not persistent hosting. When a Codespace stops or sleeps, its Node server and forwarded URL stop serving the app; a service-worker cache can show the UI offline but cannot keep `/api/chat` or `/api/search` running. A public Codespaces URL is not a permanent production address.

The root `render.yaml` defines a Render Node web service on the paid **Starter** plan, with `/api/health` as its health check. Render's free web services spin down after inactivity and can take about a minute to wake, so the free plan does not meet the always-on requirement. To deploy:

1. Push the project to the Git branch you want to deploy, making sure required project assets are tracked.
2. In Render, create a **Blueprint** and connect this repository. Review the `jarvis-personal-assistant` service name; change it in `render.yaml` if that Render subdomain is already taken.
3. Enter `GEMINI_API_KEY` when Render requests the unsynchronized secret. It is stored as a Render environment secret, not in this repository. For an existing Render service, set or rotate `GEMINI_API_KEY` in **Dashboard → service → Environment** and deploy/restart the service for it to take effect. Render generates `APP_ACCESS_TOKEN`; keep it private and enter it in **Settings → Server access key** on each browser/device session that will use protected APIs. The app intentionally keeps that access key in memory, not browser storage.
4. Wait for the deployment and health check to pass, then use the service's HTTPS `onrender.com` address. Render keeps this address while the service exists. Automatic deployment from the connected branch keeps it updated when you push changes.

The Render address is different from the Codespaces-forwarded address; a stopped Codespace cannot redirect its old URL. To keep a human-friendly address across hosting changes, configure a domain you own and point its DNS to the active host. Render's paid plan avoids idle spin-down, but is still subject to the provider's operational availability and billing.

J.A.R.V.I.S. stores conversation history and preferences in each browser's local storage, not on the server. They survive reopening the PWA at the same origin, but browser data is not synchronized and changing from a Codespaces origin to Render creates a separate storage area. A key entered in the in-app provider form is temporary server-memory configuration and is lost on restart; the form cannot write deployment secrets. Use the hosting provider's secret/environment settings for persistence. The health endpoint reports only whether AI is configured and whether the source is the process environment or temporary session memory; it never returns the secret. The app does not need a persistent server disk for its current features.

### Install as a PWA

Open the app using its secure Codespaces or Render HTTPS URL; installation is not available from an insecure LAN `http://` address. The app header's install button opens the browser's native prompt when available, or shows these browser-specific steps:

- **Android / Chrome:** tap the app's install button and accept Chrome's prompt. If there is no native prompt, open Chrome's three-dot menu and choose **Install app** or **Add to Home screen**.
- **Windows / Edge:** click the address-bar Apps/install icon, or choose **Settings and more > Apps > Install this site as an app**.
- **Windows / Chrome:** click the address-bar install icon, or choose **More > Cast, save, and share > Install page as app**.
- **iPhone / iPad:** open the HTTPS link in Safari, tap **Share**, then choose **Add to Home Screen**.

The PWA uses 192px/512px PNG icons plus an SVG icon. Its service worker pre-caches the essential app shell, refreshes assets with a bounded network wait, and serves the cached interface when offline or when the host returns a server error. Chat, search, settings saves, and other API calls still need the hosted server and a network connection. Actual install prompts vary by browser version and are not emulated by the app.

### Windows desktop installer

On a Windows PC with Node.js 22.12+ installed, from a project checkout run:

```sh
npm ci
npm run desktop:dist
```

The per-user NSIS installer is written to `dist-desktop/JARVIS-Setup-x64.exe`. It adds Start Menu and desktop shortcuts, uses the existing J.A.R.V.I.S. Windows icon, and preserves local app data when uninstalled. To run the desktop shell without packaging it, use `npm run desktop`. The shell starts the existing server on a random loopback-only port and loads the same app; the website is not publicly exposed by the desktop app. Its sandboxed preload exposes only `openExternalUrl` and `copyText`, requires a current user gesture, and sends requests to main-process validators that check the main frame, local origin, allowed schemes, and payload size. Opening websites uses the OS default browser; clipboard access is write-only and only used for an explicit Copy Link or Copy Text action. Voice recognition is stopped when the desktop window loses focus; wake detection can resume when focus returns only if it remains enabled and microphone permission is not denied. The app does not configure background audio or locked-screen microphone capture. TTS playback may be paused or interrupted by the OS when minimized or unfocused and is not guaranteed to continue. The shell does not expose arbitrary shell commands, unrestricted Node.js APIs, or general filesystem access. Protect any hosted server separately with `APP_ACCESS_TOKEN`. The installer is unsigned, so Windows SmartScreen may show a warning. A Windows installer is built on Windows; it is not produced by running the packaging command in a Codespace/Linux environment.

Before distributing a desktop build, manually verify on the target OS: open a known HTTPS site and confirm it reaches the default browser; try an invalid scheme and confirm it is rejected; use test-only `tel:`/`sms:` destinations and cancel in the dialer/messaging app without placing a call or sending a message; copy non-sensitive text and paste it into a separate app; try blank/oversized text; and confirm OS handoff failures are reported. Also verify in the renderer that `require`, Node globals, and arbitrary IPC channels are unavailable. These desktop/OS checks have not been run in this development environment.

For background lifecycle testing on real devices, enable wake-word mode with microphone permission granted, then switch away, hide the browser/PWA, lock the screen, or minimize Electron. Confirm recognition stops while hidden/unfocused; manual listening stays stopped after returning; wake listening resumes only after return to a visible, focused app while the setting remains enabled and permission is not denied; and denial turns wake mode off without repeated prompts. Minimize/restore should preserve the open Electron window's page state, but it does not provide background or locked-screen microphone/audio service. Locked-screen recognition is not guaranteed. These Android and desktop lifecycle checks have not been performed here.

To inspect UI startup from a phone without DevTools, open the app URL with `?diagnostics=1`. The on-page panel reports JavaScript errors, dashboard visibility and size, the saved interface mode, and whether a service worker controls the page. Remove the query parameter to hide the panel.

### Android native APK

The PWA instructions above do not require a native build. For a Tauri APK, install Rust/Cargo with the `aarch64-linux-android` target, Android Studio with the Android SDK and NDK, platform-tools/ADB, and JDK 17; configure `ANDROID_HOME`/`ANDROID_SDK_ROOT` and `NDK_HOME` as required by the Tauri Android setup. Then run:

```sh
npm install
npm run tauri:android:init
npm run tauri:android:build:debug
```

The debug script builds an unsigned-for-release, debug-signed ARM64 APK. The `Android debug APK` GitHub Actions workflow initializes the generated Android project, adds the app's network, microphone, audio, and camera permissions, verifies the APK archive and `arm64-v8a` native library, then uploads it as the `jarvis-android-arm64-debug` artifact. No API credentials or release-signing credentials are used. The Tauri CLI writes build output under `src-tauri/gen/android/app/build/outputs/apk/`; install the verified APK on a physical device with `adb install <apk-path>` and test microphone/camera prompts, voice stop behavior, network recovery, and background/resume.

## Configure AI

Without a provider, chat responds with HTTP 503 and a clear configuration message. Check `/api/health` to see whether a provider is configured; Ollama reachability and model installation are checked there, while Gemini and OpenAI-compatible connectivity is confirmed by an actual chat request. Open **Settings → AI provider** to configure Google Gemini, Ollama, or an OpenAI-compatible provider and model:

The server reads `.env` on `npm start` with Node's built-in `--env-file-if-exists` option. Copy the example and add your Google AI Studio key:

```sh
cp .env.example .env
# Edit .env and replace GEMINI_API_KEY with your key.
npm start
```

`.env` is ignored by Git. Never commit real credentials. Production hosting should provide `GEMINI_API_KEY` as a deployment secret instead.

- **OpenAI-compatible API:** the form defaults to Google's documented Gemini `gemini-3.8-flash` model and OpenAI-compatible base URL (`https://generativelanguage.googleapis.com/v1beta/openai/`); both are configurable. Enter a provider API key. The key is sent to the Node server, held only in server memory, and never returned to the browser or saved in browser storage. Use a trusted server over HTTPS. In production, configure `APP_ACCESS_TOKEN` before using this form.
- **Google Gemini API:** set `AI_PROVIDER=gemini` and `GEMINI_API_KEY` in `.env` or the server's environment secrets. The Settings UI does not accept Gemini keys. The Node process uses the key for Gemini text/Vision requests and to mint short-lived, single-use Gemini Live session tokens; the permanent key is never sent to or returned by the browser. `AI_MODEL` defaults to `gemini-3.8-flash` for text chat. Live voice uses `gemini-3.8-live`.
- **Ollama (local):** enter the installed model name and a localhost or private-network base URL reachable from the Node server (default `http://127.0.0.1:11434`). Public Ollama URLs are rejected so selecting Ollama cannot route requests to an external provider. The URL and model can be set temporarily in Settings or supplied with `OLLAMA_BASE_URL` and `OLLAMA_MODEL`.

When both `GEMINI_API_KEY` and `OLLAMA_BASE_URL` are set, Gemini is selected by default; set `AI_PROVIDER=ollama` to choose Ollama.

Chat, retries, Study Mode, AI search-result summaries, and Vision send the selected provider with each request. The server rejects a mismatch or unavailable selected provider with an explicit error rather than falling back to another adapter. Search, News, and Briefing retrieval remain source-backed and independent of AI availability; only an explicitly requested result summary uses chat/AI.

OpenAI-compatible and Ollama settings made in the UI apply only until the Node server restarts. Gemini keys are environment-only and cannot be entered in the UI. Use **Use server environment** to return to environment-based configuration.

OpenAI-compatible chat requests have a 45-second provider timeout and make at most two short exponential-backoff retries for transient HTTP 5xx responses. Gemini requests use low reasoning effort to reduce response latency. Timeouts and connection failures are reported without retrying, so a slow request is not multiplied into several long waits.

For local Ollama, run Ollama on a host reachable from this Node server, install a model such as `qwen2.5:3b`, then set:

```sh
OLLAMA_BASE_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen2.5:3b npm start
```

In Codespaces, use `npm run codespaces:ollama` to select `qwen2.5:3b` with the default loopback endpoint without storing credentials. This starts J.A.R.V.I.S.; it does not install or start Ollama or download model weights. The Codespace must have Ollama running locally for chat to succeed.

The Ollama endpoint must be reachable from the Node process. For hosted deployment, `127.0.0.1` refers to the hosted server, not your phone or computer.

For an OpenAI-compatible chat-completions provider, set its credentials only in the server environment. For Gemini, use:

```sh
AI_PROVIDER=gemini GEMINI_API_KEY=your-server-side-key AI_MODEL=gemini-3.8-flash npm start
```

Set `AI_PROVIDER=openai-compatible`, `AI_API_KEY`, and `AI_BASE_URL` to use a different OpenAI-compatible provider. Never put provider keys in `public/`, browser storage, or a public repository. If the app will be reachable by others, set a long random `APP_ACCESS_TOKEN`; the UI accepts it in Settings and holds it only in memory until the tab closes.

## Upgrade 2026-11-07: agent core, files, memory and voice helpers

New dependency-free modules in `public/` (all unit-tested in `test/agent-core.test.js` and `test/files-memory-voice.test.js`):

| Module | What it really does |
| --- | --- |
| `security-permissions.js` | Permission broker. Safe actions run; file/memory/browser actions ask; computer control, deletion and unknown actions ask **every time**. Audit log redacts secrets. |
| `agent-planner.js` | Offline rule-based planner: splits "A then B" requests into steps; unknown requests become a single `ask-ai` step. |
| `agent-engine.js` | Runs a plan: permission -> execute with retry -> verify. Stops at the first denial, failure or unverified result. |
| `error-recovery.js` | Error classification, bounded exponential-backoff retry, optional fallback. |
| `task-verifier.js` | Checks each step's real result; never passes empty output. |
| `file-manager.js` | Reads text/JSON/CSV/MD and ZIP (stored + deflate, path-traversal safe), creates/edits files, writes ZIP, browser download. PDF/DOCX/XLSX are reported as unsupported (no library bundled). |
| `memory-engine.js` | Memory export/import (sensitive-data checks re-applied, imported items start unapproved) and explicit conversation summaries. |
| `voice-noise-control.js` | Adaptive noise gate / voice-activity detection and a microphone monitor. |
| `voice-interruption.js` | Barge-in: cancels assistant speech after sustained user speech. |

Also fixed: the server had no `/api/browser/research` route although the client module, Python service and a test existed. The route is now implemented (auth, 5 requests/minute, public-URL validation, loopback proxy to `browser/jarvis_browser_service.py`). The stale test was updated to the server-only `GEMINI_API_KEY` design.

Agent mode is integrated into the chat UI. It previews multi-step plans, asks for approval before protected actions, reports per-step results, and supports stopping both during execution and while an approval is pending. Available actions include AI responses, local file and memory/note operations, opening HTTP(S) links, and read-only Browser Research. Browser Research is limited to reading a user-specified public page; it does not click, submit forms, or modify websites. General computer control remains unsupported. Existing avatar blink/lip-sync (`portrait-animation.js`, `portrait-motion.js`, `avatar-cues.js`, `avatar3d.js`) remains unchanged; mouth movement is approximate, not phoneme-accurate.

### Run on Windows (PC)

1. Install Node.js 22.12 or newer.
2. In the project folder: `npm install`, copy `.env.example` to `.env`, and set `GEMINI_API_KEY` (free Google AI Studio key) **or** use local Ollama (`AI_PROVIDER=ollama`, `OLLAMA_MODEL=...`).
3. `npm start`, then open `http://localhost:4173`. Desktop app: `npm run desktop`.

### Run on Android

Keep the server running on the PC, put the phone on the same Wi-Fi, and open `http://<PC-IP>:4173` in Chrome (or use `npm run codespaces` and the HTTPS URL). Microphone and speech need HTTPS or localhost. Set `APP_ACCESS_TOKEN` before exposing the server beyond your own network.

### Environment variables

`AI_PROVIDER` (gemini | ollama | openai-compatible), `GEMINI_API_KEY`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `APP_ACCESS_TOKEN`, `HOME_ASSISTANT_URL`, `HOME_ASSISTANT_TOKEN`, `HOME_ASSISTANT_ENTITIES`, `HOME_ASSISTANT_CONTROL_ENTITIES`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `APP_ENCRYPTION_KEY`, `GOOGLE_TOKEN_FILE`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS`, `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `FACEBOOK_GRAPH_API_VERSION`, and `FACEBOOK_ALLOWED_RECIPIENT_IDS`. Provider and integration credentials stay on the server and are never sent to the browser.

### Verified in this upgrade (offline sandbox)

- `node --test`: 293 tests, 292 pass, 1 fail. The failure is `test/avatar3d.test.js`, which needs the `three` package; it could not be installed without network access. Run `npm install` and it should be re-checked.
- Syntax check of every file in `npm run check` (except the esbuild step): passed.

### Not completed / not verified

- `npm test`, `npm run build` and `npm run check` as written were **not run** (esbuild unavailable offline); Playwright browser and mobile tests were **not run**.
- Real microphone, speech recognition, text-to-speech, Android audio and avatar visuals were **not tested**.
- No UI for the agent, permission prompts, file manager or memory import/export yet.
- `computer-control.js`, `browser-automation.js` (beyond the existing read-only Browser Research) and the avatar split into separate files were intentionally **not** created.
- PDF/DOCX/XLSX reading is not available.

## Natural voice (OmniVoice), Tauri apps and final-audit changes

See `START_HERE.md` for one-page run instructions and `FINAL_REPORT.md` for the complete list of removed files, fixed bugs and what is still untested.

- **OmniVoice (optional, local, free):** `voice/omnivoice-server/server.py` loads the open-source OmniVoice model (Hindi + English) on `127.0.0.1:4175`. The Node server proxies `POST /api/tts` to it (auth, rate limit, 1,200-character limit, audio validated). The browser plays it in sentence-sized chunks, with the portrait mouth driven by the audio level. Order of voices: OmniVoice -> Gemini Live -> browser `speechSynthesis`; any failure falls through to the next one. Toggle in Settings -> *Natural voice (OmniVoice)*. Speech recognition is unchanged.
- **Tauri 2 shell (`src-tauri/`):** hosts the same web UI for Windows and Android. `npm run tauri:prepare` stages `public/` plus the three voice modules; `public/runtime-config.js` redirects `/api/...` to the configured server in a native shell and does nothing in a normal browser. The existing Electron installer (`npm run desktop:dist`) remains the all-in-one Windows option because it bundles the server.
- **Security:** `/voice/` now serves only the three browser modules (previously the whole folder, including Python sources and `.env.example` files, was downloadable); CORS allows only packaged-app origins plus `ALLOWED_ORIGINS`; optional `TRUST_PROXY=1` gives per-visitor rate limits behind a proxy; CSP gained `media-src 'self' blob:` for OmniVoice audio.
- **Docs layout:** handoff notes are in `docs/handoff/`; the Gemini Live reference examples (not runtime code) are in `docs/reference/gemini-live-examples/`.

## Capabilities and limits

- **Desktop browsers:** Compatibility is capability-based, not a certified browser/version matrix. The web UI relies on modern JavaScript modules, Fetch, local storage, and native HTML dialogs. Gemini Live voice requires `getUserMedia`, AudioWorklet, WebSocket, HTTPS (or localhost), and microphone permission; browser speech fallback and wake-word detection require `SpeechRecognition` or `webkitSpeechRecognition`. External links depend on user-gesture, popup, and operating-system policies. Browser identification in the system panel is informational, not a guarantee of feature support. No browser/version matrix or physical desktop compatibility run is claimed.
- **Desktop actions:** The Electron shell's preload exposes only validated external-link requests and bounded clipboard writes. App Hub opens allowlisted HTTPS, `tel:`, and `sms:` destinations through the operating system; Android `intent://` links are not supported in the desktop shell. Copy Text acts only on text the user entered and clicked to copy. J.A.R.V.I.S. has no general desktop automation, shell execution, arbitrary file access, keyboard monitoring, or computer-control API.
- **Home Assistant:** Authenticated entity-state reads use an explicit server allowlist. A separate allowlist enables only confirmed light/switch on/off operations with post-action state verification. No other services or safety-critical domains are supported; a live device is not verified.
- **Chat:** AI requests go through the Node server. Conversation context is sent to the selected provider when you chat. No provider is bundled, and model quality/language support depends on the provider/model you configure.
- **Voice:** With Google Gemini selected, the mic streams 16 kHz audio over a bidirectional WebSocket to `gemini-3.8-live`; Gemini returns natural audio and Hindi/English transcriptions, with activity-based interruption. The server mints single-use, short-lived tokens; the Gemini API key stays on the server. Microphone audio is sent to Google only while a Live session is active. Text chat also uses Live audio for spoken replies, with browser `speechSynthesis` as a compatibility fallback. Other providers use the browser's standard `SpeechRecognition`/`webkitSpeechRecognition` and system voices exposed by `speechSynthesis`. **Wake-word detection** remains an explicit browser-local opt-in in Settings for **"Hey JARVIS"** or **"हे जार्विस"**; it uses browser speech recognition and is not system-wide or available when the app is closed or the screen is locked. Recognition pauses on page hide or window blur; opted-in wake detection resumes only after the page is visible/focused and permission is not known denied. A microphone denial turns wake mode off; after granting access in system settings, enable it again manually. Browsers and operating systems may still suspend recognition while backgrounded or sleeping, so continuous wake detection is not guaranteed. The app does not provide locked-screen microphone or audio service. Voice requires HTTPS or localhost and microphone permission. Browser-based recognition may send audio to a browser-provided speech service depending on the browser/device.
- **Avatar:** The built-in hologram uses the existing lazy-loaded Three.js runtime and a bundled 256×256 reference-photo face texture; no model download, API, or paid service is required. Its face is mapped onto a lightweight procedural head, not reconstructed as a fully photorealistic 3D model. **Load Custom Avatar** accepts a self-contained `.vrm` or `.glb` up to 20 MB, parses it locally, and requires a supported mouth or speech-expression morph. External model resources are rejected; files are not uploaded or persisted, so choose one again after reloading. Compatible VRM/GLB blink expressions and eye/head controls are used when available. The static portrait remains unchanged; its mouth uses a shared fast-attack/smooth-release envelope, audio levels when available, and approximate English/Hindi `aa/ee/ih/oh/ou` viseme shapes. Browser speech word boundaries provide additional cues. Motion is bounded and returns to neutral when speech stops; reduced-motion preferences lower portrait motion. This remains approximate and is not phoneme-accurate. For a more realistic custom model, browse [Sketchfab's downloadable model search](https://sketchfab.com/search?features=downloadable&type=models&q=realistic%20female%20human%20face), verify the exact license and facial rig, then use Blender to export a self-contained GLB with embedded images. The app does not download, bundle, or verify a custom model's appearance, quality, or license. Browser `speechSynthesis` does not expose its audio samples, and the current interface has no tab-audio sync control.
- **System monitor:** Browser-reported device/platform, online status, voice support, and supported mobile battery or JavaScript-heap readings are labeled separately from CPU/RAM/storage metrics collected on the J.A.R.V.I.S. server/container. Microphone permission status is queried without requesting access. Browser support and privacy protections can make individual values unavailable; the page does not estimate missing readings.
- **Attachments:** Small text, Markdown, and CSV files are read in the browser (maximum 16 KB / 2,500 characters) and included with the next chat message. They are not uploaded or stored separately by this server, but are sent to the configured AI provider with the conversation.
- **Search:** Uses DuckDuckGo Instant Answers when available and falls back to the Wikimedia search API for source-linked English or Hindi Wikipedia articles. Results remain unmodified and linked; choose **Summarize with AI** on an individual result set to request one concise, source-grounded summary. No summary request is made automatically. If no AI provider is configured, search still works and the app explains that summaries are unavailable. If both search providers fail, the app reports the network error rather than inventing results.
- **Memory:** Conversation history and preferences are stored in browser `localStorage`; this is device-local, not encrypted storage. Optional Smart Memory is separate from history: the user must add each preference or fact, review it, and approve it before use. Smart Memory is off by default, can be switched off independently, and supports searching, editing, deleting, and clearing all saved memories. Credentials and sensitive personal, financial, or medical information should not be saved. When Smart Memory is enabled, approved preferences and relevant approved facts are added to the existing chat context and sent to the configured AI provider with the user's message; no memory-specific external service or backend storage is used.
- **PWA:** The app shell can be installed and cached for offline viewing when served over HTTPS (or localhost). Chat and internet search require the server/network. The SVG icon and manifest are included; install prompts vary by browser.
- **Device control:** A browser/PWA cannot control the whole phone or desktop, read private files, or send messages. No such actions are implemented.
- **Full Access:** The OFF/ON setting controls explicit in-app actions, Vision capture, and Android intent launches. Disabling it closes Vision and cancels/clears an active capture. It does not grant autonomous computer/project access; there is no OS automation or general OS-control integration in this browser project.

## Deployment

Deploy the Node server and `public/` directory together on a Node 22.12+ host that provides HTTPS. Set AI credentials and `APP_ACCESS_TOKEN` as server-side environment variables in the host's secret manager. Do not publish until you have authorized the hosting account and configured access protection. A static-only host can show the cached UI but cannot provide this repository's chat/search APIs without a separate server implementation.

## Iron Man-inspired upgrade plan

The repository now includes a GitHub-ready implementation roadmap, feature catalog, security requirements, phase tasks, and a master coding-agent prompt. Start with [`IRONMAN_UPGRADE_README.md`](IRONMAN_UPGRADE_README.md) and [`docs/ironman-roadmap/00_MASTER_IMPLEMENTATION_PROMPT.md`](docs/ironman-roadmap/00_MASTER_IMPLEMENTATION_PROMPT.md). These documents describe planned work; they do not mean every future capability is already implemented.
