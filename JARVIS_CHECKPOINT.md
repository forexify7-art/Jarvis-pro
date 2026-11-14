# J.A.R.V.I.S. Checkpoint

Updated: 2026-11-14

## Resume from here

1. Read `JARVIS_PROGRESS.md` and `JARVIS_PENDING_TASKS.md` before repeating work.
2. The main app is the large `JARVIS-IronMan` directory beneath `Jarvis pro/Jarvis-complete--main/`; the parent contains separate supplied material and a four-file duplicate.
3. This app tree is currently untracked by the outer Git repository. The outer `README.md` deletion and untracked `Jarvis pro/` directory predate this work. Preserve both; do not restore, stage, commit, or push without instruction.
4. The unified interface is intentional. Preserve all original portrait files exactly.
5. Re-run `npm ci`, `npm run check`, `npm test`, `python3 -m unittest discover -s test -p '*_test.py'`, and `npm run test:browser` from the app root when source or dependencies change.
6. External acceptance requires operator credentials/accounts, hosted CI after authorized publication, and Windows/Android hardware/toolchains. Do not invent credentials or report those checks as passing.
7. Copilot is available in this environment; Gemini CLI is absent. No automatic cross-provider switch, remaining-quota check, or alternate-provider operation has been verified.

## Last verified test state

- `npm run check`: pass.
- Node: 410 passed, 0 failed.
- Python: 15 passed, 0 failed; no resource warnings after test cleanup.
- Playwright: 34 passed, 0 failed (desktop Chromium and emulated Android mobile).
- `npm audit --audit-level=moderate`: 0 vulnerabilities.

## Final package

- Archive target: `../../../../JARVIS-final.zip`, containing the primary app source and required assets/configuration, not `node_modules`, test results, caches, or real `.env` files.
- The full portrait PNG is included unchanged.
