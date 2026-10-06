# Repository Rulesets

This directory holds the repository rulesets as JSON. GitHub does not read these files; an admin imports them under **Settings → Rules → Rulesets → New ruleset → Import a ruleset**. After importing, delete any older ruleset that covers the same branches or tags, such as a previous "Protect Main Branch" or "Protect dev (integration)" ruleset. The release process these rules support is described in [RELEASING.md](../../RELEASING.md).

## Rulesets

### `main.json`: Protect main

Applies to the default branch, `main`, which is the only long-lived branch and deploys to production on every push.

- **Pull request required.** Direct pushes are blocked. Only **squash** merges are allowed, so each PR title becomes one Conventional Commit on `main`.
- **Approvals:** `0`, because the project has a single maintainer and GitHub never lets authors approve their own PRs. Review threads must be resolved before merging.
- **Required status checks** (`integration_id` 15368 is GitHub Actions):
  - **CI**: the aggregate job in `.github/workflows/main.yml`. It succeeds only when setup, Dependency Audit, Consolidated Static Validation, Unit Tests, WebAssembly Reproducible Build, E2E Tests, Build and Lighthouse all succeed. Requiring one aggregate check means renaming or adding jobs never leaves a PR waiting on a check that no longer reports.
  - **PR Title**: `.github/workflows/pr-title.yml`, which enforces Conventional Commit titles.
  - **Workers Builds: qrcraftly**: Cloudflare's build of the PR branch. It has no `integration_id`, so any app reporting that name satisfies it. If Cloudflare ever renames the check, update it here.
- **Code scanning:** CodeQL (the repository's default setup) must report no high or critical security alerts and no error-level alerts on the PR, and GitHub Code Quality must report no error-level findings.
- **Branches must be up to date** with `main` before merging (`strict_required_status_checks_policy: true`), so every merge was tested against exactly what it lands on. The project prefers fewer, larger PRs, so re-running CI after a rebase is an acceptable cost.
- **Deletion and force pushes are blocked.**
- **No bypass.** Nothing merges into `main` until every required check is green, including for admins. An admin can still edit or disable the ruleset in an emergency.

These required checks are also what auto-merge waits for, so the ruleset must be imported before **Allow auto-merge** is turned on. Without it, an auto-merge PR would merge as soon as it is opened.

### `tags.json`: Protect release tags

Applies to `refs/tags/v*`.

- **Moving and deleting release tags is restricted** to repository admins.
- **Creating them is not restricted**, because the Release workflow creates `vX.Y.Z` with the GitHub Actions token when a release PR merges.

## Replacing the live ruleset

Ruleset names are unique, so to bring the live `main` ruleset in line with `main.json`: open **Settings → Rules → Rulesets**, delete the existing **Protect main** ruleset, then import `main.json`. Import `tags.json` the same way if **Protect release tags** is missing. Check the result without signing in:

```bash
curl -s https://api.github.com/repos/fderuiter/QRCraftly-web/rules/branches/main
```

It should list `required_status_checks` with the three checks above and `"required_approving_review_count": 0`.

## Format

Each file is a single raw JSON object (`{ ... }`), never an array, so it can be imported through the GitHub UI or the REST API. Check the syntax before importing:

```bash
node -e "for (const f of ['main','tags']) JSON.parse(require('fs').readFileSync('.github/rulesets/' + f + '.json'))"
```

## Keeping them in sync

When you change a ruleset file, import it again and check the rules under **Settings → Rules → Rulesets**. When you rename a job that a ruleset requires, update the ruleset in the same PR. Prefer adding the job to the `needs` of the aggregate **CI** job instead.
