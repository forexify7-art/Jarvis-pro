# Product roadmap

## Resumed audit checkpoint (2026-11-07)

The audit is **not complete**. Current scoped estimates: code implementation `53.85%` (reported as 54% across weighted requirements), fully verified high-level feature acceptance `0%`, and live/device verification `0%`. See [`../../FEATURE_COMPLETION_MATRIX.md`](../../FEATURE_COMPLETION_MATRIX.md) and [`../../FINAL_100_PERCENT_AUDIT.md`](../../FINAL_100_PERCENT_AUDIT.md) for formulas, test results, and blockers. The phase checklists below remain forward-looking roadmap criteria and are not evidence of live or device acceptance.

Current blocking work: verify the pinned Browser Research resolver and subresource egress in launchable Chromium; build and smoke-test Windows/Android artifacts; test microphone/camera on physical devices; validate Home Assistant with authorized live configuration. Agent mode supports approved, read-only Browser Research, but not interactive page actions. Gmail/Calendar OAuth, provider messaging, general computer control, and real-time video analysis are not implemented. The full npm audit still reports six moderate development-tooling advisories.

## Phase 0 — Baseline, reliability, and repository hygiene
- [ ] Install dependencies using the lockfile and record Node/Python/Rust versions.
- [ ] Run `npm run check`, `npm test`, browser tests, Python tests, and security/dependency audit where available.
- [ ] Fix baseline failures without weakening or deleting tests.
- [ ] Verify `.env`, tokens, keys, model caches, and local data are ignored.
- [ ] Add structured server logs with secrets and personal data redacted.
- [ ] Add health/readiness endpoints and clear provider status.
- [ ] Create a supported-platform matrix and a device test checklist.

Exit criteria: reproducible clean install, documented baseline, no known secret leakage, existing app remains functional.

## Phase 1 — Voice-first J.A.R.V.I.S.
- [ ] Robust push-to-talk and hands-free session modes.
- [ ] Optional wake word; local detection where supported; opt-in only.
- [ ] Visible microphone state, mute, stop, and session timeout.
- [ ] Hindi and English speech recognition with language selection.
- [ ] Streaming TTS with interruption/barge-in and cancellation.
- [ ] Voice activity detection and echo/noise handling.
- [ ] Reconnect/backoff and clear offline fallback.
- [ ] Accurate transcript and audio state synchronization.
- [ ] Lip-sync driven by audio amplitude/visemes where supported; label approximate fallback.
- [ ] Accessibility: captions, keyboard controls, reduced motion.

Exit criteria: tested voice round-trip on supported Windows browser and Android device; no recording after stop; interruption and fallback tests pass.

### Current execution note (2026-11-07)

Code-level Phase 1 work now includes microphone permission-state synchronization, Gemini Live microphone-track termination cleanup, a 30-minute conversation limit, and audio-amplitude updates to the existing avatar hooks. Automated Node tests and all 34 Playwright browser cases pass locally. Phase 1 remains unaccepted and Phase 2 must not start until device validation is available; no Windows or Android hardware is attached.

## Phase 2 — Safe computer and browser actions
- [ ] Define a typed action registry: open approved URL, navigate, click, type, read page, download to approved folder, create draft.
- [ ] Separate read-only actions from side-effect actions.
- [ ] Browser domain allowlist and isolated browser profile.
- [ ] Preview action plan and show target/domain before execution.
- [ ] Require confirmation before submitting forms, sending messages, purchases, downloads of executable files, or account changes.
- [ ] Add cancellation, action timeout, audit log, and recovery.
- [ ] Add desktop actions only through narrow native APIs; no model-generated shell strings.
- [ ] File access via user-selected folders and path validation; confirm overwrite/delete.
- [ ] Add prompt-injection defenses: page content is untrusted data, never authority.

Exit criteria: end-to-end browser tasks pass in a sandbox; blocked domains and denied permissions fail closed.

## Phase 3 — Personal productivity integrations
- [ ] Email connector: read only by default; draft replies; sending requires confirmation.
- [ ] Calendar connector: read availability; create/update/cancel only after confirmation.
- [ ] Messaging connector: draft first; send only after user sees recipient and full message.
- [ ] Task/reminder manager with timezone-aware scheduling and notification controls.
- [ ] Daily briefing from connected, authorized sources.
- [ ] OAuth least-privilege scopes, token refresh, disconnect/revoke, data retention controls.
- [ ] Mock-provider tests; real account tests only with user-authorized accounts.

Exit criteria: scopes are documented, revocation works, no silent sends or calendar mutations.

## Phase 4 — Vision and smart home
- [x] User-triggered screenshot/screen-share capture; show capture indicator and preview (browser UI tests exist; target-device QA pending).
- [x] User-triggered, audio-disabled camera still capture; no background camera recording (mocked lifecycle tests pass; device QA pending).
- [x] Vision Q&A for objects, UI, documents, and scenes through configured providers; no face identification (device/provider QA pending).
- [ ] Redact secrets and sensitive content before remote upload where feasible.
- [x] Home Assistant integration using a dedicated token and explicit device/entity allowlists (mock tests pass; live instance validation pending).
- [x] Read sensor state separately from fixed, separately allowlisted light/switch control.
- [x] Exclude locks, alarms, garage doors, heating, and other safety-critical entities from supported controls.
- [ ] Local network failure handling and manual override.

Exit criteria: camera/screen is off by default; smart-home actions are logged and permissioned; physical manual controls remain available.

### Execution update (2026-11-07)

Home Assistant has server-only URL/token configuration, a status entity allowlist, and an additional control allowlist for fixed light/switch `turn_on`/`turn_off` calls. Settings requires a fresh native confirmation; the server authenticates and rate-limits requests and verifies the returned state. Mock unit and HTTP tests pass. No other entity domains or arbitrary service calls are accepted. The existing Vision dialog also supports a single user-triggered camera still with audio disabled, local preview, and immediate track cleanup. Phase 4 remains open pending authorized live-instance/device testing, real-time video analysis, and camera QA.

## Phase 5 — Memory, planning, and dependable agents
- [ ] User-visible memory dashboard: inspect, edit, export, delete, clear all.
- [ ] Explicit save controls and retention settings; avoid sensitive inferred memory.
- [ ] Task state machine: plan → preview → approval → execute → verify → report.
- [ ] Per-step status, retries, budgets, timeouts, and cancellation.
- [ ] Multi-step tasks with checkpoints and user approval gates.
- [ ] Long-term preferences only when user explicitly saves them.
- [ ] Safe learning from user feedback without silently rewriting production code.
- [ ] Code changes as reviewable patches/branches; tests and diff shown; user merges.
- [ ] No autonomous deployment, credential changes, or production self-modification.

Exit criteria: repeatable task execution with audit trail, cancellation, rollback where possible, and user-controlled memory.

## Phase 6 — 3D experience and cross-platform release
- [ ] Optional Three.js/VRM avatar with graceful 2D fallback.
- [ ] Real-time viseme or phoneme lip sync where engine supports it.
- [ ] Performance profiles for low-memory Android and desktop GPUs.
- [ ] Android APK build/sign/install and physical-device QA.
- [ ] Windows installer build, install, upgrade, uninstall, and smoke tests.
- [ ] PWA offline behavior and cache migration tests.
- [ ] Crash reporting opt-in and privacy-safe diagnostics.
- [ ] Release checklist, versioning, changelog, and rollback plan.

Exit criteria: artifacts built from CI, checksums recorded, and each supported target tested on real hardware.
