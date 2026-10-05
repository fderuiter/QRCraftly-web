# Git Workflows and Deployment Lifecycle

This document outlines the standard Git branching strategy, contribution workflows, quality gates, and edge deployment lifecycle for QRCraftly.

---

## 1. Branch Hierarchy and Topology

QRCraftly is **trunk-based**. `main` is the only long-lived branch (see [ADR 0020](./adr/0020-trunk-based-releases-on-main.md)):

```
[ feat/*, fix/*, agent/*, release/* ]
             │
             ▼ (Pull Request, squash merge, CI + PR Title required)
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

GitHub Actions triggers the consolidated CI pipeline on the PR:

1. `setup`: Node.js 22.22.2 (from `.nvmrc`; `package.json` `engines` requires `^22.22.2 || >=24.15.0`), pnpm 11.1.3 toolchain verification.
2. `static-validation`: Storage privacy AST audit, UI catalog checks, markdown audit, TypeScript compiler (`tsc --noEmit`), depcruise module boundaries, ESLint, Knip, contrast checks, Prettier, code duplication check, ShellCheck, secret scanner, and Semgrep.
3. `test`: Vitest unit tests with strict coverage thresholds.
4. `build`: Production build verification and bundle size budgets. Uploads `dist` as a short-lived artifact.
5. `lighthouse`: Lighthouse CI audits of every pre-rendered page in that `dist`, three runs per page with the median run asserted (performance at least 0.9).
6. `e2e`: Downloads the `build` job's `dist` and runs Playwright cross-browser tests across Chromium, Firefox, and WebKit against `vite preview` (no second build), then `pnpm run test:e2e:dev` checks that the Vite development server hydrates without runtime errors.
7. `dependency-audit`: `pnpm audit --audit-level=high`, reported as its own check. No other job depends on it, so a newly published upstream advisory never skips the checks above, but it does block the merge through `CI`.
8. `ci`: the aggregate **`CI`** check. It passes only when jobs 1 to 7 all succeed, and it is the check the `main` ruleset requires.

### Step 5: Ephemeral Branch Preview Verification

Cloudflare Workers Builds automatically detects the PR branch and deploys an ephemeral preview to:
$$\text{https://<branch-name>-qrcraftly.fpderuiter.workers.dev/}$$
Reviewers and agents can verify changes live in an edge environment before approval.

### Step 6: Merge into `main`

Once `CI` passes and reviews are complete, merge with **Squash and merge**. Cloudflare deploys the merge to production, and the `Verify Production Deployment` job smoke tests production once it serves the new commit.

---

## 4. Releases, Rollback and Environments

Releases, versioning, tags, environments and rollback are documented in one place: [RELEASING.md](../RELEASING.md). In short:

1. `pnpm run release:prepare` opens a `release/vX.Y.Z` branch with the version bump and changelog. Open it as a PR into `main`.
2. Merging that PR makes the `Release` workflow tag `vX.Y.Z`, publish the GitHub Release, and smoke test production.
3. To roll back, roll back the Cloudflare deployment, then fix forward with a PR.

| Environment    | Branch     | Active Domain                                                          | Access & Indexing                  |
| -------------- | ---------- | ---------------------------------------------------------------------- | ---------------------------------- |
| **Production** | `main`     | `https://qrcraftly.fpderuiter.workers.dev`<br/>`https://qrcraftly.com` | Public, indexed by search engines  |
| **PR Preview** | `<branch>` | `https://<branch>-qrcraftly.fpderuiter.workers.dev`                    | Ephemeral, `X-Robots-Tag: noindex` |
