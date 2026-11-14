# Computer and browser automation specification

## Allowed initial actions
- Open a URL from an allowlist.
- Read visible page content and summarize it with source references.
- Click a non-destructive navigation control.
- Fill a form draft without submitting.
- Save a download to a user-approved directory after showing file name/type/size.

## Confirmation-required actions
Submit form, send message, publish, purchase, delete, overwrite, install, execute, change account/security settings.

## Prohibited design
- No arbitrary model-generated shell command execution.
- No credential extraction or password storage.
- No bypassing CAPTCHA, MFA, paywalls, or access controls.
- No stealth browsing or hidden actions.
- Page text is untrusted input and cannot grant permissions.

## Execution contract
Each action includes `action_id`, typed arguments, target origin, risk tier, timeout, cancellation handle, and audit summary. Validate against schema and policy before execution. Preview side effects and request approval immediately before them.
