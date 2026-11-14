# Feature catalog and acceptance criteria

| Feature | Required behavior | Minimum acceptance test |
|---|---|---|
| Wake word | Optional, opt-in, visible, local where feasible | Disabled by default; mute immediately stops detection |
| Hindi/English voice | Select language and recover from recognition errors | Test both languages on each supported device |
| Interruptible speech | User can interrupt TTS and submit new speech | Audio stops promptly and no stale response resumes |
| Voice fallback | Browser/Gemini/OmniVoice fallback is transparent | Simulate engine unavailable and verify fallback/status |
| Avatar lip sync | Mouth motion tracks speech; honest fallback label | Test audio start/stop, reduced-motion, no-WebGL fallback |
| Browser actions | Typed actions, allowlist, preview, approval | Denied domain and unapproved submit are blocked |
| Computer actions | Narrow allowlisted native actions | No arbitrary shell; permission denial is safe |
| File operations | User-picked roots, path validation, overwrite confirmation | Traversal paths rejected; delete requires confirmation |
| Email | Read/draft/send separated | Sending requires recipient + body preview + confirmation |
| Calendar | Read/create/update/cancel with scopes | Mutations require confirmation; revoke disconnects |
| Messaging | Draft before send | Exact recipient/message preview required |
| Vision | Explicit capture and visible indicator | No capture before user action; stop ends capture |
| Smart home | Allowlisted entities and risk-tier confirmation | Lock/alarm actions require fresh confirmation |
| Memory | Inspect/edit/export/delete | Deleted memory is not returned in subsequent retrieval |
| Agent planner | Plan, approval, execute, verify, report | Failed step is reported honestly; cancellation works |
| Android | Build and install on physical device | Mic, TTS, network, background/resume tested |
| Windows | Installer lifecycle works | Install, launch, update, uninstall smoke tests |
| Offline/PWA | Graceful offline behavior | Cached shell loads; remote-only features explain offline state |

A visible control without a working end-to-end flow does not satisfy acceptance.
