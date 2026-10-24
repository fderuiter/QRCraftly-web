# `core` (`@/packages/core`)

The shared bottom layer of the packages ([ADR 0052](../../../docs/adr/0052-shared-core-package.md)).

## Contract

- **Shared by two or more packages.** Code that only one package uses lives in that package, and app-only code stays in `src/types.ts`, `src/constants.ts` or `src/utils/`.
- **A leaf.** `core` imports nothing else in `src`: no other package and no app code. The `core-is-a-leaf` boundary rule enforces this.
- **One entry point per concern, no barrel.** Import `@/packages/core/types`, `@/packages/core/security`, `@/packages/core/url` or `@/packages/core/encoding` directly. There is no `index.ts`.

The entry points arrive with the slices that move code here (#1521-#1529). Until then this folder holds only this README.
