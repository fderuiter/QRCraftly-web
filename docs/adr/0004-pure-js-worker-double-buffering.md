---
status: accepted
---

# Pure JavaScript Web Workers and Double-Buffered Memory Pooling

## Context

Evaluating QR scannability in real time requires continuous pixel extraction, contrast audits, and full decode passes. Executing this on the main UI thread causes frame drops and input lag, while compiling WebAssembly decoders introduces network bundle bloat and instantiation delay.

## Decision

We run scannability analysis off the main thread in dedicated Web Workers using a pure JavaScript engine (`jsQR`) combined with transferable, zero-copy `ArrayBuffer` instances.

> **Current state:** the scannability worker lives in `src/packages/scannability/worker.ts` (spawned by `src/packages/scannability/lib/workerFactory.ts`) and transfers each pixel buffer to the worker and back for reuse. The scanner worker `src/utils/scannerWorker.ts` was deleted ([ADR 0016](./0016-consolidated-optical-detection-engine.md)); camera and file decoding run in `src/packages/optical-scanner/worker.ts`, and only the optical scanner recycles frames through the pre-allocated `DoubleBufferPool` (`src/packages/optical-scanner/lib/bufferPool.ts`).

> **Amendment (#1104):** the optical scanner now decodes with the platform `BarcodeDetector`, then zxing-wasm in its worker, with jsQR as the fallback ([ADR 0023](./0023-zxing-wasm-scanner-decoder.md)). This ADR still governs the scannability worker. Superseded in part by [ADR 0036](./0036-in-house-qr-decoder-replaces-zxing-wasm.md): zxing-wasm is gone, and the scanner decodes with the platform detector, then our own reader.

> **Amendment (#1178):** jsQR is gone. Every decode that used it (the scannability worker and its main-thread fallback, the export checks, the transfer handshake gate and the optical scanner's fallback) now uses QRCraftly's own decoder, the Rust module `crates/qr-decode` compiled to `src/wasm/qr-decode.wasm` (about 24 KB gzipped, [ADR 0033](./0033-rust-webassembly-modules.md)) and loaded by `src/packages/qr-decode`. The module is fetched from the site's own origin on first use, never with the page, and each worker instantiates its own copy. It read at least as many codes as jsQR over the scanner corpus and every generator style, with a p95 of tens of milliseconds where jsQR took seconds on noisy frames. The worker, transferable buffers and main-thread fallback decided here are unchanged; the "no WebAssembly" part of this decision no longer holds, so the second consequence below is superseded.

## Rationale

Off-thread execution preserves a fluid 60 FPS main thread during rapid user input. Recycling pre-allocated memory buffers via transferable objects eliminates runtime garbage collection pauses without the cold-start overhead of WebAssembly.

## Consequences

- Responsive UI frame rendering during live customization on all supported hardware.
- Zero WebAssembly download or compilation requirement.
- Environments where Web Workers are blocked fall back to cooperative main-thread yielding (`requestIdleCallback`/`setTimeout`).
