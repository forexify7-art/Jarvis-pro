# Release checklist

- [ ] `npm ci` succeeds from a clean checkout.
- [ ] `npm run check` succeeds.
- [ ] `npm test` succeeds; any skip/failure is explained.
- [ ] Browser tests succeed in CI or have documented environment blockers.
- [ ] Python sidecar tests succeed where Python dependencies are available.
- [ ] No secrets in tracked files, build artifacts, logs, or source maps.
- [ ] `.env.example` contains placeholders only.
- [ ] Permission prompts and stop controls tested.
- [ ] High-impact actions require confirmation.
- [ ] Offline and provider-unavailable states tested.
- [ ] Windows installer tested on Windows.
- [ ] Android APK installed and tested on a physical device.
- [ ] Version, changelog, checksums, and rollback notes recorded.
- [ ] `IMPLEMENTATION_STATUS.md` updated with evidence and device details.
