# Vision and smart-home specification

## Vision
- Capture begins only after a direct user action or a clearly enabled session.
- Show a persistent camera/screen indicator and stop control.
- Preview the capture before remote processing when practical.
- Do not identify people or infer identity from faces.
- Do not retain captures by default; redact secrets where feasible.
- Explain when the feature requires cloud processing.

## Smart home
- Start with Home Assistant and read-only entity status.
- Use a dedicated, revocable token and explicit entity allowlist.
- Separate read-state from control.
- Require fresh confirmation for locks, alarms, garage doors, ovens, and safety-critical devices.
- Never disable physical controls or safety interlocks.
- Log actions without storing unnecessary household activity history.
