# J.A.R.V.I.S. Project Completion Plan

Last reviewed: 2026-11-07. This plan preserves the existing Node web app, Electron shell, Tauri scaffold, browser service, voice modules, and current permission boundaries. It does not declare any feature complete without its acceptance evidence.

## Execution Rules

- Use the feature matrix as the source of scope, weights, status, and acceptance evidence.
- Keep user-authorized and read-only actions separate from side-effect actions; require fresh confirmation for writes and destructive operations.
- Never implement general model-directed shell, filesystem, or desktop control.
- Mocked tests prove code paths only. Live providers, Home Assistant, devices, and packaged platforms require separate evidence.
- Update `PROJECT_EXECUTION_STATE.md` after each meaningful task. No release, deploy, push, or secret changes are authorized by this plan.

## Workstreams

| Priority | Workstream | Next safe task | Acceptance gate |
|---|---|---|---|
| P0 | Repository baseline and audit evidence | Preserve the 2026-11-07 baseline results, record current user changes, and keep status files consistent | Node/Python suites, check/build, syntax and dependency findings recorded without altering unrelated data |
| P1 | Agent orchestration | Connect planner `browser-read-page` steps to the existing permission-gated, read-only Browser Research client | Authorized request, source URL retained, AbortSignal propagated, unsupported/failed results reported honestly, focused tests pass |
| P1 | Voice and memory reliability | Review storage/reconnect/permission failure paths after the browser task | Targeted regression tests; hardware-dependent acceptance remains blocked until devices/accounts are available |
| P1 | Security | Review server URL fetching, API authorization, native IPC, local file/ZIP parsing, logging, and dependency advisories | Confirmed issues get reproductions and regression tests; no unreviewed breaking dependency overrides |
| P2 | Vision and avatar | Keep current one-frame capture and approximate animation accurately scoped; improve only with testable changes | Permission/stop tests pass; live camera/WebGL claims require physical-device evidence |
| P2 | Desktop and Android | Build in supported native toolchains and test lifecycle, permissions, and upgrades | Windows installer smoke test and Android APK install/device QA |
| P3 | OAuth and messaging integrations | Identify provider/scope/token/storage requirements before adding connectors | Least-privilege OAuth, revocation, secure refresh, draft-first UX, and authorized account tests |
| P3 | General computer automation | Do not implement unrestricted automation; design a typed capability and policy boundary first | Explicit allowlist, preview, confirmation, cancellation, audit trail, and sandboxed E2E acceptance |

## Current Next Task

Verify the pinned Browser Research resolver in a launchable Chromium and examine subresource egress to private hostnames/IP literals. Add coverage and a narrow egress restriction only if a bypass is reproduced; preserve read-only behavior. Do not install host packages without system authorization.

## Completion Gates

A capability is `VERIFIED` only when its matrix acceptance criteria have evidence. `IMPLEMENTED` and `TESTED` are not equivalent to a live integration or device verification. The certification report must distinguish implementation, automated tests, live integrations, security, and release readiness.
