---
status: accepted
superseded_in_part_by: 0018, 0020
---

# Authoritative Quality Gatekeeping and Edge Branch Deployment

> The branch model and release mechanics described here were replaced by [ADR 0020](./0020-trunk-based-releases-on-main.md): `main` is the only branch. See [RELEASING.md](../../RELEASING.md) for the current process.

## Context

Previously, deployment to Cloudflare was caught between two conflicting mechanisms:

1. Cloudflare's native GitHub App (Workers Builds) which automatically builds connected branches on push.
2. Legacy GitHub Actions workflows (`deploy.yml`, `preview.yml`, `main.yml`) attempting to run `wrangler pages deploy` via shell scripts.

This duality caused broken CI pipeline runs because the project was configured as a Cloudflare Worker (`qrcraftly.fpderuiter.workers.dev`), not a Cloudflare Pages project. Furthermore, running naive CLI deployment commands from GitHub Actions on the `dev` branch risked deploying to the root worker name, potentially overwriting production (`qrcraftly.fpderuiter.workers.dev`).

In Cloudflare Workers Builds, Cloudflare provides native wildcard domain routing:

- **Production**: `qrcraftly.fpderuiter.workers.dev` (bound strictly to the production branch, `main`)
- **Preview Staging**: `dev-qrcraftly.fpderuiter.workers.dev` (bound to `dev` with `X-Robots-Tag: noindex`)
- **Ephemeral Previews**: `*-qrcraftly.fpderuiter.workers.dev` (dynamically provisioned per pull request)

## Decision

We establish a clear division of responsibility between **GitHub Actions** and **Cloudflare Workers Builds**:

1. **GitHub Actions as the Authoritative Quality Gatekeeper**:
   - GitHub Actions is the mandatory, unyielding gatekeeper for code quality and security.
   - All pull requests targeting `dev` or `main` must pass the full verification matrix before merge permissions are granted:
     - Static validation (`pnpm run lint`): AST storage privacy auditor, UI catalog auditor, markdown compliance, TypeScript typecheck, package boundary validation, ESLint, Knip, and code duplication checks.
     - ShellCheck static analysis and secret scanning.
     - Vitest unit tests with strict coverage thresholds (`pnpm test`).
     - Playwright cross-browser end-to-end tests (`pnpm run test:e2e`).
     - Production application compilation (`pnpm run build`) including postbuild CSP hash injection and service worker generation, followed by the gzipped bundle size budget (`scripts/check-bundle-size.js`: 260 KB first load per page, 650 KB ceiling on shipped JavaScript and CSS) as a separate CI step.
   - Broken CLI deployment commands (`wrangler pages deploy`) inside GitHub Actions are decommissioned.

2. **Cloudflare Workers Builds for Edge Branch Routing**:
   - Cloudflare's native Git integration handles artifact deployment and edge DNS routing.
   - Pushes to `main` deploy exclusively to production (`qrcraftly.fpderuiter.workers.dev` and `qrcraftly.com`).
   - Pushes to `dev` deploy exclusively to the preview staging environment (`dev-qrcraftly.fpderuiter.workers.dev`).
   - Pull requests trigger ephemeral preview builds at `https://<branch>-qrcraftly.fpderuiter.workers.dev/`.
   - Because domain routing is strictly bound to Git branch names by Cloudflare's edge router, it is impossible for `dev` to overwrite `main`.

## Rationale

This decoupled architecture provides the best of both worlds:

- Zero credential overhead and zero CLI deployment failure modes in GitHub Actions.
- Complete domain isolation between preview and production, eliminating any possibility of accidental production overwrites.
- Uncompromising quality gates: no code reaches either `dev` or `main` without passing all automated tests and privacy/security audits.

## Consequences

- GitHub repository settings enforce Required Status Checks from GitHub Actions on both `dev` and `main`.
- In `main.yml`, redundant deployment jobs calling failing shell scripts are replaced with build validation and gatekeeping.
- Developers and autonomous agents verify features on `https://dev-qrcraftly.fpderuiter.workers.dev/` before cutting promotion PRs to `main`.
