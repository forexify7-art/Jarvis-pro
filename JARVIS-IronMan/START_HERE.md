# J.A.R.V.I.S. — GitHub Codespaces (one command)

Open the repository in a Codespace, then run:

    npm run codespaces

It checks Node 22.12+, installs dependencies only if missing, creates `.env` only if absent (an existing `.env` is never overwritten), warns if no AI key is set, builds the avatar bundle, starts the server, and prints the forwarded URL. Put API keys in `.env` or in Codespaces Secrets, never in the browser.

Message to paste into Copilot Chat:

> Run `npm run codespaces` in the project folder, fix any error it prints without deleting my .env or data, and tell me the forwarded URL.

---

# J.A.R.V.I.S. — start here

## Run it (Windows)
1. Install **Node.js 22.12+** from https://nodejs.org (once).
2. Double-click **`run-jarvis.bat`**. First run: it installs everything, creates `.env` and opens it —
   paste your free Google AI Studio key as `GEMINI_API_KEY=...`, save, run the file again.
3. Your browser opens `http://localhost:4173`. Done.

Linux/macOS: `./run-jarvis.sh`. Manual: `npm install` → copy `.env.example` to `.env` → `npm start`.
No Gemini key? Use local Ollama instead: set `AI_PROVIDER=ollama` and `OLLAMA_MODEL=...` in `.env`.

## Natural voice (OmniVoice) — optional
JARVIS speaks with your browser/Gemini voice by default. For local, free, neural Hindi + English speech:
1. Install Python 3.10+.
2. Double-click **`run-omnivoice.bat`** (Linux/macOS: create a venv, install PyTorch, then
   `pip install -r voice/omnivoice-server/requirements.txt && python voice/omnivoice-server/server.py`).
   The first start downloads the model (several GB) — wait for "OmniVoice ready".
3. Open JARVIS → Settings: **Natural voice (OmniVoice)** switches on automatically when the engine is running.
If the engine is stopped, slow or fails, JARVIS silently uses the previous voice (Gemini/browser).
Needs a decent machine: use a GPU if you have one; on a 4 GB RAM PC leave OmniVoice off.

## Gmail and Calendar — optional
1. In Google Cloud Console, enable the Gmail API and Google Calendar API, configure the OAuth consent screen, and add your account as a test user while the app is in testing mode.
2. Create an OAuth client ID for a **Web application**. Add the exact redirect URI `https://your-host.example/api/google/callback` (or `http://localhost:4173/api/google/callback` for local development).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in the server's `.env` or deployment secrets. Generate `APP_ENCRYPTION_KEY` with `openssl rand -base64 32`; keep it stable and back it up separately from the token file.
4. Start JARVIS over HTTPS for a public deployment, open Settings → Google Workspace, and choose **Connect Google**. Google account tokens stay on the server and are encrypted with AES-256-GCM in `.data/google-workspace.tokens.enc` (file permissions are restricted to the server user). Keep that directory on persistent storage if reconnecting after a restart is undesirable.

The requested scopes are limited to Gmail compose and events on the account's own Calendar. JARVIS only creates Gmail drafts; it does not send email. Creating a calendar event asks for confirmation. Use **Disconnect** to revoke the Google authorization and delete the local token file. This OAuth state is held by one server process, so run one app instance for the callback and configure a persistent token directory for durable sessions. Facebook Messenger supports outbound replies to an administrator-allowlisted Page-scoped recipient. WhatsApp/SMS gateways and inbound messaging are not implemented.

## Telegram messages — optional, no AI tokens
1. Create a bot with Telegram's `@BotFather` and obtain its bot token. Add the bot to a private chat or group that you administer, then obtain that chat's numeric ID.
2. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_CHAT_IDS` in the private server `.env` or deployment secrets. For multiple recipients, use a comma-separated list; keep it limited to chats you control.
3. Restart JARVIS, open Settings → Telegram, refresh recipients, choose a chat, compose a plain-text message, and confirm the exact send.

The bot token never reaches the browser. The API accepts only server-allowlisted chat IDs and is limited to three sends per minute. The app does not receive messages or monitor chats. Telegram delivery uses Telegram's own service (not an AI model), and a live bot/recipient is not verified in this workspace.

## Facebook Messenger replies — optional, no AI tokens
1. Create/configure a Meta app with the Messenger Platform product and connect the Facebook Page you administer. Use a Page access token and a Graph API version currently supported by Meta.
2. Set `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `FACEBOOK_GRAPH_API_VERSION`, and only operator-approved numeric Page-scoped recipient IDs in `FACEBOOK_ALLOWED_RECIPIENT_IDS` in the server `.env` or deployment secrets.
3. Restart JARVIS, open Settings → Facebook Messenger, refresh recipients, choose an allowlisted recipient, compose a plain-text reply, and confirm the exact send.

The Page token stays on the server. Sends use Meta's standard response messaging type; the recipient must have messaged your Page within the standard 24-hour messaging window. Meta app permissions/review and a live Page are not configured or verified in this workspace.

## Install as an app
- **Phone (easiest):** open the site in Chrome → menu → *Install app* (PWA). Needs HTTPS or localhost.
- **Windows installer:** `npm run desktop:dist` (Electron; includes its own server, nothing else to run).
- **Android APK / Windows via Tauri 2:** needs Rust + Android Studio (SDK/NDK) installed, then
  `npm run tauri:android:init` → `npm run tauri:android:build`. The app asks once for your JARVIS server
  address (for example `https://your-app.onrender.com` or `http://192.168.1.20:4173`).
  Windows: `npm run tauri:build` (expects the server at `http://127.0.0.1:4173`, or use `?api=` to change).

## Before putting it on the internet
Set a long random `APP_ACCESS_TOKEN` (and `TRUST_PROXY=1` behind Render/Nginx). Never put API keys in `public/`.
The repository's `render.yaml` already does this.
