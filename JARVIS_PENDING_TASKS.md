# J.A.R.V.I.S. Pending Tasks

Prioritized by the remaining acceptance gates, not by source-file count. Passing mocked tests do not replace live or device verification.

## P0 — Make hosted validation possible

- [ ] Decide how to publish the app: the primary project currently lives in an untracked nested directory, while the outer repository has a pre-existing deleted `README.md`. Do not stage, restore, commit, or push these user changes without authorization.
- [ ] Once the app is present on an authorized branch, run its `.github/workflows/ci.yml` workflow. No hosted Actions runs were found for the current GitHub repository.
- [ ] Review Browser Research redirects and subresource egress in a real browser. Unit tests cover public-DNS validation and pinning, but do not prove all Chromium navigation/subresource paths safe.

## P1 — Live integrations and release targets

- [ ] With operator-owned credentials, test Gemini/other configured AI providers and Gemini Live. Keep keys server-side; never add them to source or browser storage.
- [ ] Verify Google OAuth consent, redirect URI, refresh/revocation, persistence/restart, and disconnect with an authorized test account.
- [ ] Verify Telegram, Facebook Messenger, and Home Assistant against operator-owned test services, including recipient/device allowlists, confirmation, and rate limits.
- [ ] Build and smoke-test the unsigned Windows installer on Windows; test install, startup, update, uninstall, IPC, and voice lifecycle.
- [ ] Install Rust/Cargo and Android SDK/NDK/ADB on a supported runner; build/install the Tauri APK and test lifecycle, microphone, and camera permissions.

## P2 — Hardware and independent assurance

- [ ] Test voice recognition/TTS and interruptions on target microphones, speakers, and mobile browsers.
- [ ] Test WebGL/Three.js avatar, hologram, and Earth modes on target GPUs/devices, including context loss and reduced-motion behavior.
- [ ] Obtain an independent security review/penetration test before public production exposure.
- [ ] Review whether the byte-identical four-file Messenger copy should be archived or removed; retain it until an owner confirms its intended use.

## Blocked here

- Live provider, OAuth, messaging, and Home Assistant checks need operator-controlled accounts/credentials that are not configured.
- Hosted CI cannot validate this local project until it is published to a branch; remote workflow history is empty.
- Windows packaging and Android acceptance require unavailable platform toolchains/devices.
- No install, subscription, account creation, credential generation, or external penetration test was attempted.
