---
status: accepted
---

# Our Own Git Hooks and Staged-File Runner

## Context

[ADR 0010](./0010-husky-and-lint-staged-git-guardrails.md) put two packages in charge of the pre-commit checks. Husky set `core.hooksPath` from the `prepare` script so that git ran `.husky/pre-commit`, and lint-staged mapped globs in `lint-staged.config.js` to commands on the staged files. Together they were three lockfile packages for a small job. The lint-staged config also built shell strings by hand, quoting each file name itself.

[ADR 0040](./0040-in-house-first.md) asks for our own code first, and #1175 lists both packages for replacement (#1190). The checks themselves were not in question.

## Decision

We run the pre-commit checks with our own code. The checks and their order stay as they were.

1. **Install.** `"prepare": "node scripts/hooks/install.js"` runs `git config core.hooksPath .githooks`. It skips quietly when `CI` is set (not `0` or `false`), when the directory has no `.git` (tarballs, Cloudflare Workers Builds, installs inside a package) and when git fails.
2. **Hook.** `.githooks/pre-commit` is a POSIX `sh` script with `set -eu` that CI checks with ShellCheck. It runs `node scripts/hooks/staged.js`, then `pnpm run validate:duplication`, `pnpm run typecheck` and `pnpm test --run`.
3. **Rules.** `scripts/hooks/staged.config.js` holds the rule table that `lint-staged.config.js` held: the secret scanner, storage auditor, UI catalog validator, static path tracker and lineage auditor on every staged file; ESLint `--fix` and Prettier `--write` on JavaScript and TypeScript; Prettier on CSS, JSON and YAML; Prettier on Markdown, then the Markdown audit and the ADR validator once over the whole doc set.
4. **Runner.** `scripts/hooks/staged.js` reads the staged files with `git diff --cached --name-only -z --diff-filter=ACMR` and runs the rules in order through `scripts/utils/execHelper.js`:
   - Commands get argument arrays, never shell strings, so quotes, spaces and Windows paths need no escaping. `node` is the running Node binary; any other command is the `bin` script of a package in `node_modules`, run with Node, so no `.cmd` shims are involved.
   - File lists are split into chunks that keep each command line under 7,000 characters, below the Windows limit of 8,191.
   - A file with staged and unstaged changes is never rewritten. Fixers run in their read-only form on it (`eslint` without `--fix`, `prettier --check`), and a failure names the file and suggests `git add -p` or a manual fix.
   - A fully staged file that a fixer changed is staged again with `git add -- <files>`.
   - The run stops at the first failing command, prints which command failed on which files, and exits with code 1.

## Rationale

The installer, runner and rule table are about 400 lines we own and test (`tests/hooks/`), against three packages. Owning it also fixes two weak spots of the old setup. Lint-staged stashed unstaged changes and restored them after the fixers ran, which could leave a conflict behind. We never touch the unstaged part of a file, so there is nothing to restore. File names also no longer pass through hand-written shell quoting.

## Consequences

- `husky` and `lint-staged` are gone from `package.json` and the lockfile, and `.husky/` and `lint-staged.config.js` are deleted.
- Existing clones switch over on their next `pnpm install`. Until then `core.hooksPath` still points at the old, untracked `.husky/_` folder.
- A partly staged file that fails a fixer's check blocks the commit until it is staged whole or fixed by hand. Lint-staged would have fixed the staged part.
- `git commit --no-verify` still skips the hook. CI runs every check again (`pnpm run lint`, `pnpm test`), so the hook is a convenience, not the gate.
- The term is in `CONTEXT.md` under **Git Guardrails**.
