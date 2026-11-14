# Baseline report — Phase 0

This report was generated from the current repository state in this workspace on 2026-11-07. It records the actual commands run, environment, pass/fail counts, and the remaining blockers that prevent claiming full device-level completion.

## Scope and intent

The repository already contains a substantial J.A.R.V.I.S. codebase with server, desktop, PWA, browser tools, voice modules, and test coverage. The goal of Phase 0 is not to invent new features, but to confirm the baseline is healthy, identify risks, and ensure the project does not leak secrets or break the existing app.

## Short implementation plan

1. Confirm the runtime environment and dependency state.
2. Run the real project checks and record the results.
3. Verify the repo hygiene and secret-handling rules.
4. Identify any unsupported or unverified target-platform areas.
5. Continue to Phase 1 only after the earlier acceptance criteria are satisfied for the supported environment.

## Environment

- OS: Linux (Codespace/Dev Container)
- Node.js: v24.22.2
- npm: 11.19.1
- Python: Python 3.14.2
- Rust: not installed in this environment
- Workspace Git root: `/workspaces/JARVIS-IronMan`
- Application directory: `/workspaces/JARVIS-IronMan/JARVIS-IronMan/JARVIS` (the extracted project directory is untracked under the workspace root; existing files were preserved)

## Commands executed

```bash
npm test
npm run check
python3 -m unittest discover -s test -p 'browser_service_test.py'
python3 -m unittest discover -s test -p 'omnivoice_server_test.py'
npm run test:browser
npx playwright install chromium
npm audit --omit=dev
npm audit
npm audit fix --dry-run
git check-ignore -v .env .env.example
```

## Results

### Dependency installation

Command: `npm install`

Result: successful.

Evidence:
- 303 packages added
- exit completed without dependency resolution failure
- npm warned about 6 moderate vulnerabilities and deprecated transitive dependencies; no install breakage occurred

### Node tests

Baseline before this turn's implementation: `npm test`.

Result: pass.

Evidence:
- `347` tests passed before edits
- `0` failed
- after the Home Assistant control and camera capture changes, the current full suite passes `358` tests with `0` failures
- focused Home Assistant adapter/server tests pass `46` tests and Vision capture lifecycle tests pass `12` tests

### Python tests

Commands: the two `python3 -m unittest discover` commands above.

Result: pass.

Evidence:
- Browser service: 8 passed
- OmniVoice server: 5 passed
- OmniVoice tests emitted Python `ResourceWarning`s for temporary HTTP errors and a socket; test outcome remained successful

### Browser tests

Command: `npm run test:browser`.

Result: blocked before app assertions.

Evidence:
- Playwright enumerated 32 desktop/mobile cases
- Chromium exited with code 127 because `libatk-1.0.so.0` is absent from the container
- `npx playwright install chromium` downloaded Chromium, but does not install this OS-level shared library
- No browser-test pass or app regression is inferred from this launch failure
- A final focused `desktop-chromium` run enumerated 16 cases and all 16 failed at the same Chromium launch error, before app assertions

### Dependency audit

Commands: `npm audit --omit=dev`, `npm audit`, and `npm audit fix --dry-run`.

Results:
- Production dependency audit: 0 vulnerabilities
- Full lockfile audit: 6 moderate `minimatch` advisories in the Electron packaging toolchain
- The dry run left the project unchanged and still reported the advisories; `npm audit fix --force` proposes a breaking Electron Builder downgrade to 25.1.0
- No forced dependency downgrade was applied

### Resumed audit Node test summary (2026-11-07)

Result: pass after reproducing and fixing a null-body validation defect in the Home Assistant control endpoint.

Fresh evidence from the resumed checkpoint:
- `npm test`: `# tests 361`, `# pass 361`, `# fail 0`, `# skipped 0`
- Focused agent cancellation and UI tests: 17 passed, including abort while an approval decision is pending
- Focused Browser Research/agent/UI/service-worker tests: 18 passed, including authorization, cancellation propagation, and offline shell caching
- Focused Home Assistant HTTP regression: 1 passed; JSON `null` returns 400 instead of an internal 502
- `npm run check`: exit code `0` after the agent wiring and service-worker update, including avatar bundle build and configured JavaScript syntax checks
- `npm run build`: exit code `0` after the agent wiring
- `python3 -m unittest discover -s test -p 'browser_service_test.py'`: 10 passed after DNS-rebinding mitigation
- `python3 -m unittest discover -s test -p 'omnivoice_server_test.py'`: 5 passed; existing ResourceWarnings remain
- Full JavaScript syntax scan: passed for project `.js`, `.mjs`, and `.cjs` files, excluding `node_modules`
- `python3 -m compileall -q browser test voice`: passed
- `npm audit --omit=dev`: 0 vulnerabilities
- `npm audit`: 6 moderate `minimatch` advisories in the Electron packaging dependency tree; the suggested forced fix is a breaking electron-builder downgrade and was not applied
- Browser Research DNS rebinding: regression test confirms the globally resolved public address is pinned into the Chromium launch arguments; actual Browser Use/Chromium launch remains unverified because its Python dependency and host system library are unavailable
- Focused Home Assistant adapter/server tests: 46 passed, 0 failed
- Focused Vision capture lifecycle tests: 12 passed, 0 failed

See [`../../FINAL_100_PERCENT_AUDIT.md`](../../FINAL_100_PERCENT_AUDIT.md) and [`../../FEATURE_COMPLETION_MATRIX.md`](../../FEATURE_COMPLETION_MATRIX.md) for feature status, weighted implementation scoring, the distinction between code and live/device verification, and exact blockers. No `/tmp/jarvis-cert-*` logs were present at checkpoint recovery; the commands listed above were rerun and their final output was inspected.

Home Assistant integration tests use a local mocked upstream; no real Home Assistant instance or token was used.

### Phase 1 voice validation summary

The repository includes the Phase 1 voice stack and the automated tests currently pass in this environment, covering:
- microphone permission and speech-recognition guards
- microphone-track termination cleanup and a bounded Gemini Live session
- Hindi/English recognition language selection
- wake-word detection and recovery logic
- speech synthesis fallback and voice-output configuration
- noise gate and interruption monitoring
- Gemini Live session setup and voice flow logic
- PCM amplitude synchronization with the existing portrait/3D avatar hooks

This is a code-level and unit/integration pass, not a hardware-verified acceptance sign-off.

### Remaining-phase implementation in this workspace

Added an opt-in Home Assistant integration with server-only URL/token/entity configuration, allowlisted reads, a separate light/switch control allowlist, fixed confirmed on/off actions, post-action state verification, authenticated/rate-limited API access, a Settings status/control view, and mock unit/HTTP integration tests. No broad entity discovery or arbitrary service operation is exposed. Added one-frame camera capture to the existing explicit Vision workflow; browser indicator, preview-before-send, and stop paths are covered by mock lifecycle tests.

### Syntax and project validation

Command: `npm run check`

Result: pass.

Fresh evidence:
- `npm run build:avatar` completed successfully
- `node --check` ran for the project JS files without syntax failure
- exit code: `0`

### Secret and repo hygiene

The repo is configured to ignore `.env` values while leaving `.env.example` available as a template.

Fresh evidence:

```text
ENV IGNORE CHECK
JARVIS-IronMan/JARVIS/.gitignore:11:.env        .env
JARVIS-IronMan/JARVIS/.gitignore:13:!.env.example       .env.example
```

This confirms `.env` is excluded from Git tracking, matching the repository’s security guidance.

## Current status against the roadmap

### Phase 0 status: in progress

The code-level Node and Python checks pass and `.env` is ignored, but Phase 0 exit criteria are not cleared because the Playwright suite cannot launch in this container and the full dependency audit reports unresolved moderate development-dependency advisories.

### Remaining blockers / limitations

Remaining blockers and limitations:

1. Chromium requires the missing Linux library `libatk-1.0.so.0`; installing system packages requires a privileged container setup.
2. The Electron packaging dependency tree has 6 moderate `minimatch` advisories; the available npm forced fix downgrades Electron Builder across a breaking version boundary.
3. `npm run desktop:dist` created the Windows app directory and reached NSIS, then failed with `spawn wine ENOENT`; no complete installer is claimed and Windows lifecycle testing was not run.
4. `npm run tauri:android:build` failed at `cargo metadata`; Rust/Cargo and ADB are absent (Java is present), so no APK or physical-device installation was produced.
5. Real microphone, wake-word, camera, screen-capture, and Home Assistant behavior was not validated on hardware or a live Home Assistant instance.
6. No live Gemini/Ollama account or credentials were used.

## Security and permission posture

This baseline confirms the project keeps secrets out of source control and uses `.env`/environment-based configuration for provider credentials. The repository also exposes permission-aware logic and explicit user confirmations in the app code paths that are already under test.

## Conclusion

The code-level baseline is established, but Phase 0 is not marked complete. Node/Python checks pass, production dependencies are clean, and `.env` is ignored; browser launch and full development-dependency audit issues remain open. Phase 1 is implemented and automated-test-covered but not accepted on Windows or Android hardware.
