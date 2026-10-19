---
status: accepted
---

# Trunk-Based Development and Release PRs on main

## Context

ADR 0018 kept two long-lived branches: `dev` for integration and staging, and `main` for production, advanced by a local, admin-only fast-forward promotion. On 2026-09-30 the maintainer merged `dev` into `main` and deleted `dev`, making `main` the only branch. Cloudflare Workers Builds already deploys `main` to production on every push, and builds every other branch as a preview version.

## Decision

1. **`main` is the trunk.** All work branches from `main` and returns through squash-merged pull requests that pass the `CI` and `PR Title` checks. There is no integration or staging branch.
2. **Every merge to `main` deploys to production** through Cloudflare Workers Builds. PR branch preview URLs replace the `dev` staging environment. After each push, `main.yml` waits for production to serve the commit and smoke tests it.
3. **A release is a merged release PR.** `pnpm run release:prepare` creates `release/vX.Y.Z` with the version bump and changelog. When it merges, `release.yml` sees a `package.json` version without a tag, creates the annotated tag on that commit, publishes the GitHub Release, and smoke tests production for that version. The local `release:promote` step and its admin-only push are removed.
4. **Rulesets:** `main` requires a pull request (squash only), an up-to-date branch, and the `CI`, `PR Title` and `Workers Builds: qrcraftly` checks, with no bypass. It blocks deletion and force pushes. The maintainer's rule is fewer, larger, well-tested PRs, and nothing merges until full CI is green. Release tags can be created by the Release workflow but cannot be moved or deleted except by admins. The `dev` ruleset is removed.
5. **Auto-merge.** A completed PR has auto-merge (squash) turned on, so it merges as soon as the required checks pass. The `CI` aggregate includes the dependency audit, so "green" means the whole pipeline. Auto-merge is enabled by a person or a Claude thread acting for one, never by a workflow's `GITHUB_TOKEN`, whose pushes don't start the post-merge workflows. Release PRs are merged by hand.
6. **Rollback** stays a Cloudflare version rollback followed by a fix-forward PR.

## Consequences

- Releases no longer need a local clone or an admin. Anyone who can merge a PR can cut one.
- A version tag labels what production already runs; it does not gate the deploy. If production ever needs to be gated on tags, GitHub Actions would have to deploy with `wrangler` and a Cloudflare API token instead of Workers Builds.
- The `dev-qrcraftly` staging URL is gone. Changes are checked on their PR preview URL before merging.
- This supersedes ADR 0018 points 2, 3, 4 and 7 and the `dev`/`main` split in ADRs 0011, 0012 and 0013. ADR 0018's decisions on Cloudflare-owned deploys, the aggregate `CI` check, tag-driven publishing and rollback still stand.

## Amendment (2026-10-19)

Point 5 no longer lets a Claude thread turn on auto-merge by itself. The maintainer merges every PR, by hand or with auto-merge. A Claude thread marks its PR ready for review once it is complete and green, and merges it or turns on auto-merge only when the maintainer says so in words for that PR. Auto-merge cannot tell whether the previous merge has finished deploying, and every merge goes to production.
