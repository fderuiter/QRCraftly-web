---
status: accepted
---

# Rust WebAssembly Modules

## Context

QRCraftly's heavy maths has so far been in third-party JavaScript (QR encoding with `qrcode`, decoding with `jsQR`) or a third-party WebAssembly build (zxing-wasm, [ADR 0023](./0023-zxing-wasm-scanner-decoder.md)). The in-house core plan (#1175) replaces these, plus the transfer error-correction codes, with QRCraftly's own code. Codecs must give the same bytes on every browser and device, and fast paths such as camera decoding and fountain codes need predictable speed. Fred decided on 2026-10-04 that the compute kernels are written in Rust and compiled to WebAssembly, while the UI, scripts, lint, tests and CI stay in JavaScript and TypeScript (#1182).

## Decision

- **Workspace.** Rust lives in `crates/`, a Cargo workspace. `crates/core` (`qrcraftly-core`) is `no_std` and holds the shared maths: GF(256), CRC-32, the calling convention and the module allocator. Each lazily loaded feature is its own `cdylib` crate that depends only on `core`. `crates/selftest` is the template.
- **No third-party crates.** `crates/Cargo.lock` may list only workspace crates and every dependency must be a `path` dependency. `scripts/rust_no_deps_check.js` enforces this in `pnpm run lint`. There is no `wasm-bindgen`, `js-sys` or `web-sys`.
- **ABI.** Modules target `wasm32-unknown-unknown` and export plain `extern "C"` functions over linear memory, plus `memory`, `alloc(len)`, `free(ptr, len)` and `abi_version()`. They import nothing, so a module cannot reach the network, the DOM or the clock; randomness and time come in as arguments. Fallible functions return status codes. `panic = "abort"` turns a panic into a trap. Codecs use integer maths only, so outputs are bit-for-bit identical across browsers.
- **Committed, reproducible builds.** `crates/rust-toolchain.toml` pins an exact Rust version. `pnpm run wasm:build` (`scripts/build_wasm.js`) builds every module with `opt-level = "s"`, LTO, one codegen unit, stripped symbols and the checkout path remapped. It writes `src/wasm/<module>.wasm` and a `.wasm.sha256` sidecar, and both are committed. Cloudflare Workers Builds and contributors without Rust build the site exactly as before. The CI job `wasm-reproducible` installs the pinned toolchain with the runner's own `rustup`, runs `cargo fmt --check`, Clippy with `-D warnings` and `cargo test`, then `pnpm run wasm:check`, which fails if any committed byte differs from a fresh build.
- **Loader.** `src/packages/wasm-runtime` compiles a module once per URL from the site's own origin (`compileStreaming`, falling back to `compile`), refuses other origins and modules with imports, and wraps an instance with typed helpers that copy bytes in and out, refresh memory views after growth, free on every path and turn traps and status codes into a `WasmModuleError`. Modules are instantiated inside the worker that uses them; the main thread may compile and post the `WebAssembly.Module`, as the zxing reader did before [ADR 0036](./0036-in-house-qr-decoder-replaces-zxing-wasm.md) removed it. `scripts/bundle_ast_audit.js` authorizes the loader's one same-origin `fetch`.

## Consequences

- `script-src` keeps `'wasm-unsafe-eval'` for good. It allows WebAssembly compilation only, never JavaScript `eval` ([SECURITY.md](../SECURITY.md)).
- Each module is a few kilobytes to tens of kilobytes and loads only when its feature runs. Each will get its own gzip budget in `scripts/check-bundle-size.js` when it ships, outside the per-page first-load budget.
- Changing a crate means running `pnpm run wasm:build` and committing `src/wasm/`; CI catches a stale or hand-edited binary.
- A replacement ships in stages: the old library stays as the oracle until differential tests, benchmarks and a canary build show the module matches it, and only then is the dependency removed (#1175).
- Contributors need Rust only to change `crates/`. Setup and commands are in [RUST.md](../RUST.md).
