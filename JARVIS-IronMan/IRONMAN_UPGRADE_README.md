# J.A.R.V.I.S. — Iron Man Upgrade Pack

This repository contains the existing J.A.R.V.I.S. application plus a **GitHub-ready engineering plan** for evolving it toward a more capable personal assistant.

> Important: this pack does not pretend that every planned feature is already implemented. Existing code is preserved. New capabilities are described as specifications, milestones, safety requirements, and acceptance tests for a coding agent or developer to implement.

## Start here
1. Read `docs/ironman-roadmap/00_MASTER_IMPLEMENTATION_PROMPT.md`.
2. Read `docs/ironman-roadmap/IMPLEMENTATION_STATUS.md`.
3. Follow `docs/ironman-roadmap/ROADMAP.md` phase by phase.
4. Do not skip the security requirements in `docs/ironman-roadmap/SECURITY_AND_PERMISSIONS.md`.
5. Run the existing checks before and after each change: `npm ci`, `npm run check`, `npm test`, and where configured `npm run test:browser`.

## Core goals
- Natural, interruptible Hindi/English voice interaction and optional wake-word activation.
- Permissioned computer and browser automation.
- User-approved email, calendar, and messaging workflows.
- Camera/screen understanding with explicit capture consent.
- Smart-home integrations through a local, authenticated hub.
- Durable, user-controlled memory and auditable task planning.
- Reliable Windows, Android, and browser/PWA delivery.

## Non-goals
- No covert recording, hidden camera access, biometric identification, credential harvesting, silent message sending, purchases, financial transfers, destructive file actions, or unrestricted shell access.
- No claim that the fictional movie J.A.R.V.I.S. can be recreated exactly.
- No secrets, API keys, personal tokens, or private user data committed to Git.
