---
status: accepted
---

# Deep Modules and Automated Boundary Enforcement via Dependency-Cruiser

## Context

As QRCraftly expands with complex optical simulations, scannability health evaluation, and SVG/canvas matrix generation, unbounded internal imports and barrel files risk creating tight coupling, hidden dependency cycles, and fragile pass-through abstractions.

## Decision

We enforce a **deep module** architecture across `src/packages/` where every package exposes substantial functionality behind minimal root entry points while completely hiding internal implementation details inside subfolders (`lib/` and `tests/`):

1. **Entry-Point Seam**: External application code and other packages may import only a package's root entry points (`index.ts`, `client.ts`, `maze.ts`), never anything within its subfolders.
2. **Intra-Package Freedom**: Files inside a package's `lib/` directory may import each other freely to keep implementation complexity local.
3. **Tests Through Entry Points**: Package tests under `tests/` exercise the module through its public entry points, importing fixtures only from their local `tests/` folder without deep-importing internal implementation files.
4. **No Dependency Cycles**: Dependencies across the repository must remain strictly acyclic.
5. **No App-Layer Imports**: Packages never import the app's React layers (`src/context`, `src/hooks`, `src/components`, `src/pages`, `src/registry.tsx`). Stores, capabilities and callbacks are injected from the call site. Pre-existing violations are listed as exact, commented known-violation edges (tracked by issue #980) and may only shrink. Issue #980 removed the last of them, so no exemptions remain.
6. **No Monolithic Barrels**: Packages avoid large re-exporting barrel files, preferring multiple focused root entry points when exposing distinct capabilities.
7. **Automated Enforcement**: All boundary invariants are checked by `pnpm run lint:boundaries`, integrated into `pnpm run lint` and CI. This was `dependency-cruiser` (`depcruise src`) until #1196 replaced it with our own checker, `scripts/check_boundaries.js`, which reads the rules from `scripts/boundaries.config.js`.

## Rationale

Encapsulating complex domain logic behind small entry points maximizes leverage for callers and locality for maintainers. Automated boundary auditing prevents architectural decay, eliminates circular dependencies, and ensures high testability.

## Consequences

- Packages under `src/packages/` have standardized layouts (`root entry points`, `lib/`, `tests/`).
- Rogue deep imports from app code or cross-package imports trigger linting errors in `pnpm run lint`.
- Adding new public functionality requires explicitly declaring it at a root entry point.
