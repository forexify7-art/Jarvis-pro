# Email, calendar, and messaging specification

- Use official provider APIs and OAuth; no password scraping.
- Request least-privilege scopes and explain each scope in plain language.
- Read, draft, and send are separate capabilities.
- Default behavior is draft-only.
- Before send, show exact recipient(s), subject, full body, attachments, and account identity.
- Calendar changes show title, date, timezone, attendees, and recurrence before confirmation.
- Messaging shows exact contact/number and full message before confirmation.
- Provide disconnect/revoke, token expiry handling, and data deletion controls.
- Use mock providers in automated tests; real account tests require explicit user setup.
