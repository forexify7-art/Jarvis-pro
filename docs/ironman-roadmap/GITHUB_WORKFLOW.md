# GitHub upload and implementation workflow

1. Extract this ZIP. The repository root is the `JARVIS/` folder.
2. Create a new empty GitHub repository.
3. Upload/push the **contents** of `JARVIS/` as the repository root (not an extra nested `JARVIS/JARVIS` folder).
4. Before publishing, inspect `.env`, `.env.*`, tokens, private keys, model files, logs, and local user data. `.gitignore` already excludes common secrets, but verify manually.
5. Add repository secrets only through GitHub Actions settings; never commit them.
6. Ask the coding agent to read `IRONMAN_UPGRADE_README.md` and `docs/ironman-roadmap/00_MASTER_IMPLEMENTATION_PROMPT.md`.
7. Instruct it to work on a new branch, inspect first, implement one phase at a time, run tests, and open a pull request with a summary and test evidence.
8. Review every diff and permission change before merging.

Suggested first agent task:

> Read the master implementation prompt and all current project docs. Inspect the complete repository and produce `docs/ironman-roadmap/BASELINE_REPORT.md`. Do not implement speculative features yet. Run available checks, identify the real current status, list blockers, and propose the smallest safe Phase 0 pull request.

Do not paste API keys into chat prompts, issues, commits, or source files.
