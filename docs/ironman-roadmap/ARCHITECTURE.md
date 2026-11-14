# Target architecture (incremental)

Keep the existing Node server and frontend as the foundation. Introduce capabilities behind interfaces so providers and platforms can be swapped.

```text
Web / PWA / Electron / Tauri Android
                 |
       UI + permission indicators
                 |
         Assistant Orchestrator
      (intent -> plan -> approvals)
                 |
       Typed Capability Registry
   /       |       |       |       \
Voice   Browser   Files   Vision   Integrations
   \       |       |       |       /
          Policy + Permission Layer
                 |
      Node API / Provider Adapters
       |       |       |        |
    Gemini  Ollama  OpenAI*  Home Assistant*
                 |
       Audit / Memory / Task Store
```

`*` Optional integrations, configured by the user.

## Boundaries
- UI never receives provider secrets.
- The model proposes typed actions; deterministic validators authorize them.
- The orchestrator cannot bypass the permission layer.
- Integrations expose narrow methods, not arbitrary API or shell access.
- Store only the minimum data needed for task continuity.
- Each capability has health status, timeout, cancellation, and test doubles.
- Keep native APIs behind Electron/Tauri adapters; browser builds degrade safely.
