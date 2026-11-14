# Remaining Tasks

Use the acceptance criteria in `FEATURE_COMPLETION_MATRIX.md`; do not equate mocked tests with live/device verification. The current score is 66.36% weighted code-side implementation, not production certification.

## Immediate Verification Tasks

1. Run the configured GitHub Actions workflow and confirm the 34 browser cases pass on its hosted runner; inspect traces if it fails. Separately verify Browser Research resolver behavior and subresource egress.
2. Verify Google OAuth using an authorized test account. Confirm OAuth consent, exact redirect URI, token refresh/revocation, persistent storage, restart, and disconnect. Review that `gmail.compose` permits provider-level sends even though the app only creates drafts.
3. Verify Telegram using an operator-owned bot and Facebook Messenger using an operator-owned Meta app/Page and allowlisted Page-scoped recipient. Test confirmation, recipient rejection, rate limiting, token secrecy, and Meta messaging-window enforcement.
4. Verify Home Assistant with a dedicated revocable token and minimal read/control allowlists.
5. Verify AI provider and Gemini Live paths with authorized credentials; do not place secrets in the repository or browser storage.

## Native And Device Acceptance

6. Run the GitHub Actions Windows installer job or build on Windows; test install, startup, update, uninstall, IPC, and voice lifecycle. Do not reuse the pre-existing unsigned 125 MB installer without provenance/signature review.
7. Install Rust, Android Studio SDK/NDK, and ADB on a supported runner; run `npm run tauri:android:init`, `npm run tauri:android:build`, install the APK, and test microphone/camera/voice/lifecycle permissions.
8. Perform camera/microphone hardware acceptance and avatar/WebGL visual checks on target devices. Reduced-motion behavior and emergency stop must remain intact.

## Security And Product Scope

9. Test Browser Research redirects and subresource egress to private/link-local IPs and hostnames. Add an egress boundary only after a reproducible bypass is found.
10. Obtain independent security review/penetration testing before public production exposure.
11. Define requirements before implementing inbound Telegram, WhatsApp/SMS gateways, continuous vision, or general desktop automation. Keep desktop actions typed, allowlisted, confirmed, cancellable, and audited; do not expose arbitrary shell/mouse/keyboard/window control.
12. Review local HTTP/CSP/CORS, data retention, and persistent token-store backup/rotation in the intended deployment.

## Tasks 121-150

No source file, plan, issue export, or task ledger containing task IDs 121-150 was found during the repository scan. Do not infer or fabricate these tasks. Ask the user/Jules operator to provide the authoritative list, then map each item to code, acceptance tests, and current matrix rows.

## Local Toolchain Blockers

- Local environment versions: Node 24.22.2, npm 11.19.1, Python 3.14.2.
- `cargo`, `rustc`, `adb`, and `wine` are unavailable in the current container.
- Chromium runtime dependencies have been installed in this environment; the full Playwright suite passes 34/34 locally. A fresh runner must install Playwright system dependencies before browser tests.
- No live AI/Google/Telegram/Facebook Messenger/Home Assistant credentials or physical devices are configured.