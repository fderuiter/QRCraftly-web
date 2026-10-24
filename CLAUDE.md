# CLAUDE.md

Claude Code loads this file into every session. The invariants live in AGENTS.md, imported below, so there is one source of truth. Do not copy its rules here.

@AGENTS.md

## Claude Code in this repository

- To drive a pull request from branch to merge, follow `.claude/skills/steward/SKILL.md`.
- To build, run or screenshot the app, follow `.claude/skills/run-qrcraftly/SKILL.md`.
- Use the vocabulary in `CONTEXT.md`, and read `docs/adr/` before you change a settled decision.
- While you work, run the targeted checks in AGENTS.md's "Fast loop" section. Run the full `pnpm run lint` and `pnpm test --run` before a PR is ready.
