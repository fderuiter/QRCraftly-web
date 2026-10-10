---
status: superseded
superseded_by: 0044
---

# Husky and Lint-Staged Git Guardrails

> Superseded by [ADR 0044](./0044-own-git-hooks-and-staged-file-runner.md): our own `.githooks/pre-commit`, installed by `scripts/hooks/install.js` and running `scripts/hooks/staged.js`, replaced Husky and lint-staged (#1190). The checks stayed the same. This record is kept for history.

## Context

To prevent broken builds, formatting regressions, and unformatted code from entering the repository, git hooks run pre-commit checks. Previously, `simple-git-hooks` was used alongside npm scripts. However, modern multi-agent development workflows and distributed contributors require robust hook lifecycle management, precise staging-aware formatting via `lint-staged`, and reliable cross-platform execution on Windows, macOS, and Linux without shell divergence.

## Decision

We standardize on **Husky v9** combined with **lint-staged** for client-side pre-commit validation:

1. **Standardized Hook Orchestration**: Husky v9 manages `.husky/pre-commit` as a lightweight shell entry point executed automatically by Git.
2. **Staged Formatting & Audit Gate**: `lint-staged` runs the secret scanner, storage privacy auditor, UI catalog validator, static path tracker, and git lineage auditor on every staged file, then `eslint --fix` and Prettier on staged code, and Prettier on staged JSON, CSS, Markdown, and YAML files before commit finalization.
3. **Repository Definition**: `lint-staged.config.js` is the single lint-staged configuration (a `.lintstagedrc` or a `lint-staged` block in `package.json` would take precedence and silently disable it, so neither may exist), and `package.json` configures `"prepare": "husky"`.

## Rationale

Husky is the industry-standard hook manager with zero-overhead POSIX script execution across all major operating systems. Paired with `lint-staged`, it ensures that formatting invariants are enforced on changed files prior to commit creation, eliminating formatting-only CI failures.

## Consequences

- Commits automatically format staged assets prior to commit creation.
- Tooling is documented in `CONTEXT.md` under `Git Guardrails`.
- Automated tests and CI pipelines continue to verify repository-wide format compliance via `prettier --check .` and `pnpm run lint`.
