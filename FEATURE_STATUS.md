# Feature status tracker

Allowed statuses: `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED`, `TESTED`, `VERIFIED`, and `BLOCKED`. `TESTED` records automated evidence only; `VERIFIED` requires the full feature acceptance gate, including live/device checks where applicable. See [`FEATURE_COMPLETION_MATRIX.md`](FEATURE_COMPLETION_MATRIX.md) and [`FINAL_CERTIFICATION_REPORT.md`](FINAL_CERTIFICATION_REPORT.md).

Current snapshot (2026-11-14): weighted code-side estimate **66.36% complete; 33.64% remaining**. Current automated checks and live/device caveats are listed in `FEATURE_COMPLETION_MATRIX.md`. No live integrations or platform-device acceptance are claimed. This snapshot supersedes older status notes in the dated change log below.

| Area | Status | Evidence / remaining acceptance |
|---|---|---|
| AI Model Manager | TESTED | Settings controls are wired to authenticated discovery, bounded compatibility probes, verified-only model selection, and visible latency/status; mocked regression tests pass. Live provider credentials are still unavailable. |
| Agent cancellation and approval safety | TESTED | Abort propagation, Stop controls, and cancellation results pass focused and full Node tests; full browser workflow remains unverified. |
| General computer automation | NOT_STARTED | No general keyboard, mouse, shell, or desktop action handler is exposed. |
| Browser automation | TESTED | Agent mode supports approved read-only page research; interactive page actions are absent. Full Playwright suite passes 34/34 on desktop Chromium and emulated Android mobile; browser research subresource egress and GitHub-hosted CI remain unverified. |
| Gmail and Calendar OAuth | TESTED | Server-side PKCE, one-time OAuth state, encrypted token storage, refresh/revocation, Gmail draft-only, Calendar reads, confirmed event creation, API routes, and Settings UI pass mocked tests; no live account was configured. |
| Telegram messaging | TESTED | Server-only bot token, numeric recipient allowlist, authenticated/rate-limited send endpoint, Settings confirmation, and mocked tests pass; no live bot/chat was configured. |
| Facebook Messenger replies | TESTED | Server-only Page token, numeric recipient allowlist, authenticated/rate-limited plain-text responses, Settings confirmation, and mocked tests pass; no live Meta Page was configured. |
| Other messaging providers | NOT_STARTED | Telegram and Facebook Messenger are available as optional allowlisted outbound providers; WhatsApp/SMS gateways and inbound messaging are not implemented. Existing `sms:` links remain OS handoffs. |
| Real-time vision | NOT_STARTED | Screen/camera still capture exists; continuous video analysis does not. |
| Home Assistant live integration | TESTED | Server-side allowlists and mocked HTTP tests pass; the Settings refresh control is wired; no live instance was configured. |
| Memory controls | TESTED | Local inspect/edit/delete, explicit context controls, and import/export have automated coverage; full user workflow is not E2E-verified. |
| Windows desktop build | IN_PROGRESS | A GitHub Actions Windows job now builds and uploads the unsigned Electron NSIS installer; the remote job and install/lifecycle QA have not yet run. |
| Android APK build | BLOCKED | Prior build failed at `cargo metadata`; Cargo/Rust and ADB are unavailable. |
| Microphone permission and device QA | TESTED | Permission-aware code/tests exist; no physical-device QA. |
| Camera permission and device QA | TESTED | One-frame capture and stop paths have mocked coverage; no physical-device QA. |
| Security and API-key protection | TESTED | Server-side auth/redaction, OAuth encryption/PKCE, Telegram allowlists, DNS pin generation, and all 410 Node tests pass; npm audit reports 0 findings. Browser runtime isolation and independent penetration testing remain open. |

## Change log: Codespaces startup pass (historical)
- `npm run codespaces` is now an idempotent preflight (Node check, dependency check/install, `.env` handling, key warning, avatar build, start, forwarded URL). Removed the `precodespaces` hooks that ran the build before dependencies existed. Unit tested (`test/codespaces-startup.test.js`); not yet run inside a real Codespace.
- Repository flattened (the uploaded ZIP nested the project three folders deep) and about 30 stray files from an accidental shell paste were removed. No source files were changed besides the startup script, package.json and docs.
- At that historical checkpoint, connectors and Android/Windows builds were not completed. See the current snapshot above and the matrix for updated evidence.
