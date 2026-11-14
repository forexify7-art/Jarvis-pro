# Android and Windows release specification

## Android
- Verify microphone permission prompts and revocation.
- Verify TTS, audio focus, interruption, background/resume, and network changes.
- Verify screen sizes, keyboard behavior, safe areas, and battery use.
- Build signed APK/AAB only with user-controlled signing credentials.
- Never commit keystore files or passwords.

## Windows
- Test installer, first launch, firewall/network behavior, upgrade, uninstall, and data retention.
- Validate Electron IPC allowlists and context isolation.
- Do not enable Node integration in renderer.
- Keep native actions narrow and typed.
- Test on a clean Windows account and record OS/app versions.

## Browser/PWA
- Test installability, service-worker upgrades, offline shell, and stale cache recovery.
- Browser permission denial must degrade gracefully.
