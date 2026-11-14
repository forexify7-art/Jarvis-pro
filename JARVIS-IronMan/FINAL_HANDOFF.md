# J.A.R.V.I.S. — Final Source Handoff

This package contains the supplied JARVIS source project with a refreshed audit record and cleanup of generated Python cache files. Existing application assets and the original portrait are preserved.

## Start locally

1. Install Node.js **22.12 or newer**.
2. Open a terminal in the `JARVIS-IronMan` folder.
3. Copy `.env.example` to `.env` and add only the API keys/providers you personally authorize. Keep `.env` private; it is ignored by Git and is not included in this package.
4. Run `npm ci`.
5. Run `npm run check` and `npm test`.
6. Run `npm start`, then open the local address printed by the server.

For optional local OmniVoice, follow `voice/omnivoice-server/requirements.txt` and `START_HERE.md`, then start it with `npm run start:omnivoice` in a separate terminal. Browser speech fallback remains available when the local voice sidecar is unavailable.

## Platform builds

- Windows desktop: `npm run desktop:dist` on a supported build host; install and test the resulting installer on Windows.
- Android: follow the Tauri/Android setup in `START_HERE.md`, then run `npm run tauri:android:init` and `npm run tauri:android:build` with Rust, Android SDK/NDK, and ADB configured.

## Honest verification status

See `AUDIT_2026-11-14.md` and `FEATURE_COMPLETION_MATRIX.md`. The source-side estimate is 66.16% weighted implementation. In this workspace, 377 Node tests (excluding the avatar3d test blocked by the missing `three` dependency) and 15 Python tests passed; project JavaScript and Python syntax scans passed. Full dependency-backed, browser, live-account, and physical-device acceptance remains outstanding. Do not describe this package as 100% complete or production-certified.

## Important security note

Do not paste API keys into source files, browser storage, screenshots, chat logs, or commits. Configure provider credentials in the private server-side `.env` or deployment secret store. Use revocable, least-privilege credentials for integrations and rotate any credential that may have been exposed.
