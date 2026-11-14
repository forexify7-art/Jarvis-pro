# J.A.R.V.I.S. Changelog

## 2026-11-14 — Workspace audit and verification

- Recalculated the weighted code-side implementation estimate as 66.36% from the existing 100-point feature matrix; documented the separate live/device acceptance gaps.
- Ran the configured JavaScript check, all 410 Node tests, all 15 Python tests, all 34 desktop/emulated-mobile Playwright cases, and the full npm dependency audit; all passed and the audit reported zero vulnerabilities.
- Updated the OmniVoice Python test harness to close HTTP error responses and shut down, close, and join its test server, eliminating the observed resource warnings.
- Confirmed a secondary Messenger module/test copy is byte-identical to the primary copy; made no deletion.
- Preserved the original portrait and left application functionality/configuration unchanged.
- Added `JARVIS_PROGRESS.md`, `JARVIS_PENDING_TASKS.md`, `JARVIS_CHANGELOG.md`, and `JARVIS_CHECKPOINT.md` for resumable work.
