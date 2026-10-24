# Git Workflows and Deployment Lifecycle

This document outlines the standard Git branching strategy, contribution workflows, quality gates, and edge deployment lifecycle for QRCraftly.

---

## 1. Branch Hierarchy and Topology

QRCraftly is **trunk-based**. `main` is the only long-lived branch (see [ADR 0020](./adr/0020-trunk-based-releases-on-main.md)):

```
[ feat/*, fix/*, agent/*, claude/*, release/* ]
             │
             ▼ (Pull Request, squash merge, CI + PR Title + Workers Builds required)
          [ main ]  (Trunk and Production Branch)
                    └── Deploys to: https://qrcraftly.fpderuiter.workers.dev/
                                    https://qrcraftly.com
```

### `main`

- **Role**: The trunk. Default branch for clones, forks and new PRs.
- **Edge Deployment**: Every push is deployed by Cloudflare Workers Builds to the **Production Environment** at `https://qrcraftly.fpderuiter.workers.dev/` and `https://qrcraftly.com`.
- **Invariants**: Changes land only through squash-merged, up-to-date pull requests that pass the `CI`, `PR Title` and `Workers Builds: qrcraftly` checks. Direct pushes and force pushes are blocked.

---

## 2. Semantic Branch Naming Taxonomy

All working branches created by human developers or autonomous AI agents must adhere to the following naming convention:

| Prefix      | Category      | Purpose                                                  | Example                            |
| ----------- | ------------- | -------------------------------------------------------- | ---------------------------------- |
| `feat/`     | Feature       | New user-facing capability or generator option           | `feat/vcard-notes-field`           |
| `fix/`      | Bugfix        | Defect remediation or error recovery                     | `fix/scannability-contrast-check`  |
| `docs/`     | Documentation | Architecture records (ADRs), guides, or glossary updates | `docs/workflow-standardization`    |
| `refactor/` | Refactoring   | Code restructuring preserving existing behavior          | `refactor/pure-service-signal-bus` |
| `chore/`    | Maintenance   | Tooling, dependency updates, or CI pipeline tweaks       | `chore/update-wrangler-assets`     |
| `agent/`    | Agent Tasks   | Scoped autonomous tasks initiated by AI agents           | `agent/harden-worker-watchdog`     |
| `claude/`   | Agent Tasks   | The branch a Claude session is given; keep its name      | `claude/scanner-retry-a1b2c3`      |

---

## 3. Contributor & Agent Workflow (Step-by-Step)

### Step 1: Create Branch from `main`

```bash
git checkout main
git pull origin main
git checkout -b feat/my-new-feature
```

### Step 2: Implement Changes with Local Quality Gates

Ensure pre-commit hooks and local audits pass before committing:

```bash
# Format and lint
pnpm run format:classes
pnpm run lint

# Run unit tests
pnpm test

# Run e2e tests (if modifying UI or interaction flows)
pnpm run test:e2e
```

### Step 3: Open Pull Request Targeting `main`

Push your branch to GitHub and open a pull request targeting the **`main`** branch. The PR title must be a [Conventional Commit](https://www.conventionalcommits.org/) (for example `fix(scanner): handle empty frames`), because it becomes the squashed commit subject that the changelog and version bump are built from. The `PR Title` check enforces this.

### Step 4: Automated CI Quality Gate Validation

GitHub Actions runs the `CI/CD Pipeline` workflow (`.github/workflows/main.yml`) on the PR. How much it runs depends on the PR ([ADR 0050](adr/0050-ci-tiers-for-a-private-repository.md), `scripts/ci/ci_plan.js`):

| PR state                                    | What runs                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Draft                                       | Static validation, the dependency audit and the builds. No unit tests, E2E or Lighthouse. |
| Only Markdown the build does not read       | Static validation and unit tests.                                                         |
| Ready for review                            | Everything, with Chromium-only E2E and Lighthouse on a sample of pages.                   |
| Labelled `full-e2e`, or a `release/` branch | Everything, with E2E in Chromium, Firefox and WebKit and Lighthouse on every page.        |

`docs/public/` and `docs/SECURITY.md` are compiled into the `/security` page, so a change there counts as code. The same full tier runs nightly on `main` (skipped when `main` has not moved since the last green nightly run), and a red nightly run opens an issue (`scripts/ci/nightly_issue.js`).

The jobs:

1. `plan`: decides the tier above. Every other job sets itself up with the shared `.github/actions/setup` action: Node.js 22.22.2 (from `.nvmrc`; `package.json` `engines` requires `^22.22.2 || >=24.15.0`) and pnpm 11.1.3.
2. `static-validation`: Storage privacy AST audit, UI catalog checks, markdown audit, TypeScript compiler (`tsc --noEmit`), package boundaries (`scripts/check_boundaries.js`), ESLint, Knip, contrast checks, Prettier, code duplication check, ShellCheck, secret scanner, and Semgrep.
3. `test-shard` and `test`: Vitest unit tests split into three shards that run in parallel; `test` merges their reports and checks the coverage thresholds (`scripts/ci/coverage_thresholds.json`: global floors plus one set per layer, for logic, components, hooks and pages) once, on the whole suite. A failing shard names its failing test in its own log and as a PR annotation. `scripts/ci/coverage_summary.js` writes the totals, each layer against its floors, and on pull requests each changed file's uncovered lines, to the run's summary page.
4. `build`: Production build verification, the gzipped bundle size budget (`scripts/check-bundle-size.js`) and the checks on the built site (`pnpm run test:build`, `tests/build-output/`). Uploads `dist` as a short-lived artifact.
5. `wasm-reproducible`: `cargo fmt`, Clippy and the Rust tests, then rebuilds the WebAssembly modules and checks they match the committed `src/wasm/*.wasm` files.
6. `lighthouse`: Lighthouse CI audits of the pre-rendered pages in that `dist`, three runs per page with the median run asserted (performance at least 0.9). A ready PR audits one page of each template (`SAMPLE_ROUTES` in `scripts/ci/lighthouse_sample.js`); the full tier audits every page.
7. `e2e`: Downloads the `build` job's `dist` and runs Playwright against `vite preview` (no second build): the `chromium` and `chromium-csp` projects on a ready PR, plus `firefox` and `webkit` in the full tier. Then `pnpm run test:e2e:dev` checks that the Vite development server hydrates without runtime errors.
8. `dependency-audit`: `pnpm audit --audit-level=high`, reported as its own check. No other job depends on it, so a newly published upstream advisory never skips the checks above, but it does block the merge through `CI`.
9. `ci`: the aggregate **`CI`** check, and the check the `main` ruleset requires. It passes when `plan` succeeded and every other job either succeeded or was skipped by the plan; a failed or cancelled job fails it.

#### Refreshing visual baselines

The screenshots in `e2e/visual-regression.spec.ts-snapshots/` must come from a CI runner, because fonts and rendering differ on every other machine. When a change moves the layout on purpose, add the `update-snapshots` label to the pull request (or run **Update Visual Baselines** by hand on the branch). The `update-snapshots.yml` workflow runs only the visual spec with `--update-snapshots` for Chromium, Firefox and WebKit and commits the changed baselines to the branch. GitHub holds the CI runs for that bot commit until a maintainer approves them on the PR's Checks tab. Add `full-e2e` before the `update-snapshots` label, because CI reads the labels from the push event, so that Firefox and WebKit are checked before the merge.

### Step 5: Ephemeral Branch Preview Verification

Cloudflare Workers Builds automatically detects the PR branch and deploys an ephemeral preview to:
$$\text{https://<branch-name>-qrcraftly.fpderuiter.workers.dev/}$$
Reviewers and agents can verify changes live in an edge environment before approval.

### Step 6: Merge into `main`

Once `CI`, `PR Title` and `Workers Builds: qrcraftly` pass and reviews are complete, merge with **Squash and merge**. Cloudflare deploys the merge to production, and the `Verify Production Deployment` workflow (`.github/workflows/deploy-verify.yml`, which runs on every push to `main`) is the post-merge production check. `CI` does not run again on `main`: the ruleset requires PRs to be up to date, so the squashed commit is the tree the PR's CI already tested. The workflow waits up to 15 minutes for `/version.json` on `https://qrcraftly.fpderuiter.workers.dev/` to report the merged commit (`scripts/ci/wait_for_deploy.sh`). If production does not pick the commit up, the job fails with an error annotation and prints the last response's HTTP status, its caching and routing headers (`cf-cache-status`, `age`, `date`, `server`, `cf-ray`, `content-type`, `cache-control`, `location`) and the start of its body. Once production serves the commit, the job tests it. It runs the E2E tests tagged `@prod` against the deployed site: the page loads, every page sends the security headers, the CSP holds, an SVG downloads under the CSP, and file transfers complete in both outer codes (#1228). Tag a test `@prod` only when it is read-only and needs nothing but the site itself.

---

## 4. Releases, Rollback and Environments

Releases, versioning, tags, environments and rollback are documented in one place: [RELEASING.md](../RELEASING.md). In short:

1. `pnpm run release:prepare` opens a `release/vX.Y.Z` branch with the version bump and changelog. Open it as a PR into `main`.
2. Merging that PR makes the `Release` workflow tag `vX.Y.Z`, publish the GitHub Release, and smoke test production.
3. To roll back, roll back the Cloudflare deployment, then fix forward with a PR.

Every Monday at 08:00 UTC the `Release Preview` workflow (`.github/workflows/release-preview.yml`, also runnable from **Actions → Release Preview → Run workflow**) runs `pnpm run release:dry-run` and writes the next version, whether a release is due and the changelog it would add to the run summary. It only has `contents: read`: it opens no PR and creates no tag.

| Environment    | Branch     | Active Domain                                                          | Access & Indexing                       |
| -------------- | ---------- | ---------------------------------------------------------------------- | --------------------------------------- |
| **Production** | `main`     | `https://qrcraftly.fpderuiter.workers.dev`<br/>`https://qrcraftly.com` | Public; only `qrcraftly.com` is indexed |
| **PR Preview** | `<branch>` | `https://<branch>-qrcraftly.fpderuiter.workers.dev`                    | Ephemeral, `X-Robots-Tag: noindex`      |

---

## 5. Workflow Reference

Every file in `.github/workflows/`, what starts it and what it does. Scheduled times are UTC.

| Workflow (file)                                      | Runs on                                                    | What it does                                                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CI/CD Pipeline` (`main.yml`)                        | PRs into `main`, merge-queue groups, nightly 07:00, manual | The quality gate in [Step 4](#step-4-automated-ci-quality-gate-validation); reports the required `CI` check.                                                  |
| `PR Title` (`pr-title.yml`)                          | PR opened, edited, reopened or pushed; merge-queue groups  | Requires a Conventional Commits title, because the title becomes the squash commit on `main`. Required check.                                                 |
| `Verify Production Deployment` (`deploy-verify.yml`) | Every push to `main`, manual                               | Waits for production to serve the merged commit, then runs the `@prod` E2E tests against it ([Step 6](#step-6-merge-into-main)).                              |
| `Release` (`release.yml`)                            | Push to `main` that changes `package.json`, manual         | Tags and publishes a release when a release PR merges, then smoke tests production ([RELEASING.md](../RELEASING.md)).                                         |
| `Release Preview` (`release-preview.yml`)            | Mondays 08:00, manual                                      | Writes the next version and changelog to the run summary. Read-only.                                                                                          |
| `Update Visual Baselines` (`update-snapshots.yml`)   | `update-snapshots` label on a PR, manual on a branch       | Regenerates the visual-regression screenshots on a CI runner and commits them ([Refreshing visual baselines](#refreshing-visual-baselines)).                  |
| `Scheduled Dependency Audit` (`audit-moderate.yml`)  | Daily 04:00, manual                                        | `pnpm audit --audit-level=moderate`. A failure opens or updates one GitHub issue and a pass closes it (`scripts/ci/audit_issue.js`). PRs gate on `high` only. |
| `Scanner Benchmark` (`scanner-bench.yml`)            | Mondays 05:00, manual (optionally against a second ref)    | Runs `pnpm run bench:scanner` and reports decode rate and time per frame. A report, never a gate ([SCALING.md](public/SCALING.md)).                           |
| `Artifact & Branch Cleanup` (`cleanup.yml`)          | Sundays 02:00, manual                                      | Deletes merged branches and workflow artifacts older than seven days.                                                                                         |
| `Copilot Setup Steps` (`copilot-setup-steps.yml`)    | Manual                                                     | The environment GitHub Copilot's coding agent prepares; run it by hand to check the steps still work.                                                         |

Workflows pin third-party actions to a commit SHA, ask only for the `permissions:` each job needs, and never put `${{ ... }}` expressions inside `run:` blocks; `tests/workflow_hardening.test.ts` enforces the last rule.
