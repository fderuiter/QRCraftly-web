---
name: steward
description: How to drive a QRCraftly pull request to merged. Use when opening a PR, handling CI or review events on it, updating its branch, or deciding whether to merge.
---

# Steward: driving a QRCraftly PR to merged

`AGENTS.md` holds the invariants and `RELEASING.md` holds the release flow. This skill is the loop for one PR. Where they disagree, they win.

## Before the first push

1. Branch from current `main` with a prefix: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`, `agent/`, or `claude/` for the branch a Claude session is given.
2. Run the checks a contributor runs locally, in this order, and fix everything before pushing:
   - `pnpm run lint`
   - `pnpm test -- --run`
   - `pnpm build` when the change touches the build, routing, the generator or `public/`
   - `pnpm test:e2e` when the change touches navigation, rendering or input flows
3. Run `pnpm run docs:sync` after changing anything in `src/components/ui/`, `src/components/inputs/`, `src/components/style-controls/`, `docs/public/` or `docs/SECURITY.md`, and commit what it writes.
4. If you touch a file in `MAPPING` in `scripts/git_lineage_auditor.js`, update the paired doc in the same PR.

## Opening the PR

- The title is a Conventional Commit (`fix(scanner): handle empty frames`). It becomes the squash commit and drives the version bump, so pick `feat` versus `fix` deliberately.
- The base is always `main`. There is no `dev` branch.
- Prefer one complete, tested PR over a chain of small ones. Every merge deploys to production.

## Getting it green

The required checks are `CI`, `PR Title` and `Workers Builds: qrcraftly`.

- **Out of date with `main`**: merge `main` into the branch (never rebase or force-push a branch someone else owns), re-run the local checks, push.
- **`CI` red**: open the failing job's log, reproduce the failure locally, fix the root cause, show the same check passing, push. A failing test is never an infra flake until you have shown it fails the same way on `main`.
- **`Workers Builds: qrcraftly` red**: the Cloudflare build runs `pnpm run build`; reproduce it with `pnpm build`.
- **Bundle size**: CI runs `pnpm run check-bundle-size` after the build. Shrink the change rather than raising the budget.
- Never skip, disable or quarantine a test, push an empty commit, or close and reopen a PR to re-trigger CI.

## Reviews

- Fix small, local review asks (nits, renames, an added test) and push.
- Larger asks on someone else's PR: reply with a proposal and let the author decide.
- Resolve the threads you addressed.

## Merging

- Merge only when every required check is green on the current head. Local checks alone never justify a merge.
- Enable auto-merge (squash) on a PR you opened once it is complete; GitHub merges it when the checks pass.
- **Never** enable auto-merge on, or merge, a `chore(release): vX.Y.Z` PR. A maintainer merges those by hand.
- No admin bypass of the `main` ruleset.

## After the merge

Check that `main`'s `CI` run (including **Verify Production Deployment**) and the `Workers Builds: qrcraftly` check pass on the merge commit before merging the next PR. `curl -s https://qrcraftly.com/version.json` shows which commit production serves. If production broke, roll back in Cloudflare first, then fix forward with a PR (see `RELEASING.md`).

## Things a PR must never add

Ads, analytics, telemetry, diagnostics pings or third-party scripts (`docs/PLEDGE.md`); server-side redirects, D1 or Turnstile (dynamic QR codes were dropped for good); user input sent over the network or put in URL query strings; new persistent storage keys outside the allowlist in `AGENTS.md`.
