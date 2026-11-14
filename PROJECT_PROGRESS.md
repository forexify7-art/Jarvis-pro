# Project Progress

**Current source:** `FEATURE_COMPLETION_MATRIX.md` (reviewed 2026-11-08).
**Weighted code-side estimate:** **66.16% complete / 33.84% estimated remaining**.
**Fully verified high-level feature areas:** 0%; live/device/browser acceptance is separate from unit-test success.

Do not use the older `PROGRESS_REPORT_2026-11-09.md` 60.40% figure as the latest score; it predates the current matrix/CI snapshot. The user referred to a latest 90% checkpoint, but no task ledger or evidence supporting 90% was found. Ask for the authoritative task list before reconciling that statement.

## Completed And Tested

- Node server, browser/PWA, Electron shell, Tauri scaffold, AI provider adapters, Gemini Live/browser speech, local memory/files, single-frame camera/screen capture, read-only Browser Research, Home Assistant, OmniVoice protocol, Google Workspace OAuth, and Telegram outbound messaging are present.
- Google OAuth: PKCE/state, encrypted token persistence, refresh/revocation; Gmail creates drafts only, Calendar read range is bounded, event creation requires confirmation.
- Telegram: bot token is server-only; numeric chat allowlist; authenticated/rate-limited plain-text send; explicit user confirmation.
- Avatar: 3D/portrait controls, bounded audio envelope and approximate English/Hindi viseme shapes; PWA offline helper cached.
- Test snapshot from the current matrix/progress evidence: Node 386 passed, Python 15 passed, `npm run check` passed, `npm audit` 0 advisories.
- `npm run tauri:prepare` passed and staged UI/voice assets in the previous checkpoint; staging output is recreateable and excluded from Git/source backup.
- GitHub Actions workflow defines Ubuntu tests and browser E2E plus a Windows installer job. It is configured but not verified as run.

## Important Caveats

- Full Playwright suite now passes 34/34 locally after installing Chromium host dependencies. The mobile portrait blink case passed 3 consecutive runs after its timeout was aligned with the expected 500 ms hold; GitHub Actions has not yet been verified.
- Windows Actions installer is configured, not verified. Prior local Electron download failed with HTTP 504. The old unsigned installer is not a trusted/current build.
- No live provider credentials/accounts or physical devices were used. Mocks validate code paths only.
- Python tests pass with existing HTTP/socket `ResourceWarning`s.
- Gmail's `gmail.compose` scope includes provider-level send permission, although the app only exposes draft creation.
- Security follow-up: Browser Research subresource egress and independent security review.

## Percentages Are Not Certification

Matrix estimates are coarse implementation coverage, not percentages of passing tests or production readiness. Weights and evidence are in `FEATURE_COMPLETION_MATRIX.md`. Report no increase unless the matrix's acceptance evidence changes.