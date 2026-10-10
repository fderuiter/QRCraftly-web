---
status: accepted
superseded_in_part_by: 0036
---

# Consolidated Optical Detection Engine

## Context

Optical barcode scanning from real-time webcam streams, uploaded image files, and video recordings previously suffered from architectural fragmentation and shallowness. The scanning pipeline was split across `src/hooks/useAdaptiveScanner.ts` (since deleted), `src/utils/FrameProvider.ts` (since deleted), `src/utils/AdaptiveFrameScheduler.ts` (since deleted), and `src/utils/scannerWorker.ts` (since deleted).

This fragmentation caused several acute maintenance and reliability challenges:

1. **Plumbing Duplication**: `CameraFrameProvider` in `FrameProvider.ts` duplicated over 250 lines of camera frame acquisition, dimension scaling, worker `postMessage` transfers, and watchdog recovery already implemented in `useAdaptiveScanner.ts`. It was unused by any UI component and only tested in isolation.
2. **Leaky Machinery & Dual Abstractions**: [`src/components/QRScanner.tsx`](../../src/components/QRScanner.tsx) was forced to straddle two disparate abstractions: `useAdaptiveScanner` for webcam video streams and `FileFrameProvider` for file drag-and-drop. Internal machinery—such as `DoubleBufferPool`, raw worker message payloads, and watchdog recreation loops—was exposed across consumer boundaries.
3. **Worker Recovery Hot Spots**: Fixes for worker stalls, starvation watchdogs (1500ms timeout), and message error boundaries had to be applied redundantly across multiple files, increasing the risk of behavioral divergence.
4. **Code Duplication Limits**: The duplicated frame-sampling and video-stepping loops threatened the repository clone threshold ceiling of 3.0% (`.jscpd.json`).

## Decision

We consolidate the entire optical detection pipeline into a unified deep module under [`src/packages/optical-scanner/`](../../src/packages/optical-scanner/).

### 1. Unified Entry-Point Seams

The package exposes minimal, orthogonal public seams:

- **`index.ts` (Headless Entry Point)**: Exposes polymorphic `scan(source, options)` supporting `ImageData`, `HTMLCanvasElement`, `ImageBitmap`, and `File`/`Blob` (image files only since issue #1098), alongside public type definitions and runtime validation contracts.
- **`index.ts` also exposes the Camera Scanner Engine** (`createCameraScannerEngine`): the headless owner of the camera frame loop, adaptive sampling, backpressure, downscaling, worker epochs, the hang watchdog, worker restarts and main-thread fallback (see sections 4 and 5).
- **`client.ts` (React Hook Seam)**: Exposes `useQrScanner`, a thin React adapter over the Camera Scanner Engine that creates it lazily, keeps its sampling bounds in sync, batches its events into React state, destroys it on unmount, and provides a unified `scanFile(file)` method. It does not expose the worker.
- **`worker.ts` (Web Worker Seam)**: The dedicated off-thread Web Worker entry point: pure JavaScript jsQR decoding of camera frames and of image files, which it decodes itself with `createImageBitmap` (EXIF orientation applied). The WebCodecs demuxer and EBML parser it once held were removed with video-file scanning (issue #1098).

### 2. Private Internal Subsystem (`lib/`)

All complex internal mechanics are strictly hidden inside `lib/` and are inaccessible to outside callers:

- **`lib/sourceExtractor.ts`**: Unified extraction pipeline for all `ScanSource` types. An image file is sent to the worker (`lib/imageFile.ts`: native size capped at 2048px, then 1024px) and decoded on the main thread only when the worker cannot. Video files are refused. (Native video frame stepping, the stub WASM demuxer, the global file lock and the unused `scanner-telemetry-dispatch` events were removed in issue #1098.)
- **`lib/scheduler.ts`**: `AdaptiveFrameScheduler` managing in-flight frame tracking, round-trip execution latency histories, dynamic sleep interval pacing, and immediate 1500ms starvation watchdog triggers.
- **`lib/bufferPool.ts`**: `DoubleBufferPool` managing transferable zero-copy `ArrayBuffer` instances to prevent runtime garbage collection pauses.
- **`lib/cameraEngine.ts`**: The Camera Scanner Engine (section 4).
- **`lib/clock.ts`**: Injectable `ScannerClock` used by the engine and the scheduler.
- **`lib/workerRunner.ts`**: Lazy singleton worker instantiation (private to the package), the default engine worker factory, listener boundary management, watchdog recovery for file scans, and thread teardown.
- **`lib/contracts.ts`**: Strict TypeScript runtime validation contracts, type assertion guards, and dimension downscaling math.

### 3. Deletion of Dead Machinery & Legacy Shims

- Deleted `src/utils/scannerWorker.ts` in favor of `src/packages/optical-scanner/worker.ts`.
- Converted legacy utility files (`useAdaptiveScanner.ts`, `AdaptiveFrameScheduler.ts`, `scannerContract.ts`) into minimal, single-line backwards-compatibility re-export shims. The `sharedScannerWorker.ts` shim (`terminateSharedScannerWorker` alias) was later deleted; the canonical `terminateScannerWorker` is imported from `scheduler.ts`. The `useAdaptiveScanner` alias shim was also deleted (issue #982): callers import `useQrScanner` from `@/packages/optical-scanner/client`.

### 4. Camera Scanner Engine and Sealed Worker Seam (amendment, issue #920)

The camera hook originally mixed worker lifecycle, watchdog recovery, adaptive scheduling, canvas fallback and render batching (`useWorkerRecovery`, `useVideoBinding`, `useBatchScannerState`) and leaked `workerRef` through its public result. These are now consolidated into one headless engine:

- **Interface**: `createCameraScannerEngine({ getSource, minSamplingDelay, maxSamplingDelay })` returns `start`, `stop`, `destroy`, `setOptions`, `getMetrics` and `subscribe(events)` with typed `onScanSuccess`, `onScanFail`, `onStatusChange` (`idle | checking | pass | fail`) and `onMetricsChange` (`samplingDelay`, `latencyHistory`) listeners.
- **Sealed worker**: the worker handle, epoch counter, message listeners and termination are private to the engine. Messages from a replaced worker generation or an earlier session are discarded by epoch.
- **Recovery policy** (superseded by section 5): a frame in flight longer than the watchdog budget (1500ms) or a worker `error`/`messageerror` recreated the worker with a doubled budget (3000ms, then capped at 6000ms). Any valid, non-stale worker answer reset the counter and budget. After three consecutive restarts fail, or when the worker factory throws, the engine decodes on the main thread (frames capped at 800px) without changing its interface.
- **Dependency injection instead of test hooks**: the worker factory (`ScannerWorkerFactory`), clock (`ScannerClock`), frame grabber and main-thread decoder are injectable. The package no longer attaches `terminateSharedScannerWorker`/`resetSharedScannerWorker` to `globalThis`, and the camera path no longer switches to synchronous state updates under test.
- **Tests**: [`src/packages/optical-scanner/tests/cameraScannerEngine.test.ts`](../../src/packages/optical-scanner/tests/cameraScannerEngine.test.ts) drives the engine headlessly (node environment, fake frame source, fake workers, fake clock). [`src/packages/optical-scanner/tests/useQrScanner.test.tsx`](../../src/packages/optical-scanner/tests/useQrScanner.test.tsx) is a small adapter smoke test.
- **Duplicated frame provider**: the standalone `FrameProvider.ts` camera loop was already deleted (section 3); the engine is now the only camera frame loop.

### 5. Per-Session Staleness, Bounded Decodes and Hang-Only Watchdog (amendment, issues #1095 and #1096)

Measured with the scanner test harness (#1103), the engine got slower exactly when scanning was hardest:

- **Staleness is per scan session.** The shared worker kept one module-wide `latestSequenceId`, while every session numbers its frames from 1, so a scanner reopened after a long session had its frames answered `STALE_FRAME` for seconds. Epochs are now unique across the page (one counter for every engine and worker generation), and the worker judges staleness per `(epochId, sequenceId)` (`lib/frameGuard.ts`). Within a session, older frames are still rejected.
- **One bounded jsQR pass per camera frame.** `decodeCameraFrame` (`lib/decodeSync.ts`) runs a single pass and consecutive frames rotate strategies: the native-resolution centre square, the whole frame downscaled to 800px, and an inverted pass (jsQR 1.4's `onlyInvert` is broken, so the pixels are inverted first). Frames whose sensor noise exceeds a threshold are box-downscaled before the pass, because jsQR spends seconds on grainy frames. The multi-pass `decodeRgbaFrame` remains for one-shot image files. `pnpm run bench:scanner` measures both over the corpus.

  > **Amendment (#1178):** the pass is now one call to QRCraftly's own decoder (`src/packages/qr-decode`, [ADR 0033](./0033-rust-webassembly-modules.md)), which replaced jsQR everywhere. The rotation and the noise downscale stay; the multi-pass image decode (`decodeRgbaCode`) is one call with every pass of that decoder.

- **Pacing converges.** The sampling delay targets 1.2x the 5-frame median latency, closing half the gap per frame when rising and dropping to the target at once when decodes speed up. The old rule added 50ms on every slow frame and reached the 1000ms maximum (about 1 fps).
- **The watchdog catches hangs only.** One 5000ms budget, measured from the worker's last answer, replaces the 1500ms / 3000ms / 6000ms backoff. A slow but answering worker is never restarted; after three consecutive hangs or crashes the engine still falls back to the main thread, where it runs the same one-pass rotation.

### 6. One Owner for the Camera: the Camera Session (amendment, issue #1097)

The camera stream used to be acquired by the app's `useCamera` hook and attached, played and torn down separately by each caller (the scanner component and the file-transfer receiver), with the engine started and stopped beside it. Under StrictMode or a quick remount these steps interleaved: the viewfinder could stay black, or a camera could keep running after the scanner closed.

- **`lib/cameraSession.ts`** owns the whole lifecycle: `getUserMedia`, attaching the stream to the video element, `play()`, starting the engine, and on `stop()` stopping every track, detaching the element and stopping the engine. `start()` while requesting or streaming does nothing, and a request superseded by `stop()` or a newer `start()` stops its tracks as soon as the browser answers. The session releases the camera while the tab is hidden and reacquires it when the tab is shown.
- **`useQrScanner`** returns `state` (`idle | requesting | streaming | denied | unavailable | error`, the last three with the error), `start(options?)`, `stop()` and `videoRef`. `startScanning` / `stopScanning` remain for a source the caller attaches itself (the receiver's recorded video file).
- **`src/hooks/useCamera.ts` is deleted.** `QRScanner` and `useOpticalReceiver` use the session; the receiver no longer takes an injected `camera` and exposes `cameraError` instead.
- **Tests**: `tests/cameraSession.test.ts` covers idempotency, superseded requests, error mapping and visibility; the component test checks one live track under StrictMode and none after unmount or 20 quick remounts; `e2e/scanner.spec.ts` checks the denied fallback and that hiding the tab releases the camera in every browser.

### 7. Decoder Chain and Result Confirmation (amendment, issues #1099 and #1104)

- **Three decoders, best first** ([ADR 0023](./0023-zxing-wasm-scanner-decoder.md)): the platform `BarcodeDetector` when it reads QR codes (`lib/nativeDetector.ts`; camera frames then never reach the worker), zxing-wasm in the worker (`lib/zxingReader.ts`, compiled on the main thread by `lib/zxingModule.ts` and exposed to the worker through the `reader` entry point), and jsQR as the fallback. _Superseded in part by [ADR 0036](./0036-in-house-qr-decoder-replaces-zxing-wasm.md): two decoders now, the platform detector and then our reader (`qr-decode`); the zxing files and the `reader` entry point are gone._
- **Region of interest.** Odd frames send the centre square at native resolution (up to 1280px) with `createImageBitmap(video, sx, sy, sw, sh)`; even frames send the whole frame downscaled to 1280px. The worker maps corners back to frame coordinates.
- **Confirmation** (`lib/resultGate.ts`): two agreeing decodes within 500 ms or with at most three misses between them (one rotation of the decode strategies, so slow devices still confirm, #1292), one for the platform detector, and a 3 s hold before the same payload is emitted again. `useOpticalReceiver` passes `confirmations: 1, repeatHoldMs: 0`.
- **Rich results.** `ScanResult` and the camera callback carry `bytes`, `corners` and `source`; the worker response adds `decodedBytes`, `corners` and `decoder`.
- **Tests**: [`src/packages/optical-scanner/tests/decoderChain.test.ts`](../../src/packages/optical-scanner/tests/decoderChain.test.ts) runs the real zxing reader in Node over the corpus, the gate and the native path. _Since [ADR 0036](./0036-in-house-qr-decoder-replaces-zxing-wasm.md) it runs our reader instead._

### 8. Camera Controls (amendment, issue #1100)

- **Constraints.** The session asks for 1080p at 30 fps, steps down to 720p and then no size on `OverconstrainedError`, and applies continuous focus when the camera supports it (`cameraConstraints`).
- **States.** `busy` (another app holds the camera) and `unsupported` (no mode fits) join `denied`, `unavailable` and `error`; `streaming` carries `camera` (device, facing, torch, zoom).
- **Controls.** `listCameras`, `switchCamera`, `setTorch` and `setZoom`, surfaced by `ScannerCameraControls` under the viewfinder, each only when supported. The chosen camera is remembered in memory for the page only, never in storage. The preview is mirrored only for a front camera.

## Rationale

- **Deep Module Principle**: Encapsulating high internal complexity (Web Workers, transferable buffers, canvas contexts, adaptive frame pacing, and image decoding) behind narrow public entry points (`scan`, `useQrScanner`) simplifies callers and eliminates abstraction leaks.
- **Single Test Surface**: Consolidating file and camera decoding into one module provides a unified test surface ([`tests/opticalScannerIntegration.test.tsx`](../../tests/opticalScannerIntegration.test.tsx) and [`src/packages/optical-scanner/tests/opticalScanner.test.tsx`](../../src/packages/optical-scanner/tests/opticalScanner.test.tsx)).
- **Duplication Reduction**: Deleting `FrameProvider.ts` dropped repository-wide code duplication to **2.40%**, well beneath the 3.00% invariant limit.

## Consequences

- [`src/components/QRScanner.tsx`](../../src/components/QRScanner.tsx) uses a single hook (`useQrScanner`) for both live camera feeds and file drag-and-drop (`scanFile`).
- Removing `workerRef` from `UseQrScannerResult` is a breaking change for direct readers of that property; no UI component read it.
- Zero dependency violations reported by `depcruise src` across all 388 modules.
- Complete backwards compatibility preserved for existing test harnesses and subpages via minimal re-export shims.
- All 193 test suites (1,910 tests) and Playwright E2E suites pass with zero regressions.
