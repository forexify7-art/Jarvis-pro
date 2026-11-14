# Security Audit

Source review date: 2026-11-08; browser acceptance updated 2026-11-14. This is a source-and-test review, not an external penetration test or production certification.

## Findings

| Severity / status | Finding | Evidence and action |
|---|---|---|
| Mitigated; packaging verification pending | Six `minimatch` dependency advisories | Scoped npm overrides resolve the affected Electron-builder dependency tree to patched `minimatch@11.0.5`; full `npm audit` now reports 0 vulnerabilities. A Linux directory-package attempt reached the Electron download and failed with upstream HTTP 504, so packaging/runtime compatibility is not fully verified. A legacy `glob@7` smoke test and all Node tests pass. |
| Resolved locally; CI pending | Browser E2E launch dependencies | Chromium host dependencies were installed with operator approval. All 34 Playwright desktop/emulated-mobile cases pass locally; the mobile portrait timing case passed 3 focused repeats. GitHub Actions and Browser Research runtime/subresource egress remain unverified. |
| Mitigated with residual verification gap | Browser Research DNS rebinding | Python validates all DNS answers as global and pins the first validated public address in Chromium's host-resolver rule; regression tests cover the generated rule. Actual Chromium navigation and subresource egress to other hostnames/IP literals remain unverified; use network isolation before public production exposure. |
| Implemented; live verification pending | Google Workspace OAuth | PKCE and one-time state, server-only AES-256-GCM encrypted token persistence, refresh/revocation, Gmail draft-only API, bounded Calendar reads, and confirmed Calendar writes are covered by mocked tests. No real OAuth account was configured. Google's `gmail.compose` scope also permits sending at the provider scope level, although JARVIS exposes no send action. |
| Partially implemented; live verification pending | Telegram bot messaging | Sending is limited to server-allowlisted numeric chat IDs, plain text, authenticated/rate-limited requests, and explicit confirmation. No live bot/chat was configured. |
| Partially implemented; live verification pending | Facebook Messenger replies | Uses a server-only Page token, allowlisted Page-scoped recipient IDs, authenticated/rate-limited plain-text RESPONSE messages, and exact confirmation. No live Meta Page was configured; the standard messaging window applies. |
| Incomplete by design | General desktop control | No arbitrary shell, mouse, keyboard, or window-control endpoint is exposed. Platform-specific permission and confirmation design is needed before implementation. |
| Verification gap | No external penetration test, live integration test, or native-device security test | Record as unverified. No secrets or live accounts were configured for this audit. |

No critical or high-severity issue was found in the reviewed results, but this is not a claim that none exists across the entire dependency tree or production deployment.

## Existing Controls Confirmed In Code/Tests

- API access key is checked server-side when configured; production refuses to serve an unlocked API when `APP_ACCESS_TOKEN` is missing.
- Provider and Home Assistant credentials remain on the server; tests assert non-disclosure and redacted errors. `.env` is ignored and `.env.example` is permitted.
- CSP, CORS allowlisting, request validation, request-size limits, rate limits, and route-specific authentication exist.
- Electron disables Node integration, enables context isolation and sandboxing, validates main-frame/origin IPC, and exposes narrow external-link/write-only clipboard methods.
- File ZIP paths and supported entry sizes are checked; app-local file operations do not expose arbitrary host filesystem access.
- Browser research is intended to be read-only; it uses a public URL check and a loopback service. General computer control and arbitrary shell execution are not exposed.
- Home Assistant has a separate read allowlist and light/switch control allowlist, fixed on/off operations, explicit confirmation, authentication, rate limiting, and post-action state verification. Tests use mocks; no live service was configured.
- Google Workspace secrets remain server-side. The OAuth flow uses PKCE/S256 and five-minute single-use state, stores only encrypted tokens under `.data/` with owner-only permissions, and offers no Gmail send endpoint. Calendar event creation requires exact `confirmed: true` and a user confirmation dialog.
- Telegram uses a fixed HTTPS API host and server-only bot token. The server validates a numeric recipient against a maximum-50-item allowlist, limits message size, rate-limits sends, and requires exact confirmation; no inbound update/polling endpoint exists.
- Facebook Messenger uses the fixed Meta Graph API host and keeps the Page token in the server authorization header. The API version is validated, Page-scoped recipients are allowlisted, text is size-limited, sends are rate-limited and confirmed, and only the standard RESPONSE type is exposed.

## Required Follow-Up

1. Run the new GitHub Actions browser job and exercise the real DNS pinning and subresource egress behavior; the local container cannot launch Chromium.
2. Verify Google OAuth against a test account, review the provider's `gmail.compose` scope impact, and verify persistent storage/restart behavior in the target deployment.
3. Run the configured Windows installer job and smoke-test its artifact; build Tauri on an Android device because native toolchains are unavailable here.
4. Verify Telegram against an operator-owned bot and Facebook Messenger against an operator-owned Meta Page/recipient; define explicit provider/recipient policies before adding other messaging connectors or desktop automation.
5. Perform an independent security review before public production exposure; retain redacted evidence only.
