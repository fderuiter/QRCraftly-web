---
status: accepted
---

# Merge Queue Readiness

## Context

The `main` ruleset requires every PR to be up to date with `main` before it merges ([ADR 0050](./0050-ci-tiers-for-a-private-repository.md)). That guarantees each merge was tested against exactly what it lands on, but every merge makes every other open PR out of date, and updating them re-runs CI on metered minutes. Bots such as Google Labs Stitch can open several PRs at a time, so this cost and the waiting grow with each one.

GitHub's merge queue solves this: it tests each queued PR on top of `main` and the PRs ahead of it, and merges them in order. It is only offered to repositories owned by an organization: public ones, or private ones on GitHub Enterprise Cloud. QRCraftly-web belongs to a personal account, so the ruleset cannot require a merge queue today. Moving the repository would also mean reconnecting Cloudflare Workers Builds and the GitHub apps.

## Decision

- **Today: `main.json` stays the live ruleset.** PRs merge one by one with auto-merge (squash), updating their branch when `main` moves.
- **Be ready for the queue.** `main.yml` and `pr-title.yml` also run on `merge_group`, so the required `CI` and `PR Title` checks report on queue groups. A group runs the ready-PR tier (`scripts/ci/ci_plan.js`). `.github/rulesets/main-merge-queue.json` holds the ruleset to import: up to five groups built at once, squash, only green PRs merge, and branches need not be up to date.

## Consequences

- Nothing changes in how PRs merge until the repository is owned by an organization and the merge-queue ruleset is imported.
- Once it is, a PR costs one PR run plus one group run, instead of one run per update while it waits.
- Whether Cloudflare reports `Workers Builds: qrcraftly` on `gh-readonly-queue/main/*` branches is unverified. The first queued PR shows it; if the check never appears, it comes off the merge-queue ruleset's required checks, since the `CI` Build job runs the same build.
- A group of up to five PRs can reach production in one push. Each PR in it still passed on its own, and each stays one squash commit that can be reverted alone.

## Amendment (2026-10-19)

The first version of this record also held Google Labs Stitch PRs on the quick CI tier until a maintainer added a `ci-approved` label, behind a required `Stitch review` commit status, and ran a Claude merge train. Both were removed: bot PRs now go through the same CI tiers, rulesets and review as every other PR.
