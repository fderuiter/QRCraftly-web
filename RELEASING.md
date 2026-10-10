# Releasing QRCraftly

This is the single runbook for how code reaches production, how versions and tags are made, and how to roll back. QRCraftly is trunk-based: `main` is the only long-lived branch. The decision record is [ADR 0020](docs/adr/0020-trunk-based-releases-on-main.md).

## The flow at a glance

```
feat/*, fix/*, …  ──PR (squash, required checks green)──►  main ──► production (Cloudflare Workers Builds)
                                                                     qrcraftly.com
                                                                     qrcraftly.fpderuiter.workers.dev

release/vX.Y.Z    ──release PR (chore(release): vX.Y.Z)──►  main ──► Release workflow:
                                                                     tag vX.Y.Z → GitHub Release
                                                                     → wait for deploy → smoke tests
```

| Piece                                    | Owner                     | What it does                                                                                                    |
| ---------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `main`                                   | Pull requests only        | The trunk and repository default. Every commit on it passed CI through a squash-merged PR.                      |
| Deploys                                  | Cloudflare Workers Builds | Builds every push. `main` deploys to production; every other branch uploads a preview version with its own URL. |
| `package.json` `version`, `CHANGELOG.md` | Release PR                | Written by `pnpm run release:prepare`, reviewed and merged like any other change.                               |
| `vX.Y.Z` tags                            | Release workflow          | Created on the release commit when the release PR merges. Protected from being moved or deleted.                |
| `.github/workflows/main.yml`             | GitHub Actions            | Quality gate. The `CI` job aggregates every quality job. After each push to `main`, it smoke tests production.  |
| `.github/workflows/release.yml`          | GitHub Actions            | Tags a new `package.json` version, publishes the GitHub Release, and smoke tests production for that version.   |

## Environments

| Environment | Branch     | URL                                                                 | Deployed by                                    |
| ----------- | ---------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| Production  | `main`     | `https://qrcraftly.com`, `https://qrcraftly.fpderuiter.workers.dev` | Workers Builds, on every push to `main`        |
| PR previews | any branch | `https://<branch>-qrcraftly.fpderuiter.workers.dev` (noindex)       | Workers Builds preview version for that branch |

Every merge to `main` goes to production. The PR preview URL is the place to check a change before it merges; the Cloudflare bot posts it on each PR.

Every build writes `/version.json` (`{"version": "...", "commit": "..."}`), so you can check what an environment is serving:

```bash
curl -s https://qrcraftly.com/version.json
```

GitHub Actions holds no Cloudflare credentials and never deploys. Workers Builds reports its result as the `Workers Builds: qrcraftly` check on each commit.

## Day-to-day changes

Prefer fewer, larger PRs that each carry a complete, tested change, over many small ones. Every merge deploys to production, so each PR should be something you would ship on its own.

1. Branch from `main` with a standard prefix: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`, `agent/`.
2. Open a PR into `main`. Give it a [Conventional Commit](https://www.conventionalcommits.org/) title, such as `fix(scanner): handle empty frames`. The `PR Title` check enforces this.
3. Check the change on the branch preview URL, and wait for every required check to pass: `CI`, `PR Title` and `Workers Builds: qrcraftly`. If `main` moved, update the branch and let the checks run again. Nothing merges on a red or stale PR, admins included.
4. Turn on **auto-merge (squash)** once the PR is ready, or merge with **Squash and merge** yourself. The PR title becomes the commit subject on `main`, which is what the changelog and version bump are built from.
5. Cloudflare deploys it to production. The `Verify Production Deployment` job waits until production serves the new commit and runs the smoke tests against it.

### Auto-merge

Auto-merge lets a PR merge itself the moment it is green, so nobody has to come back and press the button.

- **Turn it on per PR** once the change is complete: **Enable auto-merge → Squash and merge** on the PR page, or `gh pr merge <number> --auto --squash`. Claude threads turn it on for the PRs they open.
- GitHub then merges when every required check passes: `CI` (setup, dependency audit, static validation, unit tests, E2E and build), `PR Title` and `Workers Builds: qrcraftly`. A red check leaves the PR open; push a fix and it merges when the checks go green.
- **Up to date first.** `main` requires branches to be current, and GitHub does not update them for you. When another PR merges first, press **Update branch** (or merge `main` in); CI runs again and the PR merges when it passes. Claude threads do this when they get the base-changed notice.
- **Never on release PRs.** A `chore(release): vX.Y.Z` PR publishes a version, so a maintainer merges it by hand.
- Enable it as a person (the button, `gh`, or a Claude thread acting for you), not from a workflow using `GITHUB_TOKEN`. GitHub does not start workflows from pushes made with that token, so the production smoke test and the Release workflow would never run after the merge.

### How titles map to versions

| Title                                                                             | Bump            |
| --------------------------------------------------------------------------------- | --------------- |
| `feat!: …`, `fix!: …`, or a `BREAKING CHANGE:` footer                             | major (`X.0.0`) |
| `feat: …`                                                                         | minor (`0.X.0`) |
| anything else (`fix`, `perf`, `refactor`, `docs`, `chore`, `ci`, `build`, `test`) | patch (`0.0.X`) |

While the version is `0.x`, breaking changes still bump the major version. Pass `--bump=minor` to `release:prepare` to stay on `0.x`.

## Cutting a release

A release names what is already running in production: it bumps the version, writes the changelog, tags the commit, and publishes release notes. Anyone who can open a PR can prepare one; merging it is the release.

1. Preview it:

   ```bash
   git checkout main && git pull --ff-only origin main
   pnpm run release:dry-run
   ```

2. Open the release PR:

   ```bash
   pnpm run release:prepare            # or: pnpm run release:prepare -- --bump=minor
   git push -u origin release/vX.Y.Z
   ```

   `release:prepare` refuses to run unless you are on a clean `main` that matches `origin/main`. It creates `release/vX.Y.Z`, updates `package.json` and `CHANGELOG.md`, and commits `chore(release): vX.Y.Z`. Edit the changelog on the branch if you want to reword entries, then open a PR into `main` titled `chore(release): vX.Y.Z`.

3. Squash-merge it by hand once `CI` passes (don't use auto-merge here). The **Release** workflow then:
   - verifies whether a GitHub Release already exists for the `package.json` version using `gh release view`
   - extracts release notes from `CHANGELOG.md` before creating or pushing tags, preventing orphaned tags if note extraction fails
   - creates the annotated tag `vX.Y.Z` idempotently and pushes it to origin
   - publishes or updates the GitHub Release with the extracted release notes
   - waits until both production URLs serve the new `/version.json`, then runs the smoke tests against each

If the workflow failed for an external reason (for example, network issues during release publishing or production deployment timeouts), rerun it from **Actions → Release → Run workflow** (or re-run the failed workflow run). When retried, the workflow detects if the Git tag was already pushed while the GitHub Release remains unpublished, extracts notes, updates tags idempotently, and publishes the GitHub Release automatically without requiring manual tag deletion or Git intervention. Rerunning is safe.

## Rolling back

Production problems are fixed in two steps: stop the bleeding, then fix forward.

1. **Roll back the deployment immediately.** In the Cloudflare dashboard, open **Workers & Pages → qrcraftly → Deployments** and roll back to the previous version. From a terminal you can also run `pnpm exec wrangler rollback` (it needs a Cloudflare login). This takes effect in seconds and does not touch Git. The next merge to `main` deploys over the rollback.
2. **Fix forward.** Open a PR with the fix, or a `revert:` of the bad change, and merge it. Cut a patch release if you want the fix recorded as a version.

Never push to `main` directly or force-push it; the `main` ruleset blocks both.

## Troubleshooting

**The Release workflow says `CHANGELOG.md` has no section for the version.**
Someone changed `package.json` `version` by hand. Revert that change, or run `pnpm run release:changelog` on a branch and merge it.

**A tag has the wrong version.**
Tags are protected. As an admin, delete the GitHub Release and the tag (`git push origin :refs/tags/vX.Y.Z`), fix the version with a new release PR, and let the workflow tag it again. Don't reuse a version that was already published; release the next patch instead.

**The Release workflow timed out waiting for production.**
Check the `Workers Builds: qrcraftly` check on the release commit. A failed Cloudflare build leaves production on the previous version. Fix it with a PR; the next successful deploy serves the release.

## One-time repository setup

These settings live in GitHub and Cloudflare, not in the repository, so an admin has to apply them.

- **Rulesets** (Settings → Rules → Rulesets → New ruleset → Import a ruleset): import `.github/rulesets/main.json` and `.github/rulesets/tags.json`, and delete any older ruleset they replace. See [.github/rulesets/README.md](.github/rulesets/README.md).
- **Merge button** (Settings → General → Pull Requests): allow squash merging, with the default commit message set to **Pull request title**. Enable **Automatically delete head branches**. Enable **Allow auto-merge**, but only after the `main` ruleset is imported: auto-merge waits for required checks, and without them it merges straight away.
- **Cloudflare Workers Builds** (Workers & Pages → qrcraftly → Settings → Build): check that the production branch is `main`, **Builds for non-production branches** is on (this is what serves PR previews), the build command is `pnpm run build`, and the deploy command is `npx wrangler deploy`.
