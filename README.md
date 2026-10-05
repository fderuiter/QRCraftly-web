# QRCraftly

[![CI/CD Pipeline](https://github.com/fderuiter/QRCraftly/actions/workflows/main.yml/badge.svg)](https://github.com/fderuiter/QRCraftly/actions/workflows/main.yml)

**[Visit the production site: https://qrcraftly.com](https://qrcraftly.com)**

[QRCraftly](https://qrcraftly.com) is a powerful, privacy-focused, and user-friendly React application for generating customized QR codes. It supports various data types including URLs, text, WiFi credentials, vCards, emails, and crypto payments. Users can extensively customize the appearance of their QR codes, including colors, patterns, and embedded logos, all while ensuring data privacy through client-side processing.

## The QRCraftly Pledge

**QRCraftly is not ad supported, and it never will be.** No ads, no tracking, no sign-up, and everything runs in your browser. If it ever comes down to ads or nothing, the project will be shut down before a single ad goes on it; the only way it would change hands is an outright purchase of the whole project.

Read the full pledge, and exactly what is and isn't collected, in [docs/PLEDGE.md](docs/PLEDGE.md) or at [qrcraftly.com/free-forever](https://qrcraftly.com/free-forever).

## Features

- **Multiple Data Types**: Generate QR codes for URLs, plain text, WiFi networks (WPA/WEP/EAP/Open), Email, vCard contacts, Phone numbers, SMS, Cryptocurrency payments, Calendar Events, GPS Location Coordinates, Video Meetings (Zoom, Microsoft Teams, Google Meet), and Social Profiles (Instagram, X / Twitter, TikTok).
- **Visual Customization**:
  - **Patterns**: Choose from Standard Industrial, Modern Soft, Swiss Dot, Fluid Ink, Cyber Circuit, The Hive, Grunge, and Starburst styles.
  - **Colors**: Customize foreground, background, and finder pattern colors. Includes accessibility-checked preset themes.
  - **Logos**: Upload and embed custom logos with configurable padding, sizes, and border styles (Square, Circle, None). Maximum logo size is 30% to maintain scannability.
  - **Mosaic QR**: Upload a design and tile it across the whole code. Each module takes the image colour under it while keeping its dark or light value, so the code still scans (Halftone or Tiles layout, adjustable Scan Contrast; see [ADR 0019](docs/adr/0019-mosaic-qr-module-level-image-tiling.md)).
  - **Upload Limits**: Supported custom logo formats are image/jpeg, image/png, image/webp, image/svg+xml. Maximum file size is 2MB.
- **Privacy First**: Client-side architecture. All sensitive data processing happens locally in your browser with volatile in-memory guarantees; no user payloads are sent to any server, and there is no analytics or diagnostics reporting.
- **Static Codes Only**: Every code holds its content directly, so it keeps working without QRCraftly and nobody can track or switch it off. There are no dynamic (redirect) codes and no server; production serves static assets only. See [ADR 0022](docs/adr/0022-no-dynamic-qr-codes-client-side-only.md).
- **Scan to Fill**: Scan an existing QR code with the webcam or from an image file to load its content into the matching input form. Decoding runs in the browser.
- **Air-Gapped File Transfer (Beta)**: Send a file from one device to another as an animated stream of QR codes (`/file-transfer`) and receive it with a camera (`/file-transfer/receive`). No network, Bluetooth or USB is involved. The sender picks Steady, Balanced or Fast (raw frame rate and density sit under Advanced) and sees the time for the file before starting; the receiver watches the file assemble as a field of dots and finishes with a verified summary, a thumbnail for images and Open, Save and Receive-another actions. A haptic buzz and an optional chime (off by default) mark the finish; the buzz is skipped under reduced motion.
- **QR Arcade**: Stress-test a QR design by damaging it and watching whether a real scanner still decodes it (`/arcade`).
- **Advanced Architecture**:
  - **Scannability Web Workers**: Real-time QR code scannability, module-aligned relative luminance audits, and orientation decoding run off-thread, passing pixel data as transferable `ArrayBuffer`s (zero-copy) so the UI stays responsive. The camera scanner recycles its frame buffers through a `DoubleBufferPool`.
  - **Client-Side SVG Export**: Features a custom `SvgContext` that mimics the Canvas 2D API to generate high-quality, resolution-independent vector graphics directly in the browser.
- **Live Preview**: See your changes instantly as you edit.
  - **In the wild**: Switch the preview to a poster, business card, table tent, phone screen or sticker, all drawn in code (no photos or outside files). Set the printed width to see the module size, the estimated scan distance and a warning when it is too small, run a viewing test (distance, glare, dim light, tilt) through the scannability evaluator, and download the scene as a PNG made on your device. The scenes load only when you pick one.
- **Power Features**:
  - **Style Gallery**: Every pattern and colour preset drawn on your own QR code; hover to preview, click to apply, or press "Surprise me" for a look that is expected to scan.
  - **Undo and redo**: Up to 50 appearance steps per generator, kept in memory only (never stored).
  - **Command palette and shortcuts**: `Ctrl/Cmd+K` opens a searchable list of 30+ actions; `Ctrl/Cmd+Z`, `Ctrl/Cmd+S`, `Ctrl/Cmd+C` (on the preview) and `?` do the obvious things.
  - **Style files**: Save the look to a `.qrcraftly.json` file and load it again (or drop it on the page). A style file holds colours and layout only: never your content or images.
- **Download & Share**:
  - Save as high-quality PNG, JPEG, WebP, or vector SVG.
  - Native "Save As" support via File System Access API.
  - Web Share API integration for mobile sharing.
- **Accessibility**:
  - WCAG contrast checks for generated codes.
  - Fully accessible UI with keyboard navigation and screen reader support.
- **Compliance**:
  - Privacy-first architecture aligned with [HIPAA Technical Safeguards](docs/public/COMPLIANCE.md).
- **Dark Mode**: Fully supported dark mode interface.
- **Responsive Design**: Works seamlessly on desktop and mobile devices.

## Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

Ensure you have the following installed on your machine:

- [Node.js](https://nodejs.org/) 22.22.2 or a later 22.x release, or 24.15.0 or later (the lockfile's dependencies require it; `.nvmrc` pins the version CI uses)
- [pnpm](https://pnpm.io/) (strictly mandated, do not use `npm` or `yarn`). The exact version is pinned in `package.json` under `packageManager`; running `corepack enable` once makes the pinned version available automatically.

### Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/fderuiter/QRCraftly.git
    cd QRCraftly
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

### Running the Application

To start the development server:

```bash
pnpm dev
```

The application will typically start at `http://localhost:3000` (or another available port shown in the terminal).

### Building for Production

To create a production-ready build (Static Site Generation via Vike):

```bash
pnpm build
```

The build artifacts will be stored in the `dist/` directory.

To preview the production build locally:

```bash
pnpm preview
```

### Running Tests

To run the unit test suite (Vitest, watch mode by default; use `pnpm exec vitest run` for a single pass):

```bash
pnpm test
```

To run coverage reports:

```bash
pnpm exec vitest run --coverage
```

To run End-to-End (E2E) tests (Playwright):

Note: On a fresh environment, you must install the required browsers first.

```bash
pnpm exec playwright install
pnpm test:e2e
```

### Local Verification

This project enforces strict quality checks in CI. Run the complete quality suite locally to prevent build failures. This combined script performs linting, type-checking, and accessibility verification matching the CI pipeline logic:

```bash
pnpm run lint
```

**Bundle Size Check:**
CI fails if any page's first load (its HTML, CSS and startup scripts, gzipped) exceeds 260 KB, or if the JavaScript and CSS in `dist/client` together exceed 650 KB (`scripts/check-bundle-size.js`; the scanner's lazily loaded `.wasm` reader has its own 450 KB budget). `pnpm build` does not run this check; run it yourself after a build:

```bash
pnpm build
pnpm run check-bundle-size
```

**Performance & SEO:**
Lighthouse CI runs on every Pull Request to audit performance, accessibility, best practices, and SEO.

## Usage Guide

1.  **Select Content Type**: Use the icon grid at the top of the input panel to choose the type of QR code you want to create (e.g., URL, WiFi).
2.  **Enter Data**: Fill in the required fields for the selected type. The QR code preview will update automatically.
3.  **Customize Appearance**:
    - Scroll down to the "Appearance" section.
    - Select a **Pattern Style**.
    - Choose a **Color Preset** or manually adjust the Foreground, Background, and Eye colors.
    - _Tip_: Watch out for the "Low Contrast" warning to ensure your QR code is scannable.
4.  **Add a Logo (Optional)**:
    - Click "Upload Logo" to add an image to the center of the QR code.
    - Adjust the logo size, border style, and padding.
    - Or click "Upload Mosaic Design" to tile a picture across the whole code, then pick Halftone or Tiles and raise Scan Contrast if the scan badge warns.
5.  **Download**:
    - Click the **Download** button to save as a high-quality PNG.
    - Click the arrow next to Download to choose other formats (JPEG, WebP).
    - Use "Save to Photos" on mobile devices or "Share" to send it to other apps.

## Project Structure

- `CONTEXT.md`: Root domain glossary defining canonical project terminology.
- `RELEASING.md`: Release, promotion and rollback runbook.
- `docs/`: Architectural specifications and system documentation.
  - `adr/`: Architectural Decision Records.
  - `public/`: Public guides, UI component catalog, edge architecture, scaling, and compliance specifications.
  - `SECURITY.md`: Security policy, Content Security Policy, and vulnerability reporting.
  - `ABUSE_PROTECTIONS.md`: What QRCraftly does to stop harmful codes and to protect people who scan codes or receive files, and its limits.
  - `WORKFLOWS.md`: Branching model and CI pipeline.
  - `agents/`: Instructions for AI agents (issue tracker, triage labels, domain docs).
- `e2e/`: Playwright end-to-end tests.
- `src/`: Source code.
  - `components/`: Reusable React components.
    - `InputPanel.tsx`: Main controller for data input; orchestrates sub-components.
    - `inputs/`: Modular input components for each QR type (e.g., `WifiInput`, `VCardInput`).
    - `StyleControls.tsx`: UI for customizing colors, patterns, and logos.
    - `QRCanvas.tsx`: The core component that renders the QR code using HTML5 Canvas.
    - `QRTool.tsx`: The main container component that integrates inputs, controls, and canvas.
    - `QRScanner.tsx`: Webcam and file-upload QR scanner used by the input panel.
    - `arcade/`: Components for the QR Arcade page.
  - `packages/`: Deep modules with small public entry points (`qr-matrix`, `qr-export`, `qr-payload`, `scannability`, `optical-scanner`, `optical-transfer`, `arcade`). See [src/packages/README.md](src/packages/README.md).
  - `hooks/`: React hooks (camera, image upload, download).
  - `layouts/`: Application layouts.
    - `LayoutDefault.tsx`: The main layout wrapper.
    - `Head.tsx`: Manages document head elements.
  - `pages/`: Page-level components (Vike routing).
    - `index/+Page.tsx`: The home page.
    - `about/+Page.tsx`: The about page.
    - `acknowledgements/+Page.tsx`: Open-source packages the site ships, with their licenses.
    - `wifi-qr-code/+Page.tsx` and the other `*-qr-code/` folders: One page per QR type.
    - `file-transfer/+Page.tsx` and `file-transfer/receive/+Page.tsx`: Air-gapped file sender and receiver.
    - `arcade/+Page.tsx`: QR Arcade (`/game` and `/destroy-the-qr` redirect here).
    - `+config.ts`: Global Vike configuration.
  - `types.ts`: TypeScript definitions for application state and data structures.
  - `constants.ts`: Default configurations and preset data.
- `scripts/`: Utility scripts.
  - `contrast_check.js`: Checks WCAG contrast compliance for UI elements.
  - `check-bundle-size.js`: Per-page first-load budget (260 KB gzipped), a loose 650 KB ceiling on shipped JavaScript and CSS and a separate 450 KB budget for the lazily loaded scanner WebAssembly, run in CI.
  - `vite/thirdPartyLicenses.ts`: Builds the acknowledgements data and checks `vite/shipped-packages.json` against the client bundle (`pnpm run licenses:sync` rewrites the list).
  - `storage_privacy_ast_auditor.js`: Blocks browser storage keys that are not on the allowlist.
- `tests/`: Vitest tests for the repository scripts and CI tooling.
- `public/`: Static assets (favicon, etc.).

## Contributing

- **Branch from `main`.** `main` is the only long-lived branch, and every merge to it deploys to production. Name branches with a standard prefix (`feat/`, `fix/`, `docs/`, `refactor/`, `chore/`, `agent/`) and open pull requests against `main`. PRs are squash-merged once the `CI` and `PR Title` checks pass. Releases are described in [RELEASING.md](RELEASING.md).
- **Use [Conventional Commits](https://www.conventionalcommits.org/)** for PR titles (`feat:`, `fix:`, `docs:`, `chore:`, ...). The squashed title becomes the commit on `main`, and the release engine derives the next SemVer version and the changelog from it.
- **Run the checks before pushing.** Husky runs formatting, typechecking, duplication audits and tests on commit. CI additionally runs `pnpm run lint`, `pnpm exec vitest run --coverage`, `pnpm test:e2e` and `pnpm build`.
- **Read the guardrails.** [AGENTS.md](AGENTS.md) lists the project invariants (client-side only generation, storage allowlist, UI component reuse, workflow hardening), and [CONTEXT.md](CONTEXT.md) defines the domain vocabulary.
- **Report bugs and ideas** through the GitHub issue forms; report security issues privately as described in [SECURITY.md](docs/SECURITY.md).

## Contributor Guide for Dependencies

To maintain security and reduce repository noise, QRCraftly uses **Dependabot** to manage third-party dependencies.

- **Automated Scanning**: Dependabot checks for outdated packages daily and monitors for security vulnerabilities.
- **Grouped Updates**: Non-security routine updates are consolidated into logical groups (e.g., `dev-dependencies`, `production-dependencies`) to minimize PR volume.
- **Security Priority**: Critical security patches bypass routine grouping and are issued as isolated PRs for immediate visibility.
- **Review Process**: All dependency update PRs require human review. Before merging, ensure the CI pipeline (the `CI` check, which covers static validation, unit tests, E2E tests, and the build with its bundle size check) has passed successfully.
- **Open-source acknowledgements**: The `/acknowledgements` page lists every third-party package whose code ships to the browser, with its version and license text, read from the installed packages at build time. `scripts/vite/shipped-packages.json` names those packages, and every build checks it against the client bundle (pages, web workers and CSS). When an update adds or removes a shipped package, the build fails with a `Fix:` hint: run `pnpm run licenses:sync`, check the new package's license and commit the updated list.
- **Package Manager**: QRCraftly strictly mandates **pnpm**. Dependabot is configured to respect `pnpm-lock.yaml`. Never use `npm install` or `yarn` when manually updating dependencies.

## Technologies Used

- **React 19**: UI library.
- **TypeScript**: Static typing for better code quality.
- **Vite 6**: Fast build tool and development server.
- **Vike**: Routing and build-time pre-rendering (every page is pre-rendered to static HTML).
- **Tailwind CSS v4**: Utility-first CSS framework for styling.
- **Rust and WebAssembly**: QRCraftly's own QR encoder (`crates/qr-encode`), built to `src/wasm/` (see [docs/RUST.md](docs/RUST.md)).
- **Lucide React**: Icon set.
- **Vitest**: Testing framework.

## Styling and Theme Configuration

QRCraftly uses **Tailwind CSS v4**, which introduces a streamlined CSS-first configuration model. The legacy `tailwind.config.js` file is obsolete and has been removed to maintain a single source of truth for all styling.

All custom styling, theme extensions, and Tailwind configurations are now managed directly in the main CSS entrypoint: `src/layouts/index.css`.

### How to Manage Styles

- **Theme Variables**: The app currently uses Tailwind's default palette, and `src/layouts/index.css` has no `@theme` block. To add custom brand colors, breakpoints, fonts, or other theme extensions, add an `@theme` block to that file.
- **Dark Mode**: The class-based dark mode is configured using a custom variant directly in the CSS (`@variant dark (&:where(.dark, .dark *));`), replacing the legacy JS configuration.
- **Utility Classes**: Continue writing standard Tailwind utility classes in your React components. The PostCSS setup will automatically handle processing via the `@tailwindcss/postcss` plugin.

For developers customizing the UI or extending the design system, `src/layouts/index.css` is the definitive file to modify.

## License

[AGPL-3.0](LICENSE.md)
