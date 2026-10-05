---
status: superseded
superseded_by: 0036
---

# zxing-wasm Decoder Chain for the Optical Scanner

> Superseded by [ADR 0036](./0036-in-house-qr-decoder-replaces-zxing-wasm.md): our own decoder (`qr-decode`, #1178) reached parity with zxing-wasm on the hard corpus and replaced it. The chain is now the platform `BarcodeDetector`, then our reader. This record is kept for history.

## Context

[ADR 0004](./0004-pure-js-worker-double-buffering.md) chose pure JavaScript (`jsQR`) for all QR decoding, to avoid WebAssembly download and start-up cost. The scanner redesign (#1094) measured what that costs the camera scanner. Over the scanner corpus (`pnpm run bench:scanner`), jsQR needs a strategy rotation across frames to read small modules in HD frames and still takes about 44 ms at p95 per frame. jsQR also has no multi-frame confirmation and returns text only, so binary payloads and exact bytes are lost.

Browsers now ship a platform `BarcodeDetector` on Android, ChromeOS and macOS, and zxing-cpp is available as a maintained WebAssembly build (`zxing-wasm`, Apache-2.0) with try-harder, inversion, rotation and downscale passes. In the benchmark it read 30 of 31 corpus frames at about 16 ms p95.

## Decision

The optical scanner (`src/packages/optical-scanner`) decodes with a chain, best first (#1099, #1104):

1. **The platform `BarcodeDetector`**, when `getSupportedFormats()` lists `qr_code`. Frames then never go to the worker. Its results are trusted on one frame.
2. **zxing-wasm in the scanner worker.** The main thread compiles `zxing_reader.wasm` from the site's own origin, only when the worker is first needed, and posts the `WebAssembly.Module` to the worker, which instantiates it through `instantiateWasm`. A build plugin (`scripts/vite/zxingNoNetwork.ts`) strips the glue's own `fetch`, synchronous `XMLHttpRequest` and jsDelivr default, so the reader can never load anything from a third party.
3. **jsQR**, the fallback when WebAssembly is unavailable or fails to load, and for the main-thread fallback.

Camera results from zxing or jsQR are accepted only when two decodes within 500 ms agree, and a payload is not emitted again for 3 s (`lib/resultGate.ts`). The file-transfer receiver turns both off because it reads a stream of distinct frames. Results carry the payload's bytes (when the decoder reports them), its corners and which decoder read it.

ADR 0004 still governs the scannability worker in `src/packages/scannability`, which keeps jsQR.

## Consequences

- `script-src` adds `'wasm-unsafe-eval'`. It allows WebAssembly compilation only, never JavaScript `eval` ([SECURITY.md](../SECURITY.md)).
- The reader is about 400 KB gzipped. It is loaded only when someone scans with no platform detector, so the service worker caches it on first use instead of precaching it, and `scripts/check-bundle-size.js` gives it its own budget outside the site total.
- The reader's JavaScript glue adds about 15 KB gzipped to the scanner worker, so the site budget rises by 25 KB (to 760 KB, after the acknowledgements page took it to 735 KB).
- `scripts/bundle_ast_audit.js` authorizes the one same-origin `fetch` of the reader by its warning text; no other network call is allowed.
- A zxing-wasm upgrade that changes the glue fails the build until the no-network rewrite is reviewed (`tests/zxing_no_network.test.ts`).
- Browsers without WebAssembly, or a stricter CSP, keep working with jsQR.
