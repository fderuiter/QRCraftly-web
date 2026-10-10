# QRCraftly

[![CI/CD Pipeline](https://github.com/fderuiter/QRCraftly-web/actions/workflows/main.yml/badge.svg)](https://github.com/fderuiter/QRCraftly-web/actions/workflows/main.yml)
[![Latest release](https://img.shields.io/github/v/release/fderuiter/QRCraftly-web)](https://github.com/fderuiter/QRCraftly-web/releases)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE.md)

**[qrcraftly.com](https://qrcraftly.com)** is a free QR code studio that runs entirely in your browser. It makes styled, scannable QR codes for links, Wi-Fi, contacts, payments and more; scans and checks existing codes; and sends files between devices as an animated stream of QR codes, with no network. Nothing you type or upload leaves your device.

## Contents

- [The QRCraftly Pledge](#the-qrcraftly-pledge)
- [Features](#features)
- [Privacy and security model](#privacy-and-security-model)
- [Quick start](#quick-start)
- [Everyday commands](#everyday-commands)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Quality gates](#quality-gates)
- [Contributing](#contributing)
- [Releases and deployment](#releases-and-deployment)
- [Documentation map](#documentation-map)
- [Security](#security)
- [License](#license)

## The QRCraftly Pledge

**QRCraftly is not ad supported, and it never will be.** No ads, no tracking, no sign-up, and everything runs in your browser. If it ever comes down to ads or nothing, the project will be shut down before a single ad goes on it; the only way it would change hands is an outright purchase of the whole project.

Read the full pledge, and exactly what is and isn't collected, in [docs/PLEDGE.md](docs/PLEDGE.md) or at [qrcraftly.com/free-forever](https://qrcraftly.com/free-forever).

## Features

### Generator

- **Content types:** URLs, plain text, Wi-Fi networks (WPA, WEP, EAP or open), email, vCard contacts, phone numbers, SMS, cryptocurrency payments, calendar events, GPS locations, video meetings (Zoom, Microsoft Teams, Google Meet) and social profiles (Instagram, X, TikTok). Each type has its own page, such as `/wifi-qr-code`.
- **Bulk CSV:** turn a spreadsheet of up to 500 rows into a ZIP of codes (`/bulk-csv-qr-code`). Every row goes through the same payload checks as a single code.
- **Patterns:** Standard Industrial, Modern Soft, Swiss Dot, Fluid Ink, Cyber Circuit, The Hive, Grunge and Starburst.
- **Colours:** foreground, background and finder-pattern colours, with contrast-checked presets and a "Low Contrast" warning.
- **Logos:** embed a logo with padding and a square, circle or no border. Supported custom logo formats are image/jpeg, image/png, image/webp, image/svg+xml. Maximum file size is 2MB. Maximum logo size is 30% of the code, so it still scans.
- **Mosaic QR:** tile a picture across the whole code. Each module takes the image's colour while keeping its dark or light value, so the code still scans (Halftone or Tiles, with adjustable Scan Contrast; [ADR 0019](docs/adr/0019-mosaic-qr-module-level-image-tiling.md)).
- **Live scannability:** a worker re-checks contrast and decodes the code as you edit, and warns before you export a code that may not scan.
- **In the wild:** preview the code on a poster, business card, table tent, phone screen or sticker, all drawn in code. Set a printed width to see module size and estimated scan distance, and run a viewing test (distance, glare, dim light, tilt).
- **Style tools:** a gallery of every pattern and preset drawn on your own code, "Surprise me", up to 50 steps of undo and redo in memory, and a command palette (`Ctrl/Cmd+K`) with keyboard shortcuts (`?` lists them).
- **Style files and templates:** save a look as a `.qrcraftly.json` file, or as a brand template in the browser. Both hold colours and layout only, never your content or images.
- **Export:** PNG, JPEG, WebP or vector SVG, with native "Save As" where the browser supports it and the Web Share API on mobile.
- **Use-case pages:** presets for jobs such as a menu, a Google review link, WhatsApp, Instagram, a PDF link or a code with a logo, plus printing and safety guides under `/guides`.

### Scanner and checker

- **Scan to fill:** scan a code with the camera or from an image file and load it into the matching form.
- **Scanner** (`/qr-code-scanner`) and **checker** (`/qr-code-checker`): decode a code on your device and explain what it does before you act on it. Links show their real host and are checked offline for disguises such as look-alike domains; dialer codes, texts to short numbers, Wi-Fi without a password and wallet checksums are called out. Only `http` and `https` links can be opened from the result. See [ABUSE_PROTECTIONS.md](docs/ABUSE_PROTECTIONS.md).
- The decoder is our own Rust module, `crates/qr-decode`, compiled to WebAssembly and run in a worker ([ADR 0036](docs/adr/0036-in-house-qr-decoder-replaces-zxing-wasm.md)).

### Air-Gapped File Transfer (beta)

- Send a file or folder from one device's screen (`/file-transfer`) to another device's camera (`/file-transfer/receive`) as an animated stream of QR codes. No network, Bluetooth or USB is involved.
- The sender picks Steady, Balanced or Fast and sees the time for the file before it starts. The receiver can join at any point, watches the file assemble, and finishes with a verified summary and Open, Save and Receive-another actions.
- Private transfers encrypt the file with AES-256-GCM. The key never appears in the stream: it is shown as eight words or a separate key QR ([ADR 0025](docs/adr/0025-private-transfers-and-bundles.md)). Received file names are sanitised, risky types need confirmation, and receives are capped at 100 MiB.
- Several faster modes are previews behind switches under Advanced: a new outer code, several codes per frame, and a webcam back channel that lets the receiver steer the speed. A wallet-compatible BC-UR mode is also available. Speeds come from simulation only until the [device checklist](docs/TRANSFER_DEVICE_CHECKLIST.md) has real results.
- The design, its status and its evidence rules are in [docs/optical-transfer](docs/optical-transfer/README.md).

### QR Arcade

Damage a QR design and watch whether a real decoder still reads it (`/arcade`). It shows how error correction works.

### Everywhere

- **Works offline after one visit:** a service worker caches the homepage generator, with its encoder and workers, on the first visit, and other pages as you open them.
- **Accessible:** keyboard navigation, screen-reader labels, visible focus and WCAG contrast checks, tested with axe in unit and end-to-end tests.
- **Light and dark themes**, a layout that works from phones to desktops, and reduced-motion support.

## Privacy and security model

| Promise                       | How it is kept                                                                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your content stays on device  | Generation, scanning, export and file transfer run in the browser. Content is never sent over the network or put in a URL query string. There is no server code, API or database ([ADR 0022](docs/adr/0022-no-dynamic-qr-codes-client-side-only.md)). |
| Static codes only             | Every code holds its content directly, so it keeps working without QRCraftly and nobody can track or switch it off. There are no redirect ("dynamic") codes.                                                                                          |
| Nothing is stored by surprise | Persistent browser storage is limited to an allowlist (theme preference and saved style templates), enforced by an AST audit before every build ([ADR 0001](docs/adr/0001-client-side-storage-allowlist.md)).                                         |
| No tracking                   | No ads, analytics, telemetry or third-party scripts ([PLEDGE.md](docs/PLEDGE.md)). The host still sees ordinary request logs; the [privacy page](https://qrcraftly.com/privacy) says exactly what.                                                    |
| Hardened pages                | A strict Content Security Policy with hashed inline scripts, a Permissions Policy, SVG and link sanitisation ([SECURITY.md](docs/SECURITY.md)).                                                                                                       |

For regulated settings, [COMPLIANCE.md](docs/public/COMPLIANCE.md) describes the volatile-memory guarantees and what the host can see.

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) `^22.22.2` or `>=24.15.0`. `.nvmrc` pins the version CI uses.
- [pnpm](https://pnpm.io/), at the version pinned in `package.json` (`packageManager`). Run `corepack enable` once to get it. Never use `npm` or `yarn`.
- Rust only if you change something in `crates/`. The built WebAssembly modules are committed in `src/wasm/`, so building and testing need no Rust ([docs/RUST.md](docs/RUST.md)).

### Install and run

```bash
git clone https://github.com/fderuiter/QRCraftly-web.git
cd QRCraftly-web
pnpm install
pnpm dev
```

The dev server runs at `http://localhost:3000`. `pnpm install` also installs the Git hooks (`scripts/hooks/install.js` points `core.hooksPath` at `.githooks/`). `pnpm run wizard:dev` walks through the local setup interactively.

### Build and preview

```bash
pnpm build     # pre-renders every page to static HTML in dist/, then runs the post-build security scripts
pnpm preview   # serves dist/ at http://localhost:3000
```

## Everyday commands

| Command                      | What it does                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                   | Starts the Vite dev server. It reloads the page on save (no Fast Refresh).                                      |
| `pnpm exec vitest run`       | Runs the unit tests once (`pnpm test` watches). Add `--coverage` for a coverage report.                         |
| `pnpm test:e2e`              | Runs the Playwright end-to-end tests. Run `pnpm exec playwright install` once on a fresh machine.               |
| `pnpm run lint`              | Runs every static check that CI runs (see [Quality gates](#quality-gates)).                                     |
| `pnpm run format`            | Formats the repository with Prettier. `pnpm run format:classes` sorts Tailwind classes.                         |
| `pnpm build`                 | Builds the site, including the sitemap, social images, service worker and CSP hashes.                           |
| `pnpm run check-bundle-size` | Checks the built site against the size budgets. Run it after `pnpm build`.                                      |
| `pnpm run docs:sync`         | Regenerates the UI catalog entries after UI component changes.                                                  |
| `pnpm run docs:lint`         | Checks Markdown links, anchors, ADR numbering and the UI catalog.                                               |
| `pnpm run wasm:build`        | Rebuilds the Rust modules into `src/wasm/` (needs Rust). `wasm:check` verifies the committed builds.            |
| `pnpm run licenses:sync`     | Updates the list of packages shipped to the browser, shown on `/acknowledgements`.                              |
| `pnpm run bench:*`           | Benchmarks: `scanner`, `wasm`, `qr-encode`, `transfer`, `outer-code`, `colour`, `optical`, `feedback` and more. |
| `pnpm run release:dry-run`   | Previews the next version and changelog from the Conventional Commits on `main`.                                |

## Architecture

### Stack

| Layer       | Choice                                                                                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI          | React 19 and TypeScript (strict)                                                                                                                                                                                                  |
| Routing     | Vike, with every page pre-rendered to static HTML at build time; page scripts start after first paint ([ADR 0034](docs/adr/0034-page-content-at-prerender.md), [ADR 0035](docs/adr/0035-page-scripts-start-after-first-paint.md)) |
| Build       | Vite 6                                                                                                                                                                                                                            |
| Styling     | Tailwind CSS v4, CSS-first: tokens and the dark variant live in `src/layouts/index.css` (`@theme`, `@variant`); there is no `tailwind.config.js` ([STYLE_GUIDE.md](docs/public/STYLE_GUIDE.md))                                   |
| Compute     | Our own Rust compiled to WebAssembly, with no third-party crates ([ADR 0033](docs/adr/0033-rust-webassembly-modules.md), [RUST.md](docs/RUST.md))                                                                                 |
| Concurrency | Web Workers for scannability, matrix and maze building, scanning and decoding, passing pixels as transferable `ArrayBuffer`s ([SCALING.md](docs/public/SCALING.md))                                                               |
| Hosting     | Cloudflare Workers with Static Assets only, no server code ([ADR 0012](docs/adr/0012-cloudflare-workers-static-assets-and-multi-environment.md))                                                                                  |
| Tests       | Vitest with jsdom and axe-core (`tests/utils/axe.ts`); Playwright with axe for end-to-end tests                                                                                                                                   |

Runtime dependencies are only React, React DOM, Vike, vike-react and lucide-react. Our own code comes first: a new runtime dependency needs its own ADR ([ADR 0040](docs/adr/0040-in-house-first.md)).

### Deep modules

Core features live in deep modules under `src/packages/`. App code imports a package only through its root entry points, and dependency-cruiser enforces the boundaries ([ADR 0007](docs/adr/0007-deep-modules-dependency-cruiser.md), [src/packages/README.md](src/packages/README.md)).

| Package            | Responsibility                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `qr-matrix`        | Turns a configuration into a module matrix and draws it: patterns, eyes, logos, mosaic and mazes            |
| `qr-payload`       | Builds, parses and validates the payload for every content type                                             |
| `qr-export`        | Templates and self-contained, sanitised SVG export                                                          |
| `qr-decode`        | Our QR decoder (`crates/qr-decode`)                                                                         |
| `scannability`     | Off-thread contrast audits, decoding checks and the scannability verdict                                    |
| `optical-scanner`  | The Camera Session and off-thread decoding for live cameras and image files                                 |
| `optical-transfer` | Air-Gapped Optical Transfer: Prism frames, fountain and outer codes, sender, receiver, multi-code, feedback |
| `optical-modem`    | Experimental colour modem, off unless the build sets `VITE_OPTICAL_MODEM=true`                              |
| `link-safety`      | Offline checks for disguised links                                                                          |
| `bulk-csv`         | The Bulk CSV generator's parsing and batching                                                               |
| `arcade`           | Game logic and damage analytics for the QR Arcade                                                           |
| `wasm-runtime`     | Loads and instantiates our WebAssembly modules                                                              |

### Rust crates

| Crate       | Module in `src/wasm/` | What it does                                                      |
| ----------- | --------------------- | ----------------------------------------------------------------- |
| `qr-encode` | `qr-encode.wasm`      | QR encoder                                                        |
| `qr-decode` | `qr-decode.wasm`      | QR decoder, including the tracked fast path for file transfer     |
| `prism-fec` | `prism-fec.wasm`      | The file-transfer outer code (LT over an LDPC precode)            |
| `modem`     | `modem.wasm`          | Experimental optical modem kernels                                |
| `core`      | (shared)              | GF(256), Reed-Solomon, CRC-32, QR tables and the module allocator |
| `selftest`  | `selftest.wasm`       | A tiny module that proves the toolchain, build and loader work    |

## Project structure

```text
.
├── AGENTS.md            Invariants for contributors and AI agents
├── CONTEXT.md           Domain glossary (use these terms)
├── RELEASING.md         Release, deployment and rollback runbook
├── crates/              Rust sources for the WebAssembly modules
├── docs/                Design docs, ADRs, benchmarks and public guides (see the map below)
├── e2e/                 Playwright end-to-end tests
├── public/              Static assets, _headers, _redirects and the web app manifest
├── scripts/             Build, audit, benchmark and release scripts
├── src/
│   ├── components/      React components; ui/ holds the shared primitives (see UI_CATALOG.md)
│   ├── data/            Page copy, navigation and landing pages
│   ├── hooks/           React hooks (download, upload, scannability, focus)
│   ├── layouts/         Layout, document head and index.css (theme tokens)
│   ├── packages/        Deep modules (see above)
│   ├── pages/           Vike routes: one folder per page
│   ├── utils/           App utilities (colour math, file names, storage of templates)
│   └── wasm/            Committed, reproducible WebAssembly builds
└── tests/               Vitest tests for scripts, tooling and cross-cutting behaviour
```

## Quality gates

`pnpm run lint` runs the same static checks as CI:

- **Policy audits:** dependency licences and the allowlist, no third-party Rust crates, code-to-doc pairing, the storage allowlist, platform-independent paths and static SVG paths.
- **Docs:** links, anchors, ADR numbering and the UI catalog.
- **Code:** TypeScript, dependency-cruiser boundaries, ESLint (including jsx-a11y and security rules), Knip for dead code, Prettier and a duplication limit.
- **Design:** WCAG contrast of UI colours, and a design-token audit that rejects raw palette colours and arbitrary colour or size values anywhere in `src/`.

CI also runs the unit tests with coverage, the end-to-end tests, the build with its post-build security scripts (bundle AST audit, CSP hashing), a reproducibility check of the committed WebAssembly, a dependency audit and Lighthouse. Size budgets, checked by `pnpm run check-bundle-size`:

- The check fails if any page's first load (HTML, CSS and startup scripts, gzipped) exceeds 260 KB.
- It fails if all shipped JavaScript and CSS together exceed 650 KB gzipped.
- Each Rust module has its own gzipped budget, for example 32 KB for `qr-decode` and 10 KB for `prism-fec`.

Before every commit, our own pre-commit hook (`.githooks/pre-commit`) formats and lints the staged files and runs the secret, storage and docs audits, then the duplication audit, the type check and the unit tests ([ADR 0044](docs/adr/0044-own-git-hooks-and-staged-file-runner.md)). The staged-file rules are in `scripts/hooks/staged.config.js`.

## Contributing

1. **Read the guardrails.** [AGENTS.md](AGENTS.md) holds the invariants: client-side only, the storage allowlist, reuse of shared UI components, semantic design tokens, hardened workflows and in-house first. Use the vocabulary in [CONTEXT.md](CONTEXT.md), and check [docs/adr](docs/adr/) before changing a settled decision.
2. **Branch from `main`** with a prefix: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/` or `agent/`. `main` is the only long-lived branch ([ADR 0020](docs/adr/0020-trunk-based-releases-on-main.md)).
3. **Reuse before you build.** Check [UI_CATALOG.md](docs/public/UI_CATALOG.md) before adding a visual element; sliders, buttons and colour pickers have shared components, and colour maths lives in `src/utils/colorUtils.ts`.
4. **Keep docs in step.** Run `pnpm run docs:sync` after changing shared UI or a public doc, and record a new architectural decision as an ADR ([docs-maintenance.md](docs/agents/docs-maintenance.md)).
5. **Check locally:** `pnpm run lint` and `pnpm exec vitest run`; add `pnpm build` and `pnpm test:e2e` when you touch the build, routing, rendering or input flows.
6. **Open a pull request against `main`** with a [Conventional Commits](https://www.conventionalcommits.org/) title (`feat(scanner): …`, `fix: …`, `docs: …`). The title becomes the squash commit and drives the next version. Fill in the PR template.
7. **Merge on green.** The required checks are `CI`, `PR Title` and `Workers Builds: qrcraftly`, on a branch that is up to date with `main`. Enable auto-merge (squash) once the PR is complete. Prefer fewer, larger, fully tested PRs, because every merge deploys.

**Dependencies:** Dependabot proposes npm updates daily and GitHub Actions updates weekly, grouped to keep the noise down; security fixes come on their own. A new dev dependency or third-party Action needs a one-line reason in the PR and a row in the [FOUNDRY.md](docs/FOUNDRY.md) scorecard. When a package that ships to the browser is added or removed, the build fails until you run `pnpm run licenses:sync` and check its licence.

**Issues:** use the GitHub issue forms for bugs and ideas. Labels follow [triage-labels.md](docs/agents/triage-labels.md).

## Releases and deployment

- Cloudflare Workers Builds deploys every push to `main` to production (`https://qrcraftly.com`) and every other branch to a preview URL, `https://<branch>-qrcraftly.fpderuiter.workers.dev`. GitHub Actions never deploys; it is the quality gate, and after each merge it smoke tests production.
- Versions follow SemVer and come from the Conventional Commits on `main`. `pnpm run release:prepare` opens a `release/vX.Y.Z` pull request with the version bump and `CHANGELOG.md`; merging it tags the release and publishes it on GitHub. A maintainer merges release pull requests by hand. Never edit the version in `package.json` or create tags manually.
- To roll back, restore the previous version in Cloudflare, then fix forward with a pull request.

Details are in [RELEASING.md](RELEASING.md) and [WORKFLOWS.md](docs/WORKFLOWS.md).

## Documentation map

| Topic                     | Where                                                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invariants and vocabulary | [AGENTS.md](AGENTS.md), [CONTEXT.md](CONTEXT.md)                                                                                                                                                                                    |
| Decisions                 | [docs/adr](docs/adr/)                                                                                                                                                                                                               |
| Product                   | [product.md](product.md), [PLEDGE.md](docs/PLEDGE.md)                                                                                                                                                                               |
| Security and abuse        | [SECURITY.md](docs/SECURITY.md), [ABUSE_PROTECTIONS.md](docs/ABUSE_PROTECTIONS.md), [COMPLIANCE.md](docs/public/COMPLIANCE.md)                                                                                                      |
| UI and styling            | [UI_CATALOG.md](docs/public/UI_CATALOG.md), [STYLE_GUIDE.md](docs/public/STYLE_GUIDE.md)                                                                                                                                            |
| Performance and workers   | [SCALING.md](docs/public/SCALING.md), [RUST.md](docs/RUST.md)                                                                                                                                                                       |
| File transfer             | [Optical Transfer design](docs/optical-transfer/README.md), [TRANSFER_BENCHMARK.md](docs/TRANSFER_BENCHMARK.md), [TRANSFER_DEVICE_CHECKLIST.md](docs/TRANSFER_DEVICE_CHECKLIST.md), [OPTICAL_RESEARCH.md](docs/OPTICAL_RESEARCH.md) |
| Workflow and releases     | [WORKFLOWS.md](docs/WORKFLOWS.md), [RELEASING.md](RELEASING.md), [CHANGELOG.md](CHANGELOG.md), [FOUNDRY.md](docs/FOUNDRY.md)                                                                                                        |
| SEO                       | [SEO_MEASUREMENT.md](docs/SEO_MEASUREMENT.md)                                                                                                                                                                                       |
| Agents                    | [docs/agents](docs/agents/), [src/packages/README.md](src/packages/README.md)                                                                                                                                                       |

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](docs/SECURITY.md#reporting-a-vulnerability). Do not open a public issue for a security problem.

## License

[AGPL-3.0-or-later](LICENSE.md). The `/acknowledgements` page lists the open-source packages the site ships, with their licences.
