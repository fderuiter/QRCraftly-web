# Rust and WebAssembly

QRCraftly's compute kernels (QR encoding and decoding, transfer error correction and similar codecs) are written in plain Rust and compiled to WebAssembly. Everything else stays in TypeScript. The rules and the reasoning are in [ADR 0033](./adr/0033-rust-webassembly-modules.md).

You only need Rust to change something in `crates/`. The built modules are committed in `src/wasm/`, so `pnpm build`, `pnpm test` and Cloudflare Workers Builds work without it.

## Setup

1. Install [rustup](https://rustup.rs/).
2. Run any `cargo` command inside `crates/`. rustup reads `crates/rust-toolchain.toml` and installs the pinned version, the `wasm32-unknown-unknown` target, rustfmt and Clippy. In CI, `rustup toolchain install` does the same.

## Commands

| Command                                                                          | What it does                                                                                                                      |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run wasm:build`                                                            | Builds every module and writes `src/wasm/<module>.wasm` and `src/wasm/<module>.wasm.sha256`.                                      |
| `pnpm run wasm:check`                                                            | Builds every module and fails if any committed file differs. The `wasm-reproducible` CI job runs it.                              |
| `cargo test` (in `crates/`)                                                      | Runs the Rust unit tests on your machine.                                                                                         |
| `cargo fmt --all` and `cargo clippy --all-targets -- -D warnings` (in `crates/`) | Format and lint, as CI does.                                                                                                      |
| `node scripts/rust_no_deps_check.js`                                             | Part of `pnpm run lint`. Fails on any crate from outside the workspace, or a committed `.wasm` that does not match its `.sha256`. |
| `pnpm run bench:wasm`                                                            | Reports each module's size, cold start and per-call time. Add `--json <file>` to save it.                                         |
| `pnpm run bench:qr-encode`                                                       | Times the QR encoder per encode (p50 and p95) through its TypeScript wrapper. Add `--json <file>` to save it.                     |

## Layout

```text
crates/
  Cargo.toml            workspace and release profile
  Cargo.lock            committed; lists workspace crates only
  rust-toolchain.toml   the pinned Rust version
  core/                 qrcraftly-core: GF(256), Reed-Solomon, CRC-32, the ABI and the module allocator
  qr-encode/            the QR encoder (#1177), loaded by src/packages/qr-matrix
  selftest/             a tiny module that proves the build and the loader work
src/wasm/               committed builds and their SHA-256 sidecars
src/packages/wasm-runtime/
                        the TypeScript loader
tests/foundry/          the differential harness, the cross-engine batteries, the QR encoder
                        golden test and the benchmarks
```

## Adding a module

1. Create `crates/<name>/` with `crate-type = ["cdylib", "rlib"]` and one dependency, `qrcraftly-core = { path = "../core" }`. Copy `crates/selftest` as a starting point, AGPL header included.
2. At the crate root, add `#![cfg_attr(target_arch = "wasm32", no_std)]`, `extern crate alloc;` and `qrcraftly_core::module_exports!();` (the last two only on `wasm32`). This gives the module its allocator, panic handler and the `alloc`, `free` and `abi_version` exports.
3. Export `#[no_mangle] pub extern "C"` functions that take pointers and lengths and return a status code from `qrcraftly_core::abi`. Use integer maths and never import anything from JavaScript.
4. Add the crate to `members` in `crates/Cargo.toml`, write its unit tests, and run `pnpm run wasm:build`.
5. Load it with `compileWasmUrl` and `instantiateWasm` from `src/packages/wasm-runtime`, and use the instance's `withBytes`, `withOutput` and `fn` helpers.
6. Give the module a gzipped budget in `WASM_MODULE_BUDGETS_KB` in `scripts/check-bundle-size.js`, and list the calls worth timing in `tests/foundry/wasmBench.ts`.
7. If it replaces existing code, add a differential test with `tests/foundry/differential.ts`, a battery for the cross-engine test, its `__FOUNDRY_<MODULE>__` constant in `src/vite-env.d.ts` and a row in the [Foundry scorecard](./FOUNDRY.md).
8. Commit the crate, `crates/Cargo.lock` and both files in `src/wasm/`.

## Updating a committed module

Change the crate, run `pnpm run wasm:build`, and commit `src/wasm/`. If CI's `wasm-reproducible` job fails with `Fix: pnpm run wasm:build`, the committed file is stale or was edited by hand. To bump Rust, change `channel` in `crates/rust-toolchain.toml` in its own PR and rebuild every module.
