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
  - `index.ts`: Public API: the headless Scannability Health Evaluator (`createScannabilityEvaluator`, one `ScannabilityAssessment` answer with status, health, export risk and recovery state), `createScannabilityWorker()`, worker contracts, and optical blur/contrast math.
  - `client.ts`: Thin React adapter hook (`useScannability`) over the evaluator. App capabilities (failure reporting, module count) are injected; the package never imports app layers.
  - `checker.ts`: The pure `performScannabilityCheck`/`evaluateScannability` runners. They bundle the jsQR decoder, so pages load this entry with `import()` when they need it (exports, the evaluator's main-thread fallback) and the root entry stays free of it (#1041).
  - `worker.ts`: Dedicated background Web Worker performing real-time contrast auditing and optical decoding.

### `qr-matrix` (`@/packages/qr-matrix`)

- **Purpose**: Full QR code matrix visual orchestration, styles, locator eyes, logo cutouts, alignment pattern zones, and playable maze generation. Owns the one place a configuration becomes a module matrix (`buildMatrix`) and the Matrix and Maze Workers.
- **Entry Points**:
  - `index.ts`: `buildMatrix` (normalizes URL payloads, then encodes), `resolveEncodedValue`, `loadQrEncoder` (lazy `qrcode`), `fromQrcodePackage`, `QrEncoder`, the worker factories `createMatrixWorker` and `createMazeWorker`, `drawQR`, `drawQRInternal`, `renderBorder`, `renderEyes`, `renderModules`, `renderFluidModules`, `renderLogo`, `renderMaze`, layout and logo math.
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
  - `worker.ts`: Dedicated background Web Worker that decodes camera frames (one bounded jsQR pass each) and image files (`createImageBitmap` with EXIF orientation, then jsQR at 2048 px and 1024 px).

### `qr-payload` (`@/packages/qr-payload`)

- **Purpose**: Consolidated QR payload generation, hydration parsing, RFC 5545/6350 escaping, protocol identification, and security containment validation behind a stateless format/parse/validate seam.
- **Entry Points**:
  - `index.ts`: Polymorphic `formatPayload`, `parsePayload`, `validatePayload`, config validators `validateConfig` and `sanitizeConfig`, protocol parser `identifyProtocol`, `canHydrate`, RFC escaping helpers, and typed generator contracts (`WifiContract`, `EmailContract`, `VCardContract`, etc.).

### `optical-transfer` (`@/packages/optical-transfer`)

- **Purpose**: Air-gapped, one-way optical data transmission via animated QR code streams. Uses a pure TypeScript rateless fountain codec (Luby Transform over $\text{GF}(2)$ with peeling plus Gaussian-elimination fallback) framed as Prism frames (Base45 text, a CBOR manifest with the SHA-256 and a CRC-32C per frame; `ur:bytes/` is read for one release), `deflate-raw` pre-compression, recycled preallocated frame pools, and dedicated Web Workers. See [ADR 0014](../../docs/adr/0014-rateless-fountain-codes-for-airgapped-optical-transfer.md) and [ADR 0024](../../docs/adr/0024-prism-frame-format.md).
- **Entry Points**:
  - `index.ts`: Primary public API: the handshake scannability gate (`verifyHandshakeFrame` with injectable worker/checker factories), `PreallocatedFramePool`, `StreamLookaheadReceiver`, fountain codec primitives (`FountainEncoder`, `FountainDecoder`, `solveGF2`, Robust Soliton helpers), BC-UR envelope (`serializeDroplet`, `parseDropletString`, `cborEncode`/`cborDecode`, Bytewords, `crc32`), session layer (`createFountainSession`, `openFountainSession`, `compressForTransfer`, `resolveFountainSymbolSize`), `FountainReassembler`, `FountainRateTracker`, and contracts.
  - Multi-code transfer (#1142), also exported from `index.ts` and off until a caller passes `enabled: true` to `planMultiCode`: layouts picked from the sender screen (`selectLayout`, `TILE_LAYOUTS`), staggered tile refresh (`tilesChangingAt`, `tileSlot`), vsync pacing (`createVsyncPacer`, `holdForTargetFps`), tile tracking and dedup (`TileTracker`, `createSymbolDedup`) and the decoder pool (`decoderPoolSize`, `createDecoderPool`). Nothing in the app imports them yet. What the bench shows and what needs a phone is in the [benchmark report](../../docs/TRANSFER_BENCHMARK.md).
  - `client.ts`: Headless React hooks. `useOpticalSender` broadcasts fountain droplets by default, with no handshake frame and every QR at version 7 or lower; the caller injects `renderFrame` and the scannability fallback flag. `useOpticalReceiver` provides stateless entry and exposes `fountainStats` telemetry (droplets vs K, rank, FPS, ETA); the caller injects `saveFile`; the camera comes from `useQrScanner`'s Camera Session and its error is exposed as `cameraError`. Also exports UI state types.
  - `checksum.ts`: `crc32` alone, for callers such as the Bulk CSV zip writer that must not pull in the handshake gate and its jsQR decoder.
  - `worker-slice.ts`: Background Web Worker: hashing, `deflate-raw` compression (skipped when it saves less than 5%), density-bounded symbol sizing, and QR matrix generation for Prism frames.
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
- **Entry Points**:
  - `index.ts`: constellations (`getConstellation`, `constellationId`), the probe sequence and its frames (`probeSequence`, `probeGeometries`, `drawProbeFrame`), the probe receiver analysis (`ProbeRun`, `formatProbeReport`) and the simulator (`simulateCapture`) and the reference codec (`encodeModemFrame`, `decodeModemFrame`, `frameCapacity`, `MODEM_PROFILES`; [ADR 0028](../../docs/adr/0028-optical-modem-frame-format.md)).
  - `flag.ts`: `isOpticalModemEnabled()`, the build flag. Kept tiny on purpose: pages import it statically and it must not pull the modem into a first load.
