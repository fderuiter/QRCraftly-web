---
status: accepted
supersedes: 0023
---

# In-house QR Decoder Replaces zxing-wasm

## Context

[ADR 0023](./0023-zxing-wasm-scanner-decoder.md) put zxing-wasm (zxing-cpp compiled to WebAssembly) in the optical scanner's worker, between the platform `BarcodeDetector` and the jsQR fallback. It read more hard camera frames than jsQR, but it came at a cost:

- `zxing_reader.wasm` is 953,527 bytes, 413,012 bytes (about 403 KiB) gzipped, downloaded by everyone who scans without a platform detector. It needed its own 450 KB budget outside the site total.
- It is a third-party binary with one maintainer. Its JavaScript glue had network loaders that a build plugin (`scripts/vite/zxingNoNetwork.ts`) stripped and a test (`tests/zxing_no_network.test.ts`) watched on every upgrade, and the bundle audit carried an exception for its one `fetch`.

Issue [#1178](https://github.com/fderuiter/QRCraftly-web/issues/1178) built QRCraftly's own decoder instead: the Rust module `crates/qr-decode`, compiled to `src/wasm/qr-decode.wasm` (32 KB budget) and loaded by `src/packages/qr-decode` ([ADR 0033](./0033-rust-webassembly-modules.md)). It replaced jsQR everywhere first, then had to reach parity with zxing-wasm on the hard corpus from #1104 before zxing could go.

## Decision

The optical scanner's decoder chain is now:

1. **The platform `BarcodeDetector`**, when `getSupportedFormats()` lists `qr_code`. Unchanged.
2. **Our reader (`qr-decode`) in the scanner worker.** Camera frames get one bounded pass per frame, consecutive frames rotating strategies (`decodeCameraCode`); image files get the multi-pass decode (`decodeRgbaCode`) at each file scan size. Without a worker the same decoder runs on the main thread.

The multi-frame confirmation, repeat hold and byte-exact results from ADR 0023 stay. A result's `decoder` is `native` or `qr-decode`.

Removed with zxing-wasm: the dependency and its acknowledgements entry, the main-thread module compile and the message that posted it to the worker (`lib/zxingModule.ts`, `lib/zxingReader.ts` and the package's `reader` entry point), the no-network Vite plugin and its test, the lazy WebAssembly budget in `scripts/check-bundle-size.js`, the bundle-audit `fetch` exception and the dependency-compliance entries. The bundle check now fails when `dist/client` ships a `.wasm` file that is not one of our budgeted modules. The service worker still caches `.wasm` files on first use instead of precaching them, because our own modules are loaded the same way. `script-src` keeps `'wasm-unsafe-eval'`, which our own modules need ([SECURITY.md](../SECURITY.md)).

## Evidence

Measured on 2026-10-05 in WebAssembly with `pnpm run bench:scanner --corpus hard --by-category`: 480 synthetic frames with a code, 60 per subset ("ours" is the multi-pass decode, "zxing" is zxing-wasm on the whole frame).

| Subset        | Ours | zxing | Ours p95 ms | zxing p95 ms |
| ------------- | ---- | ----- | ----------- | ------------ |
| clean         | 60   | 60    | 11.4        | 12.8         |
| small_modules | 58   | 59    | 12.1        | 10.6         |
| noise         | 60   | 60    | 14.4        | 17.7         |
| blur          | 37   | 38    | 15.9        | 11.3         |
| perspective   | 60   | 60    | 11.2        | 9.2          |
| low_contrast  | 60   | 60    | 12.7        | 14.8         |
| inverted      | 60   | 60    | 12.2        | 11.9         |
| combined_hard | 26   | 24    | 37.0        | 19.4         |

Totals: the multi-pass decode read 421 of 480, the same as zxing-wasm on the whole frame (421 of 480). The camera rotation (one pass per frame, at most 4 frames) read 413 of 480, against 421 for zxing's camera rotation. The benchmark no longer runs zxing-wasm, so this table is the last comparison; the hard corpus stays for measuring our reader.

## Consequences

- About 403 KiB gzipped less to download for anyone who scans without a platform detector, and one third-party binary fewer to audit.
- Frames with no code cost more in the full multi-pass decode (p50 about 27 ms, against about 18 ms for zxing). The live camera path runs one pass per frame and stays at about 18 ms p95, the same as zxing.
- The camera rotation reads 8 fewer of the 480 hard frames within 4 frames than zxing did; a code still in view is read on a later frame.
- The decoder is ours to fix: misses on the hard corpus are bugs in `crates/qr-decode`, measured with `pnpm run bench:scanner --corpus hard`.
- Before merge, the scanner is checked on this change's preview on iOS Safari and a mid-range Android phone (see [the device checklist](../TRANSFER_DEVICE_CHECKLIST.md)).
