# Memory and agent specification

## Memory
- Separate conversation history from durable memory.
- Durable memory is user-visible and user-controlled.
- Provide inspect, edit, export, delete-one, and delete-all.
- Do not silently save sensitive personal details.
- Apply retention limits and encryption where appropriate.
- Deletion must also remove derived indexes/caches under the app's control.

## Agent workflow
1. Understand the request and identify missing details.
2. Create a bounded plan with estimated side effects.
3. Show the plan and obtain approval for risky actions.
4. Execute one step at a time through the typed capability registry.
5. Verify each result using independent evidence where possible.
6. Stop on permission errors, unexpected state, or budget/time limits.
7. Report completed, failed, skipped, and unverified steps separately.

Agents may propose code patches but must not silently modify production code, deploy, rotate credentials, or merge their own changes.
