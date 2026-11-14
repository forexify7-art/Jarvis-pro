# Implementation status (audit resumed 2026-11-07)

This matrix is the current repository-scope view. The complete results, percentage formulas, test outcomes, and blockers are in [`FINAL_100_PERCENT_AUDIT.md`](../../FINAL_100_PERCENT_AUDIT.md). Automated or mocked results do not imply live-service or device verification.

| Capability | Evidence in repository | Status | Remaining acceptance |
|---|---|---|---|
| Agent cancellation and approval safety | Abort signal reaches AI fetch; Stop and approval-dialog Stop; cancellation and approval tests pass | TESTED | Complete browser workflow remains unverified |
| General computer control | Planner recognizes the request but no execution handler is exposed | NOT_STARTED | Design and implement bounded, approved native actions |
| Browser task automation | Agent planner's `browser-read-page` uses the authenticated read-only research client with timeout/cancellation; offline shell caches its module | TESTED | Playwright E2E passes 34/34; interactive page actions remain unsupported; Browser Research subresource egress still needs review |
| Gmail and Calendar OAuth | No account connector or OAuth flow found | NOT_STARTED | Least-privilege consent, token lifecycle, and draft/confirm flows |
| Messaging provider integration | OS `sms:` handoff only; no provider connector or send API | NOT_STARTED | Provider connection and visible recipient/message confirmation |
| Real-time vision | User-triggered one-frame screen/camera capture exists | NOT_STARTED | Continuous video analysis is not implemented |
| Home Assistant | Server-only URL/token configuration, explicit allowlists, fixed confirmed controls, mock HTTP tests | TESTED | Authorized live-instance verification |
| Memory controls | Browser-local inspect/edit/delete, explicit context approval, import/export tests | TESTED | Storage remains local, unsynchronized, and unencrypted; full UI workflow not E2E-verified |
| Windows release | Electron NSIS configuration exists; prior build stopped at missing Wine | BLOCKED | Complete installer and Windows install/lifecycle smoke test |
| Android release | Tauri setup exists; prior build stopped at missing Cargo/Rust and ADB | BLOCKED | Build APK and install/test on physical Android device |
| Microphone permission and voice | Permission-aware browser/Electron paths and automated tests | TESTED | Physical Windows/Android permission, revocation, and voice round-trip QA |
| Camera permission and capture | Audio-disabled still capture, preview-before-send, and stop paths have mock coverage | TESTED | Physical-device permission/capture QA; continuous video is not implemented |
| Security and API-key protection | Server-side credentials, access controls, redaction, non-disclosure, and public DNS pinning have tests | IN_PROGRESS | Verify Chromium resolver at runtime; constrain subresource egress; external review and six moderate dev dependency advisories remain |
| Automated baseline | 361 Node tests, both Python suites, check/build, and syntax scans pass | TESTED | Browser/native/live checks remain separate blockers |

Allowed statuses: `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED`, `TESTED`, `VERIFIED`, and `BLOCKED`. `TESTED` means automated checks pass; `VERIFIED` requires the full acceptance gate, including live or device evidence where applicable.

### Phase 1 acceptance status

The Phase 1 code paths cover push-to-talk, opt-in foreground wake-word detection, Hindi/English recognition routing, TTS fallback, noise gating, interruption, Gemini Live reconnection, microphone-track termination, a 30-minute live-session cap, and audio-amplitude avatar synchronization. A successful browser recognition start now updates microphone permission status even where the Permissions API cannot report it.

Automated tests pass in this environment, including all 34 Playwright browser cases after Chromium dependencies were installed. Target-device acceptance is not complete: no real Windows or Android hardware is available.

Current status: the voice code paths are `TESTED`; Windows/Android device acceptance remains `IN_PROGRESS`, and is not `VERIFIED`.

The browser wake phrase is still implemented through browser speech recognition, not a dedicated on-device wake-word engine. Browser/OS recognition may use a provider speech service; keep wake mode opt-in and foreground-only.

Do not upgrade a status without evidence.

## Current remaining-phase execution

### Smart home: Home Assistant integration

Implemented in this workspace:
- Server-only configuration via `HOME_ASSISTANT_URL`, `HOME_ASSISTANT_TOKEN`, and `HOME_ASSISTANT_ENTITIES`.
- Authenticated `GET /api/home-assistant/entities`, protected by the app access key and rate limited.
- Only explicitly configured `sensor`, `binary_sensor`, `light`, and `switch` entity IDs are queried; broad entity discovery is not exposed.
- A separate `HOME_ASSISTANT_CONTROL_ENTITIES` allowlist enables only light/switch `turn_on` or `turn_off`; each Settings action requires a native confirmation and the server verifies the resulting state.
- The endpoint is protected by app authentication and separate read/control rate limits. The UI safely renders entity data with `textContent`.
- Unit and HTTP integration tests cover incomplete/unsafe configuration, allowlist enforcement, missing confirmation, fixed service mapping, verification, upstream errors, authorization, and token non-disclosure.

Still incomplete: live Home Assistant instance validation and testing of real device behavior. Exclude locks, alarms, garage doors, covers, and safety-critical equipment from both allowlists.

### Vision: camera still capture

The existing Vision dialog now offers a user-triggered camera path alongside the screen picker. It requests video with audio disabled, shows an active status while the browser camera indicator is on, captures one local frame, then stops the camera track before the preview can be sent. Denial, unsupported APIs, stale permission results, dialog close, and Emergency Stop have automated regression coverage. This is not a continuous camera stream or real-time video analysis; physical camera permission and image-quality validation remain pending.

### Other remaining phases

General keyboard/mouse/window automation is intentionally not exposed: the current browser/PWA architecture has no narrow native automation bridge, and adding model-directed arbitrary control would violate the typed allowlist and approval requirements. Browser research stays read-only; downloads and side-effect browser tasks remain disabled. Email, calendar, and messaging still need an OAuth provider, secure token lifecycle, and draft/confirm UX. Vision supports explicit one-frame screen and camera capture, not continuous video analysis. Windows installer completion and Android APK/hardware acceptance remain pending their native environments.
