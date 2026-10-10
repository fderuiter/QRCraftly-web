---
status: accepted
---

# TypeScript Scripts Run on Node Type Stripping; Erasable Syntax Only

## Context

Thirteen repository scripts are written in TypeScript: `generate_sitemap.ts` and `generate_social_images.ts` in `postbuild`, the ten `bench:*` scripts, and `scripts/fixtures/generate_bcur_vectors.ts`. They ran through `tsx`, a dev dependency that bundles its own esbuild-based loader. Under [ADR 0040](0040-in-house-first.md) a tool goes when the platform already does its job (#1175, #1189).

Node strips TypeScript types itself from 22.18 and in every 24 release our `engines` field allows (`^22.22.2 || >=24.15.0`). Four things stopped the scripts from running on it directly:

1. **Extensionless imports.** Most relative imports in `src/` have no extension (`'../utils/metadataEngine'`), and some use the `@/` alias from `tsconfig.json`. Vite and TypeScript's `bundler` resolution accept both; Node's ESM resolver does not.
2. **Syntax that has no JavaScript form.** Node only removes types; it does not transform. It refuses `enum`s (fifteen of them, in `src/types.ts` and `src/data/contentRegistry.ts`), `namespace`s with values and constructor parameter properties (`constructor(private readonly x: number)`, in 22 classes, half of them test fakes).
3. **Type names in value imports.** Node keeps every name in `import { QRConfig, QRStyle } from '...'`. When `QRConfig` is only a type, the module has no such export and the import fails at link time. About 280 imports in `src/`, `tests/` and `e2e/` mixed the two.
4. **JSON without an import attribute.** Node needs `with { type: 'json' }`; `src/constants.ts` imported `colors.json` without it.

## Decision

- **Scripts run as `node --import ./scripts/utils/register-ts.js scripts/x.ts`.** `register-ts.js` registers the resolve hook in `scripts/utils/ts-resolve.js` with `module.registerHooks`. For a relative specifier that does not name a file, the hook tries `.ts`, `.tsx`, `.js`, `/index.ts` and `/index.js`, in that order, and it maps `@/` to `src/`. Bare package specifiers, `node:` builtins and URLs go to Node untouched. Paths are built with `node:path` and `node:url` only.
- **`registerHooks`, not `register`.** The issue named `module.register`. We use `module.registerHooks` instead: it runs the hook synchronously in the same thread, where `register` starts a separate loader thread. Node's current documentation deprecates `register` in favour of it (DEP0205). It exists in every Node our `engines` range allows. `register-ts.js` fails with a clear message on a Node without it or without type stripping.
- **Only erasable TypeScript.** `tsconfig.json` turns on `erasableSyntaxOnly` (TypeScript 5.8 or later; 5.8.3 is installed) and `verbatimModuleSyntax`. The first rejects `enum`s, value `namespace`s and parameter properties. The second makes every type-only import say `type`, which is what Node needs. Together they make `tsc` reject what Node cannot run, instead of the build finding out.
- **Each `enum` became an `as const` object and a type of the same name:** `export const QRType = { URL: 'URL', ... } as const; export type QRType = (typeof QRType)[keyof typeof QRType];`. Every value is unchanged, so saved brand templates, URLs and stored settings read as before. All were string enums, so there was no reverse mapping to keep, and `Object.keys` and `Object.values` give the same lists in the same order (`tests/erasableEnums.test.ts`). A type that names one member is written `typeof QRType.URL`. Literal arrays of members that are searched with a wider value are typed with the set's type (`QRStyle[]`).
- **Parameter properties became declared fields** assigned at the top of the constructor.
- **`tsx` is removed.** No ExperimentalWarning appears on Node 22.22 or 24, so no `--disable-warning` flag is needed.
- **Vite, Vitest and ESLint keep their own TypeScript handling.** Nothing changes for them.

## Consequences

- One fewer dev dependency. `tsx` 4.23 itself is the only package that leaves the lockfile (702 to 701 packages): its esbuild and the platform binaries are Vite's too.
- The postbuild scripts start faster (`generate_social_images.ts` took 1.6 s instead of 3.7 s on the machine that measured it) and write the same files. The sitemap is byte-identical apart from dates; the share images and examples are identical apart from the event example's `DTSTAMP`, which is the clock.
- New code cannot use `enum`, value `namespace`s or parameter properties, and type imports must say `type`. `tsc` enforces both in `src/`. `scripts/` and `tests/` are outside the `tsconfig.json` `include`; there Node itself refuses such syntax when a script loads it, and `pnpm build` runs the postbuild scripts on every CI run. The `bench:*` scripts are not run in CI, so a break there shows when someone runs them.
- Node does not strip types from files under `node_modules`. `bench:scanner --ref` used to copy an older `decodeSync.ts` to `node_modules/.cache`; it now copies it to the system temp folder.
- A `.tsx` file cannot be type-stripped. No script imports one today; one that needs to must move the code it uses into a `.ts` module.
- If Node ever resolves extensionless imports or reads `tsconfig` paths itself, the hook can go. Until then it is about 50 lines of our own code.
