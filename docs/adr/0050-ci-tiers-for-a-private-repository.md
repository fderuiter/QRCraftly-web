---
status: accepted
---

# CI Tiers for a Private Repository

## Context

The repository goes private on 2026-10-14. GitHub Actions minutes are free and unlimited for public repositories, but a private repository on GitHub Pro gets 3,000 Linux minutes a month and pays about $0.006 a minute after that. Hosted Linux runners for private repositories also have 2 vCPUs instead of 4, so the same jobs take longer.

A successful `main.yml` run cost about 77 billed minutes on 2026-10-12: E2E on four Playwright projects took 35, Lighthouse on all 37 pages with three runs each took 26, and unit tests took 9. Every push to a pull request ran it, and every push to `main` ran it again. In the week of 29 September to 5 October that came to about 13,600 minutes.

Other things change with the switch:

- Rulesets and required checks are only enforced on private repositories with GitHub Pro.
- CodeQL code scanning, Code Quality and secret scanning need paid GitHub security products, so the ruleset's `code_scanning` and `code_quality` rules would block every merge.
- OpenSSF Scorecard can only publish results for public repositories.
- Cloudflare Workers Builds is unaffected. It still builds every branch and deploys `main`.

## Decision

`main.yml` runs in tiers. `scripts/ci/ci_plan.js` decides the tier and the `CI` aggregate counts a planned skip as a pass.

| Run                                                            | Static checks, audit, unit tests | Build and wasm | E2E                           | Lighthouse                        |
| -------------------------------------------------------------- | -------------------------------- | -------------- | ----------------------------- | --------------------------------- |
| Draft PR                                                       | No unit tests                    | Yes            | No                            | No                                |
| Ready PR                                                       | Yes                              | Yes            | `chromium` and `chromium-csp` | 8 sample pages, 3 runs each       |
| PR that only changes Markdown the build does not read          | Yes                              | No             | No                            | No                                |
| Release PR (`release/` branch) or a PR labelled `full-e2e`     | Yes                              | Yes            | All four projects             | Every page                        |
| Nightly on `main` (07:00 UTC)                                  | Yes                              | Yes            | All four projects             | Every page                        |
| Nightly when `main` has not moved since the last green nightly | No                               | No             | No                            | No                                |
| Manual run                                                     | Yes                              | Yes            | Chromium, or all with `full`  | Sample, or every page with `full` |

- **No CI on pushes to `main`.** The ruleset requires PRs to be up to date and squash-merges them, so the merged tree is the one the PR's CI tested. `deploy-verify.yml` waits for the deploy and runs the `@prod` smoke tests instead.
- **Lighthouse reports stay in the run's artifacts.** They are no longer uploaded to Google's temporary public storage.
- **Less scheduled work.** Scorecard is removed, the scanner benchmark runs weekly, branch cleanup runs weekly only, and the Copilot setup check runs only by hand.
- **The ruleset keeps `CI`, `PR Title` and `Workers Builds: qrcraftly`** and drops the `code_scanning` and `code_quality` rules. Semgrep, the in-repo secret scanner, `pnpm audit` and Dependabot stay in place of the paid products.

## Consequences

- A ready PR costs about 35 to 45 minutes instead of about 77 (2-vCPU runners are slower than the public 4-vCPU ones), a draft push about 7, and a docs-only PR about 15. A push to `main` costs about 3, and a nightly run that has something to test about 80.
- Drafts skip unit tests because the pre-commit hook runs them before every commit; the ready tier runs them, with the coverage gate, before anything merges.
- A Firefox or WebKit regression can reach `main` and is caught by the next nightly run, at most a day later. Changes that are likely to differ by browser (layout, media, camera, file APIs, workers) should carry the `full-e2e` label.
- Contributors and Claude threads run `pnpm run lint` and `pnpm test` before pushing (the pre-commit hook already does), and `pnpm test:e2e` locally for navigation, rendering or input changes, so CI is a confirmation rather than the first test.
- Drafts are cheap, so work stays in draft until it is ready, and many small pushes to a ready PR are expensive.
- Every merge makes the other open PRs out of date, and updating them reruns CI. Merging one PR at a time and updating only the next one keeps that cost down.
- If GitHub Pro is dropped, the ruleset stops being enforced and auto-merge stops waiting for checks. Revisit this ADR before downgrading.
