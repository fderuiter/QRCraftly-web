---
name: setup-pre-commit
description: "Install, run or change this repo's own pre-commit hook (.githooks/pre-commit and the staged-file runner scripts/hooks/staged.js). Use when the hook is not running, when a commit-time check needs adding or changing, or when a pre-commit failure needs explaining."
license: MIT
---

# Pre-Commit Hook

QRCraftly runs its own pre-commit hook, with no hook packages ([ADR 0044](../../../docs/adr/0044-own-git-hooks-and-staged-file-runner.md)).

## Parts

- `scripts/hooks/install.js`: run by `pnpm install` (the `prepare` script). Sets `git config core.hooksPath .githooks`. Skips under `CI` and without `.git`.
- `.githooks/pre-commit`: POSIX `sh`. Runs `node scripts/hooks/staged.js`, then `pnpm run validate:duplication`, `pnpm run typecheck` and `pnpm test --run`.
- `scripts/hooks/staged.config.js`: the rule table. Each rule has a `match` test on the staged path and commands as argument arrays. A fixer has a `run` form (`--fix`, `--write`) and a read-only `check` form. `files: false` runs a whole-set check once.
- `scripts/hooks/staged.js`: runs the rules on the staged files. Partly staged files are checked, never rewritten. Fully staged files a fixer changed are staged again.

## Steps

### The hook does not run

1. Run `pnpm install`, or `node scripts/hooks/install.js` directly.
2. Check `git config core.hooksPath` prints `.githooks`.
3. Check `.githooks/pre-commit` is executable (`git ls-files --stage .githooks/pre-commit` shows `100755`).

### Add or change a check

1. Edit `scripts/hooks/staged.config.js`. Use `node` with a script path, or the name of a package in `node_modules` whose `bin` runs with Node. Never build a shell string.
2. Give every fixer a `check` form.
3. Update `tests/hooks/staged.test.ts`, which pins the table.
4. Run `pnpm exec vitest --run tests/hooks`.

### A commit failed

- The summary names the command and the files. Fix them, stage them and commit again.
- "has unstaged changes, so it was checked, not fixed": stage the whole file, or the fix with `git add -p`, or fix it by hand.
- `git commit --no-verify` skips the hook. CI runs every check again.
