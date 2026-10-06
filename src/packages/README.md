# Deep modules

This directory contains standalone deep modules adhering to strict structural encapsulation boundaries.

```text
src/packages/<name>/
  index.ts       # Primary root entry point (public interface)
  client.ts      # Optional secondary entry points (e.g. client.ts, maze.ts)
  lib/           # Private implementation (forbidden to external importers)
  tests/         # Co-located tests and fixtures (importing strictly through root entry points)
```

## The Four Boundary Rules

1. **Entry-point boundary from app**: App code outside a package may import only that package's root entry points (`src/packages/<pkg>/<entrypoint>.ts`), never anything inside its `lib/` or any other subfolder.
2. **Intra-package freedom**: Files within the same package import each other freely, but may reach other packages only through their root entry points, never their subfolder internals.
3. **Tests through entry points**: Test suites under `tests/` import strictly through root entry points (`../index` or `@/packages/<pkg>`), asserting against public interface behaviour. Tests may never reach into private subfolders (not even their own `lib/`).
4. **No circular dependencies**: Dependency cycles across modules and packages are forbidden.

## Barrels Discouraged

Packages may expose several small, purpose-built entry points (such as `index.ts`, `client.ts`, `worker.ts`) rather than funnelling everything through one giant barrel `index.ts`. Barrel files that blindly re-export an entire internal subtree are discouraged; keep entry points focused and hide implementation in subfolders.

## Automated Verification

Run boundary verification at any time:

```bash
pnpm run lint:boundaries
```

Boundary checks run automatically during `pnpm run lint` and CI.

## Registered Packages

### `scannability` (`@/packages/scannability`)

- **Purpose**: Zero-copy off-thread Web Worker scannability audits, contrast checks, and optical simulation.
- **Entry Points**:
  - `index.ts`: Public API: the headless Scannability Health Evaluator (`createScannabilityEvaluator`, one `ScannabilityAssessment` answer with status, health, export risk and recovery state), `createScannabilityWorker()`, worker contracts, the print simulation (`simulatePrint`, [ADR 0042](../../docs/adr/0042-print-simulation-in-module-units.md)) and contrast math.
  - `client.ts`: Thin React adapter hook (`useScannability`) over the evaluator. App capabilities (failure reporting, module count) are injected; the package never imports app layers.
  - `checker.ts`: The pure `performScannabilityCheck`/`evaluateScannability` runners. Callers pass in the QR reader from `qr-decode`. Pages load this entry and the reader with `import()` when they need them (exports, the evaluator's main-thread fallback), so the root entry stays free of both (#1041).
  - `worker.ts`: Dedicated background Web Worker performing real-time contrast auditing and optical decoding.

### `qr-matrix` (`@/packages/qr-matrix`)

- **Purpose**: Full QR code matrix visual orchestration, styles, locator eyes, logo cutouts, alignment pattern zones, and playable maze generation. Owns the one place a configuration becomes a module matrix (`buildMatrix`) and the Matrix and Maze Workers.
- **Entry Points**:
  - `index.ts`: `buildMatrix` (normalizes URL payloads, then encodes), `resolveEncodedValue`, `QrEncoder`, the encoder exports below, the worker factories `createMatrixWorker` and `createMazeWorker`, `drawQR`, `drawQRInternal`, `renderBorder`, `renderEyes`, `renderModules`, `renderFluidModules`, `renderLogo`, `renderMaze`, layout and logo math.
  - `encoder.ts`: The QR encoder on its own, for workers and scripts (#1177): `loadQrEncoder` (fetches and instantiates `src/wasm/qr-encode.wasm` once; under Node it reads the file), `createQrEncoder` (a synchronous encoder over an instance), `QrEncodeError` and the symbol, segment and option types. The encoder is our Rust module `crates/qr-encode`.
  - `mosaic.ts`: Mosaic QR engine ([ADR 0019](../../docs/adr/0019-mosaic-qr-module-level-image-tiling.md)): `planMosaic`, `renderMosaic`, `rasterizeMosaic`, `sampleMosaicGrid`, `resolveMosaicThresholds`, `isMosaicFunctionModule`, and the in-memory image cache (`loadMosaicSource`, `getMosaicSource`).
  - `maze.ts`: `generateMaze`, `getMazeCacheKey`, `getCachedMaze`, `storeMaze`, `clearMazeCache`, `getStyleAdaptiveMazePathWidth`, `renderMaze`, `MazeData`, bridge validation helpers (`isBridgeCell`, `isFinderPatternWithMargin`), and the Maze Worker contract (`isMazeWorkerRequest`, `assertMazeWorkerRequest`, `isMazeWorkerResponse`, `assertMazeWorkerResponse`). The halo mask (`applyMazeHaloMask`) is private to `lib/maze.ts`.
  - `canvas.ts`: Canvas drawing primitives (`clampCornerRadius`, `drawRoundRect`, `drawPoly`, `drawStar`, `drawRoughRect`, `drawScribble`, and the module shape painters).
  - `worker-matrix.ts`: Background Web Worker that validates a configuration and serializes its `buildMatrix` output. Spawn it only through `createMatrixWorker()`.
  - `worker-maze.ts`: Background Web Worker running maze generation and A* pathfinding. Spawn it only through `createMazeWorker()`.

### `qr-export` (`@/packages/qr-export`)

- **Purpose**: Social template composition and self-contained SVG export: a `CanvasRenderingContext2D`-compatible SVG recorder, template frames and text, logo inlining, SVG sanitization and the offscreen scannability check before download.
- **Entry Points**:
  - `index.ts`: `generateQRSvg`, `rasterizeSvgToCanvas`, `validateSvgScannability`, `SvgContext`, `drawWithTemplate`, `SOCIAL_DIMENSIONS`.

### `arcade` (`@/packages/arcade`)

- **Purpose**: Headless game logic behind the QR Arcade (`/arcade`): target matrices, the Damage Simulator (blasts, barrages and Reed-Solomon damage analytics), the Arcade Blaster (micro-cell damage grid, projectile and particle physics), and the empirical scan pipeline that checks whether the damaged code still decodes.
- **Entry Points**:
  - `index.ts`: `buildTargetMatrix`, `analyzeDamage`, `applyBlast`, `planBarrage`, `MicroGrid`, the physics helpers, mode definitions (`ARCADE_MODES`, `parseArcadeMode`, `arcadeModeHref`) and `EmpiricalScanPipeline`.
  - `client.ts`: React hooks (`useEmpiricalScan`, `useMediaQuery`, `useReducedMotion`, `useLatestRef`).
  - `handoff.ts`: In-memory hand-off of a design from the generator to the arcade (`stageArcadeTarget`, `getStagedArcadeTarget`, `clearStagedArcadeTarget`).

### `optical-scanner` (`@/packages/optical-scanner`)

- **Purpose**: Consolidated off-thread barcode decoding for live camera streams and image files (photos and screenshots) with adaptive backpressure throttling and watchdog fault recovery.
- **Entry Points**:
  - `index.ts`: Public API, polymorphic `scan(source, options)` for files/images, the headless Camera Scanner Engine (`createCameraScannerEngine`), scanner contracts, and downscaling math.
  - `client.ts`: Thin React adapter hook (`useQrScanner`) over the Camera Session (`state`, `start`, `stop`, `videoRef`: the one owner of the camera stream) and the Camera Scanner Engine, plus file drag-and-drop scanning.
  - `scheduler.ts`: Secondary entry point exposing `AdaptiveFrameScheduler`, `DoubleBufferPool`, and `terminateScannerWorker` (shared file-scan worker teardown). Worker spawning is private to the package.
  - `worker.ts`: Dedicated background Web Worker that decodes camera frames (one bounded pass of the `qr-decode` reader each, ADR 0036) and image files (`createImageBitmap` with EXIF orientation, then decoded at 2048 px and 1024 px).

### `qr-payload` (`@/packages/qr-payload`)

- **Purpose**: Consolidated QR payload generation, hydration parsing, RFC 5545/6350 escaping, protocol identification, and security containment validation behind a stateless format/parse/validate seam.
- **Entry Points**:
  - `index.ts`: Polymorphic `formatPayload`, `parsePayload`, `validatePayload`, config validators `validateConfig` and `sanitizeConfig`, protocol parser `identifyProtocol`, `canHydrate`, RFC escaping helpers, and typed generator contracts (`WifiContract`, `EmailContract`, `VCardContract`, etc.).

### `optical-transfer` (`@/packages/optical-transfer`)

- **Purpose**: Air-gapped, one-way optical data transmission via animated QR code streams. Uses a pure TypeScript rateless fountain codec (Luby Transform over $\text{GF}(2)$ with peeling plus Gaussian-elimination fallback) framed as Prism frames (Base45 text, a CBOR manifest with the SHA-256 and a CRC-32C per frame), real BC-UR (BCR-2024-001) sending and receiving for wallets ([ADR 0041](../../docs/adr/0041-wallet-compatible-bc-ur-sending.md)), `deflate-raw` pre-compression, recycled preallocated frame pools, and dedicated Web Workers. See [ADR 0014](../../docs/adr/0014-rateless-fountain-codes-for-airgapped-optical-transfer.md) and [ADR 0024](../../docs/adr/0024-prism-frame-format.md).
- **Entry Points**:
  - `index.ts`: Primary public API: the handshake scannability gate (`verifyHandshakeFrame` with injectable worker/checker factories), `PreallocatedFramePool`, `StreamLookaheadReceiver`, fountain codec primitives (`FountainEncoder`, `FountainDecoder`, `solveGF2`, Robust Soliton helpers), CBOR (`cborEncode`/`cborDecode`), Bytewords, `crc32`, session helpers (`compressForTransfer`, `decompressTransferPayload`, density profiles), `FountainReassembler`, `FountainRateTracker`, and contracts.
  - Multi-code transfer (#1142), also exported from `index.ts` and off until a caller passes `enabled: true` to `planMultiCode`: layouts picked from the sender screen (`selectLayout`, `TILE_LAYOUTS`), staggered tile refresh (`tilesChangingAt`, `tileSlot`), vsync pacing (`createVsyncPacer`, `holdForTargetFps`), tile tracking and dedup (`TileTracker`, `createSymbolDedup`) and the decoder pool (`decoderPoolSize`, `createDecoderPool`). The file-transfer pages use them behind two preview switches under Advanced ([ADR 0039](../../docs/adr/0039-multi-code-frames-behind-preview-switches.md)): the sender paints the tiles and paces them to the display, and the receiver reads the camera with `createTileReader` (a full search, then each tile from its corners through `TileReadSession`) instead of the scanner's one-code loop. What the bench shows and what needs a phone is in the [benchmark report](../../docs/TRANSFER_BENCHMARK.md).
  - Multi-rate stream (#1143, [ADR 0031](../../docs/adr/0031-multi-rate-stream-and-speed-profiles.md)), also exported from `index.ts`: the Steady, Balanced and Fast profiles (`MULTI_RATE_PROFILES`), `isBeaconFrame`, `frameLayer` (tells a beacon by `FLAG_BEACON`) and the receiver's layer hint (`layerHint`). With the multi-code preview on, the sender picks the profile for the chosen density and `worker-slice.ts` slots a beacon in after every few dense frames; the receiver shows the layer hint. `createMultiRateSender` is the same stream for the bench and simulator.
  - Webcam back channel (#1146, [ADR 0032](../../docs/adr/0032-webcam-back-channel.md)), also exported from `index.ts`: the feedback frame (`encodeFeedbackFrame`), the speed controller (`createSpeedController`, `switchableProfile`), the opt-in state machine (`createFeedbackLink`) and the receiver's measure (`createFeedbackMeter`). Behind two more preview switches, the sender reads the receivers' corner codes through its webcam and switches profile with the slice worker's `SWITCH` (new streams of the same session from `PrismSession.restream`), and the receiver shows its feedback code.
  - Colour layer (#1147), also exported from `index.ts`, off and called by nothing in the app: three Prism frames per tile, one per colour channel (`composeColourTile`), black and white beacons with a calibration patch (`composeBeacon`, `samplePatch`), the cross-talk fit (`fitCrossTalk`, `ColourCalibrator`: closed-form least squares from the eight corners of the colour cube, only `+ - * /`), the channel split (`splitChannels`), both computed by the optical modem's Rust module (#1198; `await loadCrossTalkKernels()` first) and the receiver that decodes each plane on the tracked tile crops and falls back to the beacons when colour does not read (`ColourReceiver`). The Colour profile (`COLOUR_PROFILE`) is Fast with three channels and is not offered; `createColourSender` returns null unless `enabled: true`. The package carries no QR reader: the receiver is handed `decodePlane` and `decodeImage`. The benchmark section is in the [benchmark report](../../docs/TRANSFER_BENCHMARK.md).
  - `client.ts`: Headless React hooks. `useOpticalSender` broadcasts fountain droplets by default, with no handshake frame and every QR at version 7 or lower; the caller injects `renderFrame` and the scannability fallback flag. `useOpticalReceiver` provides stateless entry and exposes `fountainStats` telemetry (droplets vs K, rank, FPS, ETA); the caller injects `saveFile`; the camera comes from `useQrScanner`'s Camera Session and its error is exposed as `cameraError`. Also exports UI state types.
  - `bcur.ts`: The real BC-UR codec on its own (`BcUrEncoder`, `BcUrDecoder`, `isBcUr`), kept apart from the package index.
  - `checksum.ts`: `crc32` alone, for callers such as the Bulk CSV zip writer that must not pull in the handshake gate and its scannability check.
  - `worker-slice.ts`: Background Web Worker: hashing, `deflate-raw` compression (skipped when it saves less than 5%), density-bounded symbol sizing, and QR matrix generation for Prism frames.
  - `lib/fec/codec.ts`: Prism's outer code ([#1176](https://github.com/fderuiter/QRCraftly-web/issues/1176), [ADR 0037](../../docs/adr/0037-prism-outer-code-lt-over-ldpc-precode.md)), the Rust module `crates/prism-fec` in `src/wasm/prism-fec.wasm`: `FecEncoder` and `FecDecoder` (the shape of the fountain classes, over blocks of up to 8192 symbols from `planBlocks`), `FecBlockEncoder` and `FecBlockDecoder` (one block, one module instance), `isValidFecLayout` and `loadFecModule`. Needs K + 1 symbols per block in the median. Prism sends with it when the sender opts in under Advanced: manifest version 2, `FLAG_OUTER_CODE` and at most `MAX_FEC_BLOCKS` blocks (#1141, [ADR 0038](../../docs/adr/0038-prism-manifest-v2-outer-code-opt-in.md)); `PrismReceiver.provideFecModule` hands the receiver its module.
  - `worker-tiles.ts`: Background Web Worker, one per slot of the multi-code receiver's decoder pool: reads a camera frame as a full multi-code search, or each tracked tile from its corners (`readTracked`).
  - `worker-reassembly.ts`: Background Web Worker: fountain reassembly (peeling + GF(2) elimination), manifest checks, decompression and SHA-256 verification.

### `bulk-csv` (`@/packages/bulk-csv`)

- **Purpose**: Dependency-free building blocks for the Bulk CSV Batch generator (`/bulk-csv-qr-code`). Everything runs in memory with no network access; the app loads this package only in the code-split Bulk CSV chunk.
- **Entry Points**:
  - `index.ts`: RFC 4180 CSV parser with a header row (`parseCsv`, `CsvParseError`, `MAX_BULK_CSV_ROWS`, `MAX_BULK_CSV_CHARS`: quoted fields, `""` escapes, CRLF/LF/CR, embedded line breaks, BOM stripping, bounded row count), a minimal ZIP writer (`createZip`: stored entries, CRC-32 from `@/packages/optical-transfer`, central directory, UTF-8 names via general purpose bit 11) and file name helpers (`sanitizeFileStem`, `allocateFileName`).

### `link-safety` (`@/packages/link-safety`)

- **Purpose**: Offline, synchronous reading of a web address for the signs people use to disguise where a link goes (#1156). It makes no request and never says a site is safe: it reports findings, each `info` or `caution`, and an ordinary address has none.
- **Entry Points**:
  - `index.ts`: `analyseLink(url)` returning `LinkFinding[]` (cautions first) with `LinkFindingCode`, `LinkFindingSeverity`. Findings: credentials before an `@`, an IP host in any notation, a non-default port, a shortener or redirector, mixed alphabets, a lookalike of about a hundred brands (UTS #39 confusables for Latin, Cyrillic, Greek and Armenian plus digit swaps), a brand named in a subdomain or sign-in path of another registrable domain, four or more subdomain levels, and `http`. Used by the scanner and checker result sheet and the generator's link hints. See the package [README](./link-safety/README.md).

### `optical-modem` (`@/packages/optical-modem`)

- **Purpose**: QRCraftly Optical (#1161), the colour modem that follows animated QR codes. Experimental and off by default: nothing in the shipped app calls it unless the build sets `VITE_OPTICAL_MODEM=true`. It holds the modem frame (corner fiducials, a calibration strip, a Reed-Solomon protected header, a colour grid), a deterministic phone-camera channel simulator, and the capacity probe analysis ([ADR 0027](../../docs/adr/0027-optical-channel-probe.md)). Arithmetic that decides what a receiver reads uses only `+ - * /` on integers or 32-bit floats, so every JavaScript engine gives the same bits.
- **Kernels in Rust**: everything the modem computes per frame (the Reed-Solomon code, the frame codec, the fiducial search, the cell sampling, the constellations, the probe analysis) is the Rust module `crates/modem` in `src/wasm/modem.wasm` ([#1198](https://github.com/fderuiter/QRCraftly-web/issues/1198)), driven by `lib/kernels.ts`. TypeScript keeps the shell: drawing frames, the simulator, the GPU kernel, the camera and the ladder. Call `await loadOpticalModem()` once before encoding, decoding or analysing; under Node it reads the file.
- **Determinism rules**: only `+ - * /` on integers or 32-bit floats in anything a receiver decides with, in the order the module uses; never `Math.sin`, `Math.pow`, `Math.cbrt` or similar. Rounding steps (sums, means, distances, confidences) are integers. The GPU kernel is a port of the reference kernel and has to agree with it byte for byte; the receiver proves that on the device before trusting it, and `pnpm run bench:optical-gpu` proves it in a browser ([ADR 0029](../../docs/adr/0029-optical-gpu-decode-kernel.md)).
- **Entry Points**:
  - `index.ts`: constellations (`getConstellation`, `constellationId`), the probe sequence and its frames (`probeSequence`, `probeGeometries`, `drawProbeFrame`), the probe receiver analysis (`ProbeRun`, `formatProbeReport`) and the simulator (`simulateCapture`) and the reference codec (`encodeModemFrame`, `decodeModemFrame`, `frameCapacity`, `MODEM_PROFILES`; [ADR 0028](../../docs/adr/0028-optical-modem-frame-format.md)), the reference decode kernel and its shader source (`runReferenceKernel`, `compareGrids`, `FRAGMENT_SHADER`) and the camera frame source (`watchFrames`, `FrameRateMeter`, `grantedSettings`), and the profile ladder (`LADDER`, `ladderSchedule`, `lockedSchedule`, `LinkTracker`, `linkLabel`; [ADR 0030](../../docs/adr/0030-optical-profile-ladder.md)).
  - `crosstalk.ts`: the colour cross-talk kernels of the QR colour layer (`loadCrossTalkKernels`, `fitCrossTalkKernel`, `rescaleCrossTalkKernel`, `splitCrossTalkKernel`), which `@/packages/optical-transfer` wraps. Separate so the transfer does not pull in the modem's shell.
  - `gpu.ts`: the WebGL 2 decode kernel (`createGpuKernel`, `createVerifiedGpuKernel`, `selfTestGpuKernel`, `GPU_FALLBACK_MESSAGES`). Separate so that importing the root never pulls the GL code in.
  - `flag.ts`: `isOpticalModemEnabled()`, the build flag. Kept tiny on purpose: pages import it statically and it must not pull the modem into a first load.

### `qr-decode` (`@/packages/qr-decode`)

- **Purpose**: Our QR decoder ([#1178](https://github.com/fderuiter/QRCraftly-web/issues/1178)), the Rust module `crates/qr-decode` compiled to `src/wasm/qr-decode.wasm`. It reads RGBA or grey frames, up to eight codes at a time, light-on-dark and mirrored codes included, and turns each code's segments into text by mode and ECI. It replaced jsQR everywhere: the scanner's fallback, the scannability check and the transfer handshake. `readTracked` is the Prism fast path: it reads up to eight tiles whose corners, version and level are already known, sampling their grids without a search, from one copy of the frame.
- **Entry Points**:
  - `index.ts`: `loadQrReader` (fetches and instantiates the module once; under Node it reads the file), `createQrReader` (a synchronous reader over an instance, with `read` and `readTracked`) and the `QrReader`, `QrRead`, `QrReadOptions`, `QrTile`, `QrReadSegment`, `QrReadMode`, `QrReadLevel` and `QrPoint` types.

### `wasm-runtime` (`@/packages/wasm-runtime`)

- **Purpose**: Loads QRCraftly's own Rust WebAssembly modules ([ADR 0033](../../docs/adr/0033-rust-webassembly-modules.md), [RUST.md](../../docs/RUST.md)): same-origin compile with a per-URL cache, import-free instantiation, and typed helpers for copying bytes in and out, freeing on every path and turning traps and status codes into a `WasmModuleError`.
- **Entry Points**:
  - `index.ts`: `compileWasmUrl`, `compileWasmBytes`, `instantiateWasm`, `WasmInstance`, `WasmModuleError`, `checkStatus`, `resolveSameOrigin`, `ABI_VERSION`, `WASM_STATUS`.
