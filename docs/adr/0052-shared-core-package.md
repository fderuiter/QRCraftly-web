---
status: accepted
---

# A Shared Core Package for Cross-Package Types and Helpers

## Context

[`src/packages/README.md`](../../src/packages/README.md) describes packages as deep modules behind root entry points, and `scripts/check_boundaries.js` keeps them out of the app's React layers (context, hooks, components, pages). They still reach up into the app root, though. On 2026-10-23, 117 package files (production and tests, across ten packages) made 178 imports of it:

| Imported module                                                                          | Imports from `src/packages` |
| ---------------------------------------------------------------------------------------- | --------------------------- |
| `src/types.ts`                                                                           | 99                          |
| `src/constants.ts`                                                                       | 23                          |
| `src/utils/security.ts` (`isDangerousUrl`, `sanitizeSvg`, …)                             | 21                          |
| `src/utils/colorUtils.ts`                                                                | 9                           |
| `src/utils/url.ts`                                                                       | 8                           |
| `src/utils/bytes.ts`                                                                     | 7                           |
| `src/utils/sha256.ts`                                                                    | 4                           |
| `src/utils/fileNames.ts`, `hostname.ts`, `a11y.ts`, `assetCache.ts`, `meetingParsers.ts` | 7                           |

`src/types.ts` mixes shared domain types with app-only ones, so every package depends on it and a change there re-checks everything. The security sanitizers live in an un-packaged `utils/` folder with no entry-point contract. The ECC level list is defined three times (in `arcade`, `qr-decode` and `qr-matrix`) next to its type in `types.ts`. One import even escapes with a relative path (`optical-transfer/lib/bcur/xoshiro.ts`). No boundary rule covers `src/types`, `src/constants` or `src/utils`, so nothing stops the count from growing.

## Decision

- Create `src/packages/core`: the code two or more packages share. It has one entry point per concern and no barrel: `types.ts` (cross-package domain types such as `QRConfig`, ECC levels and module styles), `security.ts` (URL, SVG and phone sanitizers), `url.ts`, and `encoding.ts` (bytes, hex, SHA-256, colour parsing). Code used by one package moves into that package instead. `src/types.ts`, `src/constants.ts` and `src/utils/` stay as app modules.
- `core` is a leaf: it imports no other package and no app code (boundary rule `core-is-a-leaf`).
- Packages may not import `src/types`, `src/constants` or `src/utils` (boundary rule `packages-must-not-import-app-root`). The rule checks resolved paths, so relative escapes count too. Today's offenders are listed in `LEGACY_APP_ROOT_IMPORTERS` in `scripts/boundaries.config.js`. The list only shrinks: a test fails when a listed file no longer imports app-root code, and new files never join it. This is the same pattern as `LEGACY_PALETTE_FILES` in the design-token audit.
- Move the code one slice per PR (#1521-#1529), and delete the allowlist when it is empty.
- The Arcade stays a package like any other (its removal in #1503 was dropped).

## Options Considered

- **A. Keep the status quo and document the exception.** No churn, but packages cannot be tested or reasoned about alone, the sanitizers have no owner, and the coupling grows with each change to `types.ts`.
- **B. A shared `core` package with a shrink-only rule (chosen).** One dependency direction (app → packages → core). The sanitizers get an entry-point contract, and the duplicated ECC and SHA-256 code collapses into one copy. About 180 import lines change, mostly mechanically, over several PRs. Risk: `core` becomes the next grab-bag. The "shared by two or more packages" rule in its README guards against that.
- **C. Each package owns its types, with no shared package.** The most isolation, but it fights the domain: the generator config is shared by `qr-matrix`, `qr-export`, `scannability` and `qr-payload`, so it means duplicated types or cross-package type imports.

## Consequences

- Packages can be tested and audited alone. The security sanitizers sit behind one entry point, and Knip can find dead shared types.
- Open PRs that touch package imports will conflict with the move slices, so each slice is small and covers one area.
- The boundary checker gains two rules and an allowlist. The allowlist has to be maintained until it is empty.
- **Done (#1529):** the migration is complete. Every package file is off the app root, the allowlist and its shrink-only test are deleted, and `packages-must-not-import-app-root` has no exceptions. `src/types.ts` keeps only `BrandTemplate` and `BrandTemplateExportPayload`.
- **To revisit:** whether `core/security` should absorb `link-safety`'s URL checks. Decide after the move, not before.
