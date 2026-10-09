---
name: release
description: "Production release lifecycle: SemVer calculation, changelog generation, and release PRs into main."
license: MIT
metadata:
  author: QRCraftly
  version: "3.0"
---

# Release Skill

Use this skill when preparing, previewing, or executing a release. The full runbook is `RELEASING.md`; the decision record is ADR 0020.

## Non-Negotiable Invariants
1. **`main` is the only long-lived branch.** Every change, including a release, reaches it through a squash-merged PR that passes `CI` and `PR Title`. Never push to `main` directly.
2. **Every merge to `main` deploys to production** through Cloudflare Workers Builds. GitHub Actions never deploys.
3. **Never create tags or edit the `package.json` version by hand.** The release PR bumps the version; the Release workflow creates the tag when it merges.
4. **Conventional Commits**: PR titles are the squashed commit subjects that decide the SemVer bump (`feat:` -> minor, others -> patch, `!` or `BREAKING CHANGE:` -> major).

## Quick Reference

```bash
git checkout main && git pull --ff-only origin main
pnpm run release:dry-run                 # preview version and changelog
pnpm run release:prepare                 # creates release/vX.Y.Z with the bump commit
git push -u origin release/vX.Y.Z        # open a PR into main titled chore(release): vX.Y.Z
```

Squash-merging the release PR starts `.github/workflows/release.yml`. It verifies GitHub Release status via `gh release view`, extracts notes before tagging, creates the annotated tag `vX.Y.Z` idempotently, publishes the GitHub Release, waits for production to serve `/version.json` for the new version, and smoke tests production.

## Agents

Agents may run `release:dry-run` and `release:prepare` and open the release PR. Merging it publishes a release, so get the maintainer's go first.

## Rollback

Roll back the deployment in Cloudflare (dashboard or `wrangler rollback`), then fix forward with a PR. Never revert by pushing to `main`.
