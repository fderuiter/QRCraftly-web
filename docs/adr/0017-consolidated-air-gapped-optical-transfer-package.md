---
status: accepted
---

# Consolidated Air-Gapped Optical Transfer Engine

## Context

Air-gapped screen-to-camera optical file transfer previously suffered from severe architectural entanglement across React hooks, utility workers, and ad-hoc frame memory caching. The sender and receiver subsystems were dispersed across `src/hooks/useAnimatedQrSender.ts` (748 lines, since deleted), `src/hooks/useAnimatedQrReceiver.ts` (787 lines, since deleted), `src/utils/fileSliceWorker.ts` (since deleted), `src/utils/fileReassemblyWorker.ts` (since deleted), `src/utils/FrameMemoryPool.ts` (since deleted), and `src/engine/StreamLookahead.ts` (since deleted).

This monolithic design presented multiple systemic deficiencies:

1. **Massive Hook Sprawl**: Over 1,500 lines of orchestration logic directly intertwined Web Worker messaging, RAF animation loops, frame memory pooling, video capture pipelines, and DOM side-effects inside React components.
2. **Untestable Off-DOM Logic**: Transfer protocols, handshake verification gates, and chunk reassembly could not be cleanly exercised in pure off-DOM unit tests without mocking DOM canvases, RAF loops, or media devices.
3. **Plumbing and Security Duplication**: `StreamLookahead.ts` duplicated URL percent-decoding, HTML entity resolution, and dangerous protocol filtering routines already implemented in `src/utils/url.ts`.
4. **ADR-0014 Alignment Gap**: The promise of rateless fountain codes (Luby Transform over $\text{GF}(2)$) and stateless stream entry (ADR 0014) remained blocked behind handshake-dependent carouselled chunking entangled within the presentation layer.
5. **Early Beta Designation**: The air-gapped optical transfer capability is experimental and requires clear user-facing early beta markers and advisory notices across navigation and transfer interfaces.

## Decision

We consolidate the entire air-gapped optical transfer pipeline into a unified deep module under [`src/packages/optical-transfer/`](../../src/packages/optical-transfer/).

### 1. Minimal Public Seams

The package exposes minimal, orthogonal public entry points:

- **`index.ts` (Primary Entry Point)**: Fountain codec, BC-UR envelope, session layer, reassembler, frame pool, Stream Lookahead and the handshake scannability gate (`verifyHandshakeFrame`).
- **`client.ts` (React Hook Seam)**: Exposes headless React hooks `useOpticalSender` and `useOpticalReceiver` to manage reactive lifecycle states, fps sliders, progress metrics, and canvas/video bindings without exposing internal memory buffers or workers.
- The headless `TransferSession` / `ReceiverSession` classes (`sender.ts`, `receiver.ts`) originally planned here were deleted (issue #981): no production code used them, and the hooks drive the workers themselves.
- **`worker-slice.ts` & `worker-reassembly.ts` (Worker Entry Points)**: Dedicated off-thread Web Worker entry points isolating CPU-heavy slicing, fountain degree sampling, and peeling reassembly from the main thread.

### 2. Private Subsystem (`lib/`)

Internal transfer mechanics are strictly encapsulated within `lib/`:

- **`lib/fountain/`**: Zero-dependency Luby Transform codec implementing Robust Soliton degree distributions, droplet symbol generators, peeling with GF(2) Gaussian-elimination fallback, BC-UR `ur:bytes/` framing (CBOR + Bytewords + CRC-32), and the compressed, SHA-256-bound session header for stateless stream entry (see [ADR 0014](./0014-rateless-fountain-codes-for-airgapped-optical-transfer.md)).
- **`lib/framePool.ts`**: Contiguous typed-array memory buffer (`PreallocatedFramePool`) preventing GC pauses during animation loops.
- **`lib/streamLookahead.ts`**: Protocol security validator consuming `SafeUrlPipeline` from `src/utils/url.ts`, eliminating duplicate entity decoders.
- **`lib/handshake.ts`**: Initial handshake frame verification and scannability gatekeeping.
- **`lib/sender/`, `lib/receiver/`**: The hook implementations behind `client.ts`, with worker spawning, legacy `H|`/`F|` frame parsing, SHA-256 integrity checks and video element helpers.

### 3. Backwards-Compatibility Shims & Duplication Limits

- Existing hooks (`src/hooks/useAnimatedQrSender.ts` and `src/hooks/useAnimatedQrReceiver.ts`) and utility workers (`src/utils/fileSliceWorker.ts`, `src/utils/fileReassemblyWorker.ts`, `src/utils/FrameMemoryPool.ts`, `src/engine/StreamLookahead.ts`) first became minimal re-export shims pointing to `@/packages/optical-transfer`. All of them have since been deleted (issue #982); callers import `useOpticalSender`, `useOpticalReceiver` and `StreamLookaheadReceiver` from the package directly.
- Repository code duplication is preserved well below the 3.00% ceiling.

### 4. Early Beta Visibility

- Both `/file-transfer` and `/file-transfer/receive` display visual "Beta" pills in page headers.
- An advisory `Alert` banner is embedded to inform users of optical alignment and lighting constraints.
- The Send File and Receive File links in the primary navigation (`src/data/navigation.ts`, rendered by `AppShell.tsx`) carry an explicit "Beta" pill indicator.

## Consequences

- Presentation components (`src/pages/file-transfer/+Page.tsx` and `receive/+Page.tsx`) decouple entirely from Web Worker messaging, memory pooling, and protocol lookahead mechanics.
- Core streaming and fountain reassembly logic is 100% testable in headless Node/Vitest environments off the DOM.
- Eliminates 1,500+ lines of duplicated hook plumbing while preserving complete backward compatibility for existing routes.

## Amendment: injected app capabilities (issues #980, #981)

The package no longer imports the app's React layers or app renderers. The file-transfer pages inject them:

- `useOpticalSender` takes `renderFrame` (the page paints frames with the template renderer), `scannabilityFallbackActive` (read from the QR store by the page) and an optional `verifyFrame` gate.
- `useOpticalReceiver` takes `saveFile` (the page passes the download manager). The adaptive scanner is imported from `@/packages/optical-scanner/client`, whose Camera Session owns the camera stream; the receiver exposes its failure as `cameraError` (amended by issue #1097, which replaced the injected `camera` and the app's `useCamera` hook).
- `verifyHandshakeFrame` renders with `@/packages/qr-matrix`, checks with the Scannability Worker from `@/packages/scannability`, and takes injected worker, checker and canvas factories instead of detecting the test environment. The worker verdict wins whenever it arrives within the 1500ms watchdog; the main-thread check runs only when the worker is unavailable, fails, drops the request, or misses the watchdog.
- The sender reports the real size of its preallocated frame pool (`transferStats.frameBufferMemory`) instead of an estimated heap figure.
- The package-boundary check (dependency-cruiser at the time, `scripts/check_boundaries.js` since #1196) forbids packages from importing app layers with no exemptions, and forbids relative imports from one package into another (`cross-package-imports-use-alias`).
