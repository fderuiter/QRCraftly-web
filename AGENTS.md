# AGENTS.md

Operating instructions and core invariants for AI agents working in this repository.

## Non-Negotiable Invariants

- **Package Manager**: Use `pnpm` exclusively. Never run `npm` or `yarn`. Node.js `^22.22.2 || >=24.15.0` required (`engines` in `package.json`; `.nvmrc` pins the CI version).
- **Privacy & Storage Allowlist**: All QR code generation is strictly client-side. Never send user payloads across the network or encode user input into URL query parameters. The pre-build storage AST auditor (`scripts/storage_privacy_ast_auditor.js`) blocks any unapproved persistent browser storage. Only approved keys (`qrcraftly:theme`, `qrcraftly:brand-templates`, `__test__`) are allowed. `qrcraftly:theme` holds only the colour-theme preference (`light`, `dark` or `system`), owned by the global `ThemeProvider` (`src/context/ThemeContext.tsx`); never store QR content with it. `qrcraftly:brand-templates` holds saved style templates only; `src/utils/brandTemplateManager.ts` strips content fields and uploaded images (`CONTENT_FIELDS`) before saving.
- **UI Component Reuse**: Consult `docs/public/UI_CATALOG.md` before creating any visual element.
  - Range sliders: Always use `RangeInput` from `src/components/ui/RangeInput.tsx`.
  - Buttons: Always use `Button` from `src/components/ui/Button.tsx`.
  - Color pickers: Always use `ColorInput` from `src/components/ui/ColorInput.tsx`.
  - Color & contrast math: Never write custom luminance, hex normalization, or contrast formulas. Always import from `src/utils/colorUtils.ts` or the scannability package (`auditModuleContrast` from `src/packages/scannability`).
- **Tailwind CSS v4 (CSS-First)**: Theme variables, tokens, and dark mode variants live exclusively in `src/layouts/index.css` via `@theme` and `@variant`. There is no `tailwind.config.js`. Use the semantic tokens (`bg-surface`, `text-fg-muted`, `border-line`, `bg-action`, `text-danger`, `ring-focus` ...) documented in `docs/public/STYLE_GUIDE.md` instead of raw palette classes; `scripts/design_token_audit.js` rejects raw palette colours and arbitrary colour or size values anywhere in `src/` (a short legacy list of files, `LEGACY_PALETTE_FILES`, may only shrink).
- **Platform Invariance & Path Canonicalization**: All repository tooling, AST auditors, scripts, tests, and build steps must be completely environment-agnostic (Windows, macOS, Linux). Never hardcode OS drive paths, platform-specific binaries (`npx.cmd`), or raw `split('\n')`. Always canonicalize relative paths using POSIX forward slashes (`/`), standardize line endings to `LF` with defensive regex splitting (`/\r?\n/`), and use `scripts/utils/execHelper.js` or `tests/utils/execHelper.ts` for process execution. Verified by `scripts/path_invariance_auditor.js`.
- **Deployment Integrity & Edge Hosting**: Cloudflare Workers with Static Assets provides the edge runtime. Cloudflare Workers Builds deploys every push to `main` to production (`https://qrcraftly.fpderuiter.workers.dev/` and `https://qrcraftly.com`) and every other branch to a preview URL (`https://<branch>-qrcraftly.fpderuiter.workers.dev/`). GitHub Actions functions as the Authoritative Quality Gatekeeper. Never introduce local server mock fallbacks (`localhost:3000`) or monkey-patch the Wrangler CLI in CI scripts.
- **GitHub Actions Workflow Hardening**: Never use inline `${{ ... }}` template expressions inside `run:` or `script:` execution blocks in `.github/workflows/*.yml`. All step outputs, inputs, secrets, and dynamic expressions MUST be passed through step-scoped `env:` blocks and accessed as environment variables (e.g. `$MY_VAR`) to prevent script injection attacks. Verified by `tests/workflow_hardening.test.ts`.
- **Branching & Contribution Hierarchy**: The repository is trunk-based: `main` is the only long-lived branch and every merge to it deploys to production. All feature work, fixes, refactors, and agent tasks MUST branch off `main` and return via pull requests using standardized prefixes (`feat/`, `fix/`, `docs/`, `refactor/`, `chore/`, `agent/`). PRs are squash-merged, must be up to date with `main`, and need the `CI`, `PR Title` and `Workers Builds: qrcraftly` checks green (no bypass); prefer fewer, larger, fully tested PRs. Enable auto-merge (squash) on a PR once it is complete so it merges when those checks pass; never on a `chore(release)` PR, which a maintainer merges by hand. PR titles must be Conventional Commits. Direct pushes and force pushes to `main` are prohibited (see `RELEASING.md` and ADR 0020).
- **Release Lifecycle & SemVer**: All releases must use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `BREAKING CHANGE:`, etc.) and SemVer 2.0.0 (`MAJOR.MINOR.PATCH`). Use `pnpm run release:dry-run` to preview the next version, and `pnpm run release:prepare` to open the `release/vX.Y.Z` branch (version bump + `CHANGELOG.md`) for a release PR into `main`; merging it makes the Release workflow create the annotated tag and GitHub Release. Deploys are done by Cloudflare Workers Builds, never by GitHub Actions. Never manually edit `package.json` version or create Git tags by hand.
- **Deep Module Architecture & Duplication Limit**: Core domain features and background workers belong inside deep modules (`src/packages/<module>/`). App code imports packages directly through their root entry points; do not add re-export shims under `src/utils/` (they hide dead code from Knip). Keep the repository duplicate code threshold below `3.0` (`.jscpd.json`).
- **In-House First**: Our own code comes first ([ADR 0040](./docs/adr/0040-in-house-first.md)). A new runtime dependency needs its own ADR (why our code cannot do it, size, licence, maintainers, network behaviour, patents, exit plan) before it joins `ALLOWED_DEPENDENCIES` in `scripts/dependency_compliance.js`. A new dev dependency or third-party GitHub Action needs a one-line reason in the PR and a row in the `docs/FOUNDRY.md` scorecard. Packages used only as test oracles are frozen into fixtures by a script in `scripts/fixtures/`, then removed.

## Agent skills

### Issue tracker

GitHub Issues using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` and `docs/adr/` at repo root). Always consult `CONTEXT.md` for canonical domain terminology (avoiding listed `_Avoid_` synonyms) and `docs/adr/` for established architectural decisions. See `docs/agents/domain.md`.

Packages are deep modules: see [src/packages/README.md](./src/packages/README.md) before adding or importing one.

### Documentation checks

- Run `pnpm run docs:sync` after changing a UI component in `src/components/ui/`, `src/components/inputs/` or `src/components/style-controls/`. It regenerates `docs/public/UI_CATALOG.md` entries. Commit what it changes. The `/security` page's docs are compiled from `docs/public/` and `docs/SECURITY.md` at build time (`virtual:docs-manifest`), so nothing is committed for them.
- Run `pnpm run docs:lint` after editing any Markdown. It checks links, anchors, unfinished-work placeholder markers and TS snippets in `docs/`, `docs/public/`, `docs/adr/`, `docs/agents/`, `docs/optical-transfer/`, `README.md`, `CONTEXT.md` and `AGENTS.md`; ADR file names and gap-free numbering; and the UI catalog. Every error prints a `Fix:` hint. `pnpm run lint`, CI and the pre-commit hook (for staged `*.md` files) run the same checks.

See `docs/agents/docs-maintenance.md`.

## Architecture & Deep Topic Pointers

- **No Dynamic QR Codes**: QRCraftly makes static codes only and has no server code, API, database or bot check. Never add server-side redirects, D1, Turnstile or `/api/` calls. Read `docs/adr/0022-no-dynamic-qr-codes-client-side-only.md`.
- **Worker Concurrency & Scannability**: Off-thread Web Workers (`src/packages/scannability/worker.ts`, `src/packages/optical-scanner/worker.ts`), zero-copy `ArrayBuffer` double-buffering, degradation state caching, immediate 1500ms watchdog fault-tolerance, non-blocking superseded dropped ACK backpressure handling, and client-side SVG generation via `SvgContext`. Read `docs/public/SCALING.md`.
- **Security & Sanitization**: SVG element allowlists (`sanitizeSvg`), phone/SMS sanitization, the link scheme check (`isDangerousUrl`), and inline-script CSP hashing. Read `docs/SECURITY.md`.
- **HIPAA Compliance Guidelines**: Client-side volatile memory guarantees and what the host can see. Read `docs/public/COMPLIANCE.md`.
- **No-Ads Pledge**: QRCraftly is never ad supported and has no analytics, telemetry or third-party requests. Never add ads, analytics, diagnostics reporting or third-party scripts. Read `docs/PLEDGE.md`; the site copy lives in `src/data/pledge.ts`.

## Quality & Development Standards

- **TypeScript**: Strict typing across all files. Proactively avoid `any` or loose type assertions (`as`).
- **Accessibility (a11y)**: Validate WCAG 2.1 SC 1.4.11 contrast compliance for UI states and generated QR codes. Test components with the axe helper in `tests/utils/axe.ts` (`expect(await axe(container)).toHaveNoViolations()`) and screen-reader accessible labels.
- **Tailwind Formatting**: Run `pnpm run format:classes` to enforce standardized utility class ordering.
- **Git Guardrails**: Our own `.githooks/pre-commit` (installed by `pnpm install` through `scripts/hooks/install.js`) runs the staged-file checks in `scripts/hooks/staged.config.js`, then the duplication audit, typechecking and tests, before every commit. Read `docs/adr/0044-own-git-hooks-and-staged-file-runner.md`.
- **Test Concurrency & File Isolation**: Tests interacting with build artifacts or script outputs (e.g. sitemaps) must isolate output paths via environment variables (such as `SITEMAP_OUTPUT_PATH` and `SITEMAP_DIST_DIR`) to avoid race conditions and file collisions during parallel Vitest executions; they never write into or delete the real `dist/`. Tests that run git in a temp repository first remove inherited `GIT_*` variables, which a git hook would otherwise point at the real repository.

## Verification & Definition of Done

Before declaring any implementation task complete, verify your changes:

1. **Standard Code Changes**: Run and ensure passing:
   - `pnpm run lint` (runs dependency license compliance, the Rust no-dependency check, the git lineage (code-to-doc pairing) audit, AST storage checks, the path invariance audit, UI catalog validation, markdown audits, static SVG path tracking, TypeScript type-checking, dependency-cruiser package boundaries, ESLint, Knip, contrast checks, the design token audit, Prettier, and duplication checks)
   - `pnpm test` (Vitest test suite)
2. **Build, Routing, or Core Generator Changes**: In addition to standard checks, run:
   - `pnpm build` (verifies SSG pre-rendering, the bundle AST audit, and postbuild security scripts; the gzipped bundle size budget is a separate CI step, `pnpm run check-bundle-size`)
   - `pnpm test:e2e` (Playwright end-to-end verification, when modifying navigation, rendering, or input flows)
