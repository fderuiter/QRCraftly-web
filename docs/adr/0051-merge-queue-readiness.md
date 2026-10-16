---
status: accepted
---

# Merge Queue Readiness

## Context

The `main` ruleset requires every PR to be up to date with `main` before it merges ([ADR 0050](./0050-ci-tiers-for-a-private-repository.md)). That guarantees each merge was tested against exactly what it lands on, but every merge makes every other open PR out of date, and updating them re-runs CI on metered minutes. Google Labs Stitch now opens several PRs at a time, so this cost and the waiting grow with each one.

GitHub's merge queue solves this: it tests each queued PR on top of `main` and the PRs ahead of it, and merges them in order. It is only offered to repositories owned by an organization: public ones, or private ones on GitHub Enterprise Cloud. QRCraftly-web belongs to a personal account, so the ruleset cannot require a merge queue today. Moving the repository would also mean reconnecting Cloudflare Workers Builds and the GitHub apps.

## Decision

- **Today: a merge train run by one Claude thread.** Up to five PRs are reviewed and fixed in parallel. One thread updates and enables auto-merge (squash) on one ready PR at a time, and checks the deploy before the next. `main.json` stays the live ruleset.
- **Be ready for the queue.** `main.yml` and `pr-title.yml` also run on `merge_group`, so the required `CI` and `PR Title` checks report on queue groups. A group runs the ready-PR tier (`scripts/ci/ci_plan.js`). `.github/rulesets/main-merge-queue.json` holds the ruleset to import: up to five groups built at once, squash, only green PRs merge, and branches need not be up to date.

## Consequences

- Nothing changes in how PRs merge until the repository is owned by an organization and the merge-queue ruleset is imported.
- Once it is, a PR costs one PR run plus one group run, instead of one run per update while it waits.
- Whether Cloudflare reports `Workers Builds: qrcraftly` on `gh-readonly-queue/main/*` branches is unverified. The first queued PR shows it; if the check never appears, it comes off the merge-queue ruleset's required checks, since the `CI` Build job runs the same build.
- A group of up to five PRs can reach production in one push. Each PR in it still passed on its own, and each stays one squash commit that can be reverted alone.
