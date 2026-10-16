# Foundry

Foundry is how QRCraftly replaces a third-party package with its own code ([#1175](https://github.com/fderuiter/QRCraftly-web/issues/1175)). Compute kernels are rewritten in plain Rust and compiled to WebAssembly ([ADR 0033](./adr/0033-rust-webassembly-modules.md), [RUST.md](./RUST.md)). Everything else is rewritten in TypeScript. Nothing is removed until the replacement has been shown to match it. The policy behind it, and what a new dependency must justify, is [ADR 0040](./adr/0040-in-house-first.md).

## Stages

Each replacement moves through these stages in order. The scorecard below records where each one stands.

| Stage     | Done when                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inventory | The package, everything that imports it and everything it pulls in are listed.                                                                               |
| Contract  | The issue states the inputs, outputs and errors the replacement must reproduce, and the corpora that prove it.                                               |
| Shadow    | The replacement exists, and the differential harness runs it beside the package on the same inputs with no mismatches.                                       |
| Bench     | `pnpm run bench:wasm` (or the module's own bench) shows the size, cold start and per-call time are within the issue's budget.                                |
| Canary    | The site builds and passes unit and E2E tests with the replacement switched on (`FOUNDRY_<MODULE>=wasm`) as well as off.                                     |
| Cutover   | The switch defaults to the replacement.                                                                                                                      |
| Removal   | The package is gone from `package.json`, `ALLOWED_DEPENDENCIES`, `shipped-packages.json`, the acknowledgements page and the inventory, and so is the switch. |

## Tools

- **Differential harness.** `tests/foundry/differential.ts` loads a committed module from `src/wasm/` through the same loader the browser uses. `runDifferential` runs the module and the code it replaces on the same inputs and lists every input where they disagree. Throwing counts as an output. `seededBytes` makes repeatable random inputs. `tests/foundry/selftest.test.ts` shows the pattern.
- **Cross-engine test.** `e2e/foundry-wasm.spec.ts` compiles a module in Chromium, Firefox and WebKit from the page's own origin. It hands the compiled module to a worker, runs a fixed battery there and checks that the output is byte-for-byte the one Node gives. The battery for the self-test module is `tests/foundry/selftestBattery.ts`, and Vitest pins its SHA-256.
- **Budgets.** Each module has a gzipped budget in `WASM_MODULE_BUDGETS_KB` in `scripts/check-bundle-size.js`. Modules are measured from `src/wasm/`, outside the per-page first-load budget and the site ceiling. A module without a budget line fails the check.
- **Benchmark.** `pnpm run bench:wasm` reports each module's size, its cold start (compile plus instantiate) and the time per call of the exports listed in `tests/foundry/wasmBench.ts`. Add `--json <file>` to save the report.
- **Canary switch.** Vite defines one constant per committed module, for example `__FOUNDRY_SELFTEST__`. It is `"wasm"` when the build runs with `FOUNDRY_SELFTEST=wasm` and `"js"` otherwise (`foundryDefines` in `scripts/utils/rustWorkspace.js`). Code picks an implementation with it, so the bundler drops the other one. A misspelt switch or value fails the build. Declare each module's constant in `src/vite-env.d.ts`. While a module is at the canary stage, CI runs the unit and E2E jobs a second time with its switch on.

## Scorecard

### Rust modules

| Module                                                                        | Replaces                                                                                                                                                    | Stage                                                                                                                                                                                    | Gzip budget |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `selftest` ([#1182](https://github.com/fderuiter/QRCraftly-web/issues/1182))  | nothing; proves the build and the loader                                                                                                                    | Shipped as a test fixture only                                                                                                                                                           | 4 KB        |
| `qr-encode` ([#1177](https://github.com/fderuiter/QRCraftly-web/issues/1177)) | `qrcode` and its 28 packages                                                                                                                                | Removed: `qrcode` is gone                                                                                                                                                                | 20 KB       |
| `prism-fec` ([#1176](https://github.com/fderuiter/QRCraftly-web/issues/1176)) | the LT fountain code (in-house TypeScript)                                                                                                                  | Built ([ADR 0037](./adr/0037-prism-outer-code-lt-over-ldpc-precode.md)); the transfer sends with it as an opt-in preview ([ADR 0038](./adr/0038-prism-manifest-v2-outer-code-opt-in.md)) | 10 KB       |
| `qr-decode` ([#1178](https://github.com/fderuiter/QRCraftly-web/issues/1178)) | `jsqr`, then `zxing-wasm`                                                                                                                                   | Removed: `jsqr` and `zxing-wasm` are gone ([ADR 0036](./adr/0036-in-house-qr-decoder-replaces-zxing-wasm.md))                                                                            | 32 KB       |
| `modem` ([#1198](https://github.com/fderuiter/QRCraftly-web/issues/1198))     | the optical modem's TypeScript kernels: Reed-Solomon, codec, fiducial search, cell sampling, constellations, probe analysis and the colour cross-talk model | Removed: the TypeScript kernels are gone; the module reads every frame. Differential test against frozen goldens of the old kernels in `tests/foundry/modem.test.ts`                     | 52 KB       |

### Other replacements

| Package                                    | Replacement                                                                 | Stage   |
| ------------------------------------------ | --------------------------------------------------------------------------- | ------- |
| `tj-actions/changed-files`                 | `scripts/ci/changed_files.js` (#1183)                                       | Removed |
| `dawidd6/action-send-mail`                 | `scripts/ci/audit_issue.js` (#1184)                                         | Removed |
| `davelosert/vitest-coverage-report-action` | `scripts/ci/coverage_summary.js` (#1185)                                    | Removed |
| `vitest-axe`                               | `tests/utils/axe.ts` on axe-core (#1186)                                    | Removed |
| `@testing-library/jest-dom`                | `tests/utils/domMatchers.ts` (#1188)                                        | Removed |
| `@ngraveio/bc-ur`                          | frozen vectors (#1181)                                                      | Removed |
| `tsx`                                      | Node's own type stripping (#1189)                                           | Removed |
| `husky`, `lint-staged`                     | our own hooks and staged-file runner (#1190)                                | Removed |
| `marked`                                   | `scripts/utils/markdown/` (#1191)                                           | Removed |
| `globals`                                  | `eslint/node-globals.js` (#1192); ESLint itself still pulls in `globals` 14 | Removed |
| `eslint-plugin-security`                   | ESLint core and our own rules in `eslint/rules/` (#1193)                    | Removed |
| `eslint-plugin-tailwindcss`                | `eslint/rules/tailwind-classes.js` (#1194)                                  | Removed |
| `jscpd`                                    | `scripts/check-duplication.js` (#1195)                                      | Removed |
| `dependency-cruiser`                       | `scripts/check_boundaries.js` (#1196)                                       | Removed |
| `@vitejs/plugin-react`                     | Vite's esbuild JSX (#1197); Babel stays for `eslint-plugin-react-hooks`     | Removed |

### Kept

These are foundations, kept by decision (Fred, 2026-10-04). Every remaining dependency and third-party action is listed here with the effort it would take to build our own. Scale: S is under 1 day, M about 1 day, L 1–2 weeks, XL 1–3 months, XXL a team-year or more. The reasoning behind each estimate is in #1175.

| Package                                                 | Kind            | Decision                                         | Effort to replace                                    |
| ------------------------------------------------------- | --------------- | ------------------------------------------------ | ---------------------------------------------------- |
| `react`, `react-dom`                                    | runtime         | Foundation, keep                                 | XL (compatible runtime) or XXL (signals rewrite)     |
| `vike`, `vike-react`                                    | runtime         | Foundation, keep                                 | L                                                    |
| `lucide-react`                                          | runtime         | Foundation, keep (#1180)                         | S–M                                                  |
| `@types/react`, `@types/react-dom`                      | dev, types only | Foundation, keep; they go with React             | Not sensible: they track React's own API             |
| `@types/node`                                           | dev, types only | Foundation, keep; types for our Node scripts     | Not sensible: they track Node's own API              |
| `vite`, `typescript`                                    | dev             | Foundation, keep                                 | XXL                                                  |
| `tailwindcss`, `@tailwindcss/postcss`, `postcss`        | dev             | Foundation, keep                                 | L                                                    |
| `vitest`, `@vitest/coverage-v8`                         | dev             | Foundation, keep                                 | XL                                                   |
| `jsdom`                                                 | dev             | Foundation, keep                                 | XXL                                                  |
| `@testing-library/react`, `@testing-library/user-event` | dev             | Foundation, keep                                 | M–L                                                  |
| `dom-accessibility-api`                                 | dev             | Foundation, keep; names for our DOM matchers     | L (an accessible-name engine)                        |
| `@playwright/test`                                      | dev             | Foundation, keep                                 | XXL                                                  |
| `axe-core`                                              | dev             | Foundation, keep                                 | XL                                                   |
| `@axe-core/playwright`                                  | dev             | Foundation, keep (#1187)                         | S                                                    |
| `eslint`, `@eslint/js`, `typescript-eslint`             | dev             | Foundation, keep; our own rules plug into ESLint | XL                                                   |
| `eslint-plugin-react`, `eslint-plugin-react-hooks`      | dev             | Foundation, keep                                 | M                                                    |
| `eslint-plugin-jsx-a11y`                                | dev             | Foundation, keep                                 | L                                                    |
| `eslint-plugin-jsdoc`                                   | dev             | Foundation, keep                                 | S–M                                                  |
| `prettier`                                              | dev             | Foundation, keep                                 | XL                                                   |
| `knip`                                                  | dev             | Foundation, keep                                 | L                                                    |
| `wrangler`                                              | dev             | Foundation, keep                                 | L, but not sensible: Workers Builds runs it          |
| Semgrep (installed by CI, not a package)                | CI tool         | Foundation, keep                                 | XL                                                   |
| `pnpm/action-setup`                                     | GitHub Action   | Keep for now; possible small win                 | S (`corepack enable` and the `packageManager` field) |
| `treosh/lighthouse-ci-action`                           | GitHub Action   | Keep for now; possible small win                 | S (call the Lighthouse CI CLI in a `run:` step)      |
| GitHub's own actions (`actions/*`)                      | GitHub Action   | Foundation, keep                                 | Not sensible                                         |

Scorecard and CodeQL left when the repository went private ([ADR 0050](./adr/0050-ci-tiers-for-a-private-repository.md)).
