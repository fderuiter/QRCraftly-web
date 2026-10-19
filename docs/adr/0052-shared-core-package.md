---
status: accepted
---

# A Shared Core Package Below the Other Packages

## Context

Packages are deep modules ([src/packages/README.md](../../src/packages/README.md)), and `scripts/check_boundaries.js` already stops them from importing components, hooks, pages and context. They still reach up into the app root, though. On 2026-10-19 `src/packages` (tests excluded) imported `@/types` 99 times, `@/utils/security` 21 times, `@/utils/colorUtils` 9, `@/utils/url` 8, `@/utils/bytes` 7, and `fileNames`, `hostname`, `meetingParsers` and `assetCache` 6 times between them: 150 imports from 67 files.

That has three costs:

- **No package stands alone.** Every package depends on `src/types.ts` (638 lines), a mix of generator types, transfer types and constants, so one change there re-typechecks and re-tests everything.
- **The security helpers have no contract.** `isDangerousUrl`, `sanitizeSvg` and the phone and SMS sanitizers live in `src/utils/security.ts`, which any file can import from anywhere and which has no entry point.
- **Small helpers get copied.** The ECC level list is spelled out in `qr-decode/lib/reader.ts`, `qr-matrix/lib/encoder.ts` and next to the type in `src/types.ts`, and SHA-256 is implemented in `src/utils/sha256.ts`, `optical-transfer/lib/fountain/session.ts` and `wallet-pass/lib/cms.ts`.

## Options considered

- **Keep the status quo and document it.** No churn, but the coupling grows with every change to `src/types.ts`, and "deep module" stays only partly true.
- **Every package owns all of its types.** The most isolated, but the generator's configuration (`QRConfig`, ECC levels, module styles) really is shared by `qr-matrix`, `qr-export`, `scannability` and `qr-payload`, so it would be duplicated or imported sideways.
- **A shared `core` package at the bottom (chosen).** Only what two or more packages use moves there. Types used by one package move into that package.

## Decision

- Add `src/packages/core` with focused entry points and no `index.ts` barrel:
  - `types.ts`: the domain types and constants shared by two or more packages (`QRConfig`, `QRType`, `QRStyle`, `QRErrorCorrectionLevel` and the single ECC level list).
  - `security.ts`: `isDangerousUrl`, `sanitizeSvg` and the phone and SMS sanitizers.
  - `encoding.ts`: bytes and hex helpers, SHA-256 (one synchronous and one WebCrypto version) and colour parsing.
- `core` imports nothing else in `src/`. Other packages may import `core` through those entry points, like any other package.
- Types used by one package move into that package's entry points. `src/types.ts` keeps only app-level types and re-exports nothing from `core`, so app code imports `@/packages/core/types` directly (no shims, as `AGENTS.md` requires).
- Add a boundary rule, `packages-must-not-import-app-root`: a file under `src/packages/` may not import `@/types` or `@/utils/*`. It starts with an allowlist of today's offenders, and the allowlist may only shrink, like `LEGACY_PALETTE_FILES` in `scripts/design_token_audit.js`.
- Migrate one package per PR, starting with the packages that use the security helpers most (`qr-export`, then `scannability` and `qr-payload`), and remove each package from the allowlist in the PR that migrates it.

## Consequences

- The dependency direction becomes app → packages → `core`, and the boundary check enforces it.
- The security helpers get one entry point, their own tests through it, and one place for reviewers to look.
- The copied ECC lists and SHA-256 implementations collapse to one each.
- About 150 import lines move, so open PRs that touch packages will conflict. Migrating one package at a time keeps each conflict small.
- `core` could become the next grab-bag. The rule is that something moves into it only when two or more packages use it.
- `AGENTS.md` and `docs/SECURITY.md` point at `src/utils/colorUtils.ts` and `src/utils/security.ts` today. They are updated in the PR that moves each file.
- Whether `core/security.ts` should absorb the `link-safety` package is left open until the move is done.
