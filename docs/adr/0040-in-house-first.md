---
status: accepted
---

# In-House First

## Context

Issue #1175 inventoried every package QRCraftly depends on and found that most of the install, and every third-party byte the browser runs beyond React and Vike, came from packages doing small jobs we could do ourselves. Each one is code we did not review, a licence to track, maintainers we rely on, and a possible network call or patent claim. [Foundry](../FOUNDRY.md) replaces them one at a time: `qrcode`, `jsqr` and `zxing-wasm` are gone, and #1181 removed `@ngraveio/bc-ur`, which pulled in 50 packages to serve one test. Without a written rule, new dependencies arrive faster than Foundry removes them.

## Decision

Our own code comes first. A third-party package is the exception, and the exception is written down.

- **Runtime dependencies.** Any new package in `dependencies`, or any other code the browser runs that we did not write, needs its own ADR. The ADR says:
  - why our own code cannot do the job;
  - the size it adds, gzipped;
  - its licence;
  - who maintains it and how actively;
  - every network request it can make;
  - any patent notes;
  - the exit plan, meaning how we would remove it.

  `ALLOWED_DEPENDENCIES` in `scripts/dependency_compliance.js` only grows with that ADR.

- **Dev dependencies and GitHub Actions.** A new dev dependency or third-party Action needs one line in the PR saying why, and a row in the [Foundry scorecard](../FOUNDRY.md#scorecard).
- **Test oracles.** A package used only to check our output is frozen into fixtures instead. A script in `scripts/fixtures/` generates the vectors once, each fixture records the package version, the script and the date, and the package is then removed. The BC-UR vectors in `src/packages/optical-transfer/tests/fixtures/bcur/` are the first.
- **Language split.** Compute kernels are plain Rust compiled to WebAssembly, with no third-party crates and committed, reproducible `.wasm` files ([ADR 0033](./0033-rust-webassembly-modules.md)). UI, shaders, scripts, lint and tests stay in TypeScript or JavaScript.
- **Browser built-ins first.** A browser API beats both a package and our own code. WebCrypto and `CompressionStream` stay, and we never write our own cryptography.
- **Foundations kept.** React, React DOM, Vike, Vike React, `lucide-react`, Vite, TypeScript, Tailwind, PostCSS, Vitest, jsdom, Testing Library, Playwright, axe-core, ESLint and its plugins, Prettier, Knip, Wrangler and the hosting and CI tools listed under "Kept" in the scorecard are foundations. This policy does not ask to replace them. They are reviewed once a year.

## Consequences

- `scripts/dependency_compliance.js` points at this ADR when it rejects a dependency, and `AGENTS.md` lists the rule with the other non-negotiables.
- Adding a package takes longer. That is the point: the ADR is where the cost is weighed.
- Frozen fixtures do not follow a package's later fixes. That is acceptable for a published format such as BC-UR, whose vectors do not change, and the generator script can be run again if they ever do.
