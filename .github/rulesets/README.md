# Repository Rulesets

This directory holds the repository rulesets as JSON. GitHub does not read these files; an admin imports them under **Settings → Rules → Rulesets → New ruleset → Import a ruleset**. After importing, delete any older ruleset that covers the same branches or tags, such as a previous "Protect Main Branch" or "Protect dev (integration)" ruleset. The release process these rules support is described in [RELEASING.md](../../RELEASING.md).

## Rulesets

### `main.json`: Main branch

Applies to the default branch, `main`, which is the only long-lived branch and deploys to production on every push.

- **Pull request required.** Direct pushes are blocked. Only **squash** merges are allowed, so each PR title becomes one Conventional Commit on `main`.
- **Approvals:** `0`, because the project has a single maintainer and GitHub never lets authors approve their own PRs. Review threads must be resolved before merging.
- **Required status checks** (`integration_id` 15368 is GitHub Actions):
  - **CI**: the aggregate job in `.github/workflows/main.yml`. It succeeds only when Plan, Dependency Audit, Consolidated Static Validation, Unit Tests, WebAssembly Reproducible Build, E2E Tests, Build and Lighthouse all succeed or were skipped by the plan (for example E2E on a draft PR). Requiring one aggregate check means renaming or adding jobs never leaves a PR waiting on a check that no longer reports.
  - **PR Title**: `.github/workflows/pr-title.yml`, which enforces Conventional Commit titles.
  - **Workers Builds: qrcraftly**: Cloudflare's build of the PR branch. It has no `integration_id`, so any app reporting that name satisfies it. If Cloudflare ever renames the check, update it here.
- **No code scanning rules.** The repository is private, and CodeQL and Code Quality need paid GitHub security products there, so a `code_scanning` or `code_quality` rule would block every merge ([ADR 0050](../../docs/adr/0050-ci-tiers-for-a-private-repository.md)). Semgrep, the secret scanner and `pnpm audit` run in `CI` instead.
- **Branches must be up to date** with `main` before merging (`strict_required_status_checks_policy: true`), so every merge was tested against exactly what it lands on. The project prefers fewer, larger PRs, so re-running CI after a rebase is an acceptable cost.
- **Deletion and force pushes are blocked.**
- **Linear history** (`required_linear_history`): no merge commits on `main`. Squash-only merging already gives this; the rule keeps it true if the merge settings ever change.
- **Signed commits** (`required_signatures`): every commit on `main` must carry a verified signature. GitHub signs the squash commits it makes when a PR merges, so this changes nothing for normal merges and rejects any unsigned commit that reaches `main` some other way.
- **Stale reviews are dismissed** when new commits are pushed (`dismiss_stale_reviews_on_push`), so an approval always covers the code that merges.
- **No bypass.** Nothing merges into `main` until every required check is green, including for admins. An admin can still edit or disable the ruleset in an emergency.

These required checks are also what auto-merge waits for, so the ruleset must be imported before **Allow auto-merge** is turned on. Without it, an auto-merge PR would merge as soon as it is opened.

### `main-merge-queue.json`: Main branch, with a merge queue

The same ruleset as `main.json`, ready for the day the repository can use GitHub's merge queue ([ADR 0051](../../docs/adr/0051-merge-queue-readiness.md)). GitHub offers merge queues only to repositories owned by an organization (public, or private on GitHub Enterprise Cloud), so it cannot be imported while the repository belongs to a personal account. Until then `main.json` stays live.

It differs from `main.json` in two places:

- **Merge queue** (`merge_queue`): squash merges, up to **5 groups built at once**, up to 5 PRs merged in one push, no waiting for a minimum group, **only green PRs merge** (`ALLGREEN`), and a 90-minute timeout for the checks.
- **Branches need not be up to date** (`strict_required_status_checks_policy: false`). The queue tests each PR on top of the newest `main` and the PRs ahead of it, so updating branches by hand would only re-run CI.

`CI` and `PR Title` report on queue groups because `main.yml` and `pr-title.yml` also run on `merge_group`. `Workers Builds: qrcraftly` only reports if Cloudflare builds the queue's `gh-readonly-queue/main/*` branches. After importing, watch the first queued PR: if that check never appears on its group, remove it from this file's required checks (the `CI` Build job runs the same `pnpm build`) and import again.

### `tags.json`: Release tags

Applies to `refs/tags/v*`.

- **Moving and deleting release tags is restricted** to repository admins.
- **Creating them is not restricted**, because the Release workflow creates `vX.Y.Z` with the GitHub Actions token when a release PR merges. A `creation` rule would need the GitHub Actions app as a bypass actor, and GitHub rejects that actor ("invalid actors") on a repository owned by a personal account. Publish releases only through the release PR ([RELEASING.md](../../RELEASING.md)), never from the GitHub UI.

## Replacing the live ruleset

To bring the live `main` ruleset in line with `main.json`, open **Settings → Rules → Rulesets**. Ruleset names are unique: if the live ruleset has a different name, import `main.json` first and then delete the old one, so `main` is never unprotected; if the names match, delete the old one and import `main.json` straight away. Import `tags.json` the same way if **Release tags** is missing. Rulesets that predate these names were called **Protect main**, **Protect main v2** and **Protect release tags**. Check the result without signing in:

```bash
curl -s https://api.github.com/repos/fderuiter/QRCraftly-web/rules/branches/main
```

It should list `required_status_checks` with the three checks above and `"required_approving_review_count": 0`.

## Format

Each file is a single raw JSON object (`{ ... }`), never an array, so it can be imported through the GitHub UI or the REST API. Check the syntax before importing:

```bash
node -e "for (const f of ['main','main-merge-queue','tags']) JSON.parse(require('fs').readFileSync('.github/rulesets/' + f + '.json'))"
```

## Keeping them in sync

When you change a ruleset file, import it again and check the rules under **Settings → Rules → Rulesets**. When you rename a job that a ruleset requires, update the ruleset in the same PR. Prefer adding the job to the `needs` of the aggregate **CI** job instead.
