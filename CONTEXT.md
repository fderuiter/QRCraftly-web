# QRCraftly

A client-side QR code studio designed to generate customized, scannable QR codes without transmitting user payloads across the network.

## Language

### QR Geometry

**Matrix**:
The two-dimensional grid of binary square modules representing encoded data, error correction codewords, and timing patterns.
_Avoid_: Grid, table, bitmap

**Module**:
An individual binary data cell situated at coordinate (x, y) within the QR matrix.
_Avoid_: Pixel, dot, block, unit

**Finder Pattern**:
The three concentric square detection eyes positioned at the corners of the QR matrix used by barcode scanners for orientation.
_Avoid_: Corner eye, alignment marker, target, anchor box

**Quiet Zone**:
The blank, unprinted margin of at least four modules wide surrounding the exterior perimeter of the QR matrix required for optical detection.
_Avoid_: Margin, padding, border, white space

**Fluid Ink**:
A visual render aesthetic where contiguous dark modules connect via continuous curves while preserving module optical contrast.
_Avoid_: Liquid ink, blob style, melted QR, connected dots

**Diagonal Neck Bridge**:
A calibrated diagonal corridor connecting diagonally adjacent modules across 2x2 matrix intersections in fluid rendering.
_Avoid_: Diagonal bleed, corner bleed, diagonal connector

**Perimeter Contour Loop**:
A closed polygon formed by directed boundary segments outlining contiguous module clusters for smooth vector rendering.
_Avoid_: Outline, border path, trace line

**Mosaic QR**:
A render mode that tiles a user-supplied image into the modules, recolouring each module (or its centre sub-cell in halftone mode) towards its dark or light value so the matrix still decodes. See ADR 0019.
_Avoid_: Art QR, picture QR, image QR, AI QR

**Mosaic Core**:
The centre sub-cell of a halftone mosaic module, held at full contrast because scanners sample module centres; the outer sub-cells carry image detail.
_Avoid_: Centre dot, data dot, halftone pixel

### Privacy & Compliance

**Static QR Code**:
A QR code whose content is encoded directly in its modules, with no redirect service in between. QRCraftly makes only static codes; dynamic (redirect-based) codes were removed ([ADR 0022](docs/adr/0022-no-dynamic-qr-codes-client-side-only.md)).
_Avoid_: Offline QR code, permanent QR code

**Storage Allowlist**:
The explicit set of persistent browser storage keys permitted in client memory.
_Avoid_: Storage whitelist, cookie list, saved state keys

**Volatile Memory Guarantee**:
The privacy invariant ensuring user payloads reside exclusively in ephemeral browser memory and clear upon session end.
_Avoid_: Stateless mode, incognito processing, memory wipe

### Off-Thread Performance

**Scannability Health**:
An empirical classification of code readability derived from automated contrast checks and barcode detector evaluation.
_Avoid_: Readability rate, success score, scan rating, reliability index

**Scannability Health Evaluator**:
The headless deep module that answers "how scannable is this QR frame?" with one assessment (verification status, health score, export risk, worker recovery state). It privately owns canvas capture, buffer transfer, request sequencing, the Scannability Worker lifecycle, the 1500ms watchdog and the main-thread fallback. React code reaches it only through the `useScannability` adapter hook.
_Avoid_: Scannability runner, worker runner, scannability hook internals

**Scannability Worker**:
A dedicated background process performing real-time contrast auditing and optical decoding off the main user interface thread.
_Avoid_: Background scanner, validation thread, scannability thread

**Print Simulation Verified**:
The optimal scannability grade indicating optical clarity under simulated physical print conditions and localized contrast audits.
_Avoid_: Physical-Ready, print pass, physical scan ok

**Screen Scan Verified**:
A passing scannability grade indicating reliable digital screen readability with an advisory to verify physical prints prior to mass distribution.
_Avoid_: Digital-Only Pass, screen pass, digital ok

**Scan Verification Failed**:
A degraded scannability grade indicating the QR matrix cannot be reliably resolved due to contrast or complexity violations.
_Avoid_: Low Scannability, bad scan, scan fail

**Worker Degradation Cache**:
A client-side state flag indicating that background Web Worker execution lacks OffscreenCanvas 2D rendering capabilities in the current browser environment, routing subsequent scannability evaluations to direct zero-copy ImageData buffer transfers without retry overhead.
_Avoid_: Canvas fallback flag, broken worker cache, degradation state

**Superseded ACK**:
An off-thread Web Worker acknowledgement confirming a stale scan frame was dropped, used by the main-thread scheduler to release backpressure without overwriting active diagnostic status.
_Avoid_: Stale frame response, dropped signal, busy unlock event

**Optical Detection Engine**:
A consolidated deep module encapsulating real-time webcam frame acquisition, image-file decoding (photos and screenshots, decoded in the worker with their EXIF orientation), and off-thread Web Worker barcode decoding behind a unified entry-point seam. It does not read video files.
_Avoid_: Camera frame provider, QR scanner helper, scanner utility

**Camera Scanner Engine**:
The headless component of the Optical Detection Engine that owns the live camera frame loop, adaptive sampling, backpressure, downscaling, and the private scanner worker (epochs, one bounded decode pass per frame, a 5000ms hang watchdog, three restarts, and main-thread fallback). React code reaches it only through the `useQrScanner` adapter hook.
_Avoid_: Camera frame provider, scanner loop hook, worker ref

**Camera Session**:
The single owner of a live camera stream for scanning (`lib/cameraSession.ts`): it requests the camera, attaches it to the video element, runs the Camera Scanner Engine while streaming, and stops every track on `stop()`, unmount or when the tab is hidden. `start()` and `stop()` are idempotent, so React effects that run twice cannot leave a camera running. Its state is `idle`, `requesting`, `streaming`, `denied`, `unavailable` or `error`, exposed as `state`, `start` and `stop` by `useQrScanner`.
_Avoid_: Camera hook, stream manager, useCamera

**Adaptive Frame Scheduler**:
A backpressure and pacing controller managing dynamic sleep intervals, in-flight frame sequencing, execution latency histories, and starvation watchdog recovery during continuous video capture.
_Avoid_: Frame timer, scanner loop, camera ticker

### Air-Gapped Optical Transfer

**Air-Gapped Optical Transfer**:
A client-side screen-to-camera communication pipeline transmitting arbitrary files across physical air gaps via animated QR code streams without local network or Bluetooth dependencies.
_Avoid_: Dynamic QR transfer, animated scanner, QR streaming file

**Asynchronous Optical Erasure Channel**:
The physical-layer model of the screen-to-camera optical link where camera rolling shutter, ambient reflections, and uncoordinated display refresh rates turn transmission defects into packet erasures.
_Avoid_: Bad camera link, scan drop channel, broken scan link

**Rateless Fountain Stream**:
A continuous broadcast of pseudo-randomly combined droplet frames encoded using Luby Transform codes, allowing any receiver to reconstruct the source payload from any K + ε frames regardless of arrival order.
_Avoid_: Shuffled loop, infinite carousel, frame deck

**Two-Tier Optical Error Correction**:
A dual-layer error mitigation scheme combining intra-frame Reed-Solomon codewords over GF(2^8) to correct localized spatial blemishes with inter-frame rateless fountain coding over GF(2) to absorb temporal frame drops.
_Avoid_: Double ECC, dual error recovery, two-way ECC

**Stateless Stream Entry**:
The receiver capability to start capturing and decoding an optical stream at an arbitrary point in time without an explicit preparatory handshake phase.
_Avoid_: Mid-stream scan, instant sync, handshake-free mode

**Droplet Symbol**:
An individual rateless fountain packet produced by XOR-combining a pseudo-random subset of source blocks according to a degree distribution.
_Avoid_: Packet chunk, fountain slice, stream bit

**Prism Frame**:
One animated-QR frame of an optical transfer: Base45 text holding a short header (version, type, session ID, symbol IDs), one or more droplet symbols or a manifest, and a CRC-32C. Frames are independent, so a receiver can join at any point.
_Avoid_: Packet, ur part, chunk

**Transfer Manifest**:
The sender's description of a transfer (file names, sizes, types, SHA-256, symbol size) sent as the first frame and repeated, so the receiver can check limits and show what is arriving before the file completes.
_Avoid_: Header, handshake, session header

**Session ID**:
The first 6 bytes of the SHA-256 of the manifest. It ties every frame to one transfer and lets a receiver ignore a manifest that does not match.
_Avoid_: Stream ID, transfer token

**Transfer Density**:
The sender's choice of how much data each droplet QR carries (Reliable, Balanced or Fast). It sets the highest QR version and the error correction level of every droplet, independent of the QR appearance.
_Avoid_: Chunk size, max data per QR, QR speed

**Fountain Block Slicer**:
The partitioning subsystem dividing source file binaries into fixed-size input blocks and generating rateless fountain droplet symbols.
_Avoid_: File cutter, chunk generator, packet slicer

**Degree Distribution**:
The discrete probability distribution governing how many source blocks are XOR-combined into each emitted droplet symbol to guarantee low-overhead peeling decoding.
_Avoid_: Block weight, degree spread, combination ratio

**Optical Transfer Engine**:
A consolidated deep module encapsulating rateless fountain coding, contiguous frame memory pooling, Prism frame validation, and off-thread slicing and reassembly behind unified entry-point seams.
_Avoid_: Transfer helper, animated QR manager, file transfer utility

### Environment & Tooling Invariants

**Platform Invariance Guarantee**:
The invariant ensuring all repository tooling, scripts, file operations, build pipelines, and tests behave identically across Windows, macOS, and Linux without platform branching or host-specific path assumptions.
_Avoid_: OS compatibility, multi-platform fix, Windows support, cross-platform patch

**Path Canonicalization**:
The internal representation of all relative filesystem paths using POSIX forward slashes (`/`) regardless of host operating system path conventions.
_Avoid_: Path slash replacement, Windows path normalization, slash sanitization, backslash cleanup

### Architectural Structure

**Deep Module**:
A cohesive software unit that encapsulates substantial behavior and implementation complexity behind a small, well-defined public surface situated at the package root. Distinct from a binary QR matrix module.
_Avoid_: Unit, component, service, utility folder, barrel package

**Entry-Point Seam**:
The explicit interface boundary formed by a package's root-level files through which all external consumers and tests interact with the module.
_Avoid_: Internal import, deep path import, barrel file, boundary

### Developer Experience & Tooling

**Interactive Wizard**:
A guided terminal walkthrough script that coordinates manual human browser actions, credential capture, and environment configuration through a standardized stage-by-stage interface.
_Avoid_: Setup helper, interactive guide, prompt script, install cli

**Wizard Runner**:
A cross-platform launcher ensuring interactive bash wizards execute consistently across Windows, macOS, and Linux without platform branching or manual shell navigation.
_Avoid_: Bash bridge, script invoker, shell wrapper

**Git Guardrails**:
The automated client-side hooks combining Husky with lint-staged to enforce code formatting, syntax rules, and duplication constraints before commit creation.
_Avoid_: Commit hooks, git checks, pre-commit scripts, git filters

**Authoritative Deployment Orchestrator**:
The division of responsibility in which GitHub Actions is the quality gate (the required `CI` check, audits, smoke tests) and Cloudflare Workers Builds is the only system that deploys, building each pushed branch from Git.
_Avoid_: Build trigger, dual deploy, cloud build runner, auto-deployment app

**Trunk-Based Delivery**:
The lifecycle discipline where every feature and fix branch returns to `main` through a squash-merged pull request that passes the required `CI`, `PR Title` and `Workers Builds: qrcraftly` checks, and every merge to `main` deploys to production.
_Avoid_: Staged promotion, dev branch, integration branch, direct push release

**Ephemeral Preview Environment**:
An isolated edge preview version that Cloudflare Workers Builds uploads for each pushed branch, served at `https://<branch>-qrcraftly.fpderuiter.workers.dev`, for visual review prior to merge.
_Avoid_: Test deploy, PR sandbox, temp site, branch build

**Release PR**:
The `release/vX.Y.Z` pull request created by `pnpm run release:prepare`, carrying the `package.json` version bump and the new `CHANGELOG.md` section. Merging it into `main` makes the Release workflow create the `vX.Y.Z` tag and GitHub Release.
_Avoid_: Promotion, release branch merge, dev-to-main PR, manual tag

**Conventional Commit**:
A structured commit message following the `<type>(<scope>): <description>` format (e.g. `feat(qr): add logo embedding`), used by the release engine to automatically determine the next SemVer bump and generate the changelog.
_Avoid_: Tagged message, semantic commit, versioned commit, prefix commit

**Release Engine**:
The cross-platform Node.js utility (`scripts/release_engine.js`) that reads conventional commits since the latest git tag, computes the next SemVer version, generates a grouped Keep-a-Changelog section, and prepares the Release PR (`--prepare`).
_Avoid_: Version bumper, changelog writer, deploy script, tag creator
