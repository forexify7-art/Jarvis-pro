# Developer task breakdown

## First pull request
- [ ] Baseline environment and test report.
- [ ] Resolve dependency/build failures without removing coverage.
- [ ] Add feature-status tracking and CI.
- [ ] Audit secrets and public static file exposure.
- [ ] Add permission model documentation and typed action schema proposal.

## Voice pull request
- [ ] Voice session state machine.
- [ ] Push-to-talk and opt-in wake-word adapter.
- [ ] Mic indicator, mute, stop, cancellation.
- [ ] Hindi/English recognition tests.
- [ ] Streaming TTS interruption and fallback.
- [ ] Physical device QA notes.

## Browser/desktop pull request
- [ ] Typed action registry.
- [ ] Domain allowlist and sandbox session.
- [ ] Plan preview and confirmation UI.
- [ ] Cancellation, timeouts, audit records.
- [ ] Safe file picker and path checks.
- [ ] Electron/Tauri capability parity review.

## Productivity integrations pull request
- [ ] OAuth provider interface and scope registry.
- [ ] Email read/draft/send separation.
- [ ] Calendar read/write separation.
- [ ] Messaging draft/confirm/send separation.
- [ ] Disconnect, revoke, retention and mock tests.

## Vision/smart-home pull request
- [x] Explicit screenshot/camera still-capture UI; mocked permission and cleanup tests pass, physical device QA pending.
- [x] Capture status indicator and stop.
- [ ] Vision data minimization.
- [x] Home Assistant status plus separately allowlisted, confirmed light/switch on/off controls (mock/unit and HTTP tests pass; live instance validation pending).
- [x] Per-entity read/control allowlists with safety-critical domains excluded.
- [x] Confirmation before every supported device-state change.

## Agent/memory pull request
- [ ] Inspect/edit/export/delete memory UI.
- [ ] Plan/approve/execute/verify state machine.
- [ ] Retry budgets, timeouts, cancellation.
- [ ] Patch-based code suggestions; no self-deploy.
- [ ] Audit and regression tests.
