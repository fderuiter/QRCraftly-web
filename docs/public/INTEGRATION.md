---
publish-approved: true
audience: developers # internal developer documentation, not published on /security
---

# Public Developer Integration Guide and Architecture Manual

Technical integration guide for embedding QRCraftly's modular client-side QR generation, Web Worker scannability auditing, vector SVG export, and air-gapped optical transfer engines.

## 1. Architectural Overview and Boundary Rules

QRCraftly is architected as a set of standalone deep modules located under `src/packages/`. All compute runs strictly on the client device (browser or Node.js environment) using WebAssembly and Web Workers without server intermediaries.

### The Four Deep Module Boundary Rules

1. **Entry-point boundary from app**: External application layers and consumer code may import only root package entry points (`@/packages/<name>` or `@/packages/<name>/<entrypoint>`), never anything inside internal `lib/` or subfolders.
2. **Intra-package freedom**: Files within a package import each other directly, but reach other packages only through their root entry points.
3. **Tests through entry points**: Test suites import strictly through root entry points (`@/packages/<name>`), validating public interface contracts.
4. **No circular dependencies**: Dependency cycles between modules are forbidden. Shared utilities live in `@/packages/core`.

Automated boundary compliance is validated across the codebase with:

```bash
pnpm run lint:boundaries
```

## 2. QR Matrix Generation (`@/packages/qr-matrix`)

The `@/packages/qr-matrix` package is the single authoritative source for turning a configuration into a 2D boolean module matrix (`QRModules`). The underlying QR encoder is compiled from Rust to WebAssembly (`qr-encode.wasm`) and instantiated asynchronously.

### Synchronous Matrix Building and Background Worker Recipes

```typescript
import {
  loadQrEncoder,
  buildMatrix,
  resolveEncodedValue,
  createMatrixWorker,
  type MatrixSource,
} from '@/packages/qr-matrix';
import { QRType, type QRModules, type QRConfig } from '@/packages/core/types';
import { DEFAULT_CONFIG } from '@/packages/core/config';

export async function generateMatrixSnippet(): Promise<QRModules> {
  // Load the WebAssembly QR encoder once
  const encoder = await loadQrEncoder();

  // Define payload source and error correction level
  const source: MatrixSource = {
    type: QRType.URL,
    value: 'https://qrcraftly.com',
    errorCorrectionLevel: 'M',
  };

  // Pre-normalize payload if necessary (e.g. protocol injection)
  const normalized = resolveEncodedValue(source);
  console.log('Normalized payload:', normalized);

  // Synchronously compute the module matrix
  const modules: QRModules = buildMatrix(source, encoder);
  return modules;
}

export function runMatrixWorkerSnippet(): void {
  // Offload heavy calculation to background thread
  const worker = createMatrixWorker();
  if (!worker) return;

  worker.onmessage = (
    event: MessageEvent<{ status: string; matrix?: Uint8Array; size?: number }>
  ) => {
    if (event.data.status === 'success') {
      console.log('Matrix generated on worker thread, size:', event.data.size);
      worker.terminate();
    }
  };

  const config: QRConfig = {
    ...DEFAULT_CONFIG,
    type: QRType.URL,
    value: 'https://qrcraftly.com',
    errorCorrectionLevel: 'M',
  } as QRConfig;

  worker.postMessage({ config, sequenceId: 1 });
}
```

## 3. Off-Thread Scannability Audits (`@/packages/scannability`)

The `@/packages/scannability` package performs real-time scannability verification, physical contrast auditing, and optical print simulation in background Web Workers. Transferred pixel buffers are handled zero-copy, with watchdog recovery and cooperative yielding.

### Worker Message Protocol Contract

The worker protocol uses strictly typed request and response contracts guarded by validation functions:

- `WorkerRequest`: Carries `imageData` (`Uint8ClampedArray`), canvas dimensions (`width`, `height`), `sequenceId`, `configId`, `moduleCount`, and `quietZoneModules`.
- `WorkerResponse`: Returns validation results with `success`, `physicalReady`, contrast violations, and recycled `buffer`.

### Web Worker Integration Recipe

```typescript
import {
  createScannabilityWorker,
  assertWorkerRequest,
  assertWorkerResponse,
  isWorkerResponse,
  type WorkerRequest,
} from '@/packages/scannability';

export function runScannabilityCheckSnippet(): void {
  const worker = createScannabilityWorker();
  if (!worker) return;

  worker.onmessage = (e: MessageEvent<unknown>) => {
    if (isWorkerResponse(e.data)) {
      if ('dropped' in e.data && e.data.dropped) {
        console.warn('Frame dropped in favor of newer scan request');
      } else if ('retryWithImageData' in e.data && e.data.retryWithImageData) {
        console.info('Worker requested raw pixel buffer fallback');
      } else if ('success' in e.data) {
        assertWorkerResponse(e.data);
        console.log(
          `Scan verdict: success=${e.data.success}, physicalReady=${e.data.physicalReady}`
        );
      }
    }
  };

  const width = 256;
  const height = 256;
  const pixels = new Uint8ClampedArray(width * height * 4);

  const request: WorkerRequest = {
    imageData: { data: pixels, width, height },
    width,
    height,
    sequenceId: 1,
    configId: 'cfg-sample',
    moduleCount: 29,
    quietZoneModules: 4,
    buffer: pixels.buffer,
  };

  // Validate before sending
  assertWorkerRequest(request);

  // Transfer ArrayBuffer zero-copy
  worker.postMessage(request, [pixels.buffer]);
}
```

## 4. Vector SVG Export (`@/packages/qr-export`)

The `@/packages/qr-export` package provides `generateQRSvg` to export high-resolution, resolution-independent SVG files. Logos and custom styling are embedded directly as base64 data URLs to ensure the generated file remains fully self-contained.

### Vector Export Recipe

```typescript
import { generateQRSvg, PayloadRejectedError } from '@/packages/qr-export';
import { QRType, type QRConfig } from '@/packages/core/types';
import { DEFAULT_CONFIG } from '@/packages/core/config';

export async function generateSvgSnippet(): Promise<string> {
  const config: QRConfig = {
    ...DEFAULT_CONFIG,
    type: QRType.URL,
    value: 'https://qrcraftly.com',
    errorCorrectionLevel: 'H',
  } as QRConfig;

  try {
    const svg: string = await generateQRSvg(config, {
      onLogoOmitted: () => {
        console.warn(
          'Custom logo could not be loaded; export proceeded without logo'
        );
      },
    });
    return svg;
  } catch (error) {
    if (error instanceof PayloadRejectedError) {
      console.error(
        'Payload rejected due to security policy:',
        error.violations
      );
    }
    throw error;
  }
}
```

## 5. Air-Gapped Optical Transfer (`@/packages/optical-transfer`)

The `@/packages/optical-transfer` module implements one-way optical transmission using animated QR code streams powered by rateless Luby Transform fountain codes (Prism session protocol).

### Headless Session and Capacity Planning Recipe

```typescript
import {
  createPrismSession,
  estimateTransferFrames,
  TRANSFER_DENSITY_PROFILES,
} from '@/packages/optical-transfer';

export async function opticalTransferSnippet(): Promise<void> {
  // Estimate frame count and transmission requirements
  const payload = new Uint8Array(64 * 1024); // 64 KB payload
  const estimate = estimateTransferFrames(payload.length, 'balanced', 'lt');
  console.log(
    `Source symbols K=${estimate.k}, total estimated frames=${estimate.frames}`
  );

  // Create sender session stream
  const session = await createPrismSession(payload, {
    fileName: 'transfer.bin',
    mimeType: 'application/octet-stream',
    maxVersion: TRANSFER_DENSITY_PROFILES.balanced.maxVersion,
    errorCorrectionLevel:
      TRANSFER_DENSITY_PROFILES.balanced.errorCorrectionLevel,
  });

  console.log(
    `Prism session initialized with symbol size: ${session.symbolSize} bytes`
  );
}
```

## 6. Summary of Registered Public Entry Points

| Package            | Entry Point                   | Primary Interfaces & Exports                                                                  |
| :----------------- | :---------------------------- | :-------------------------------------------------------------------------------------------- |
| `qr-matrix`        | `@/packages/qr-matrix`        | `buildMatrix`, `loadQrEncoder`, `createMatrixWorker`, `resolveEncodedValue`                   |
| `scannability`     | `@/packages/scannability`     | `createScannabilityWorker`, `assertWorkerRequest`, `assertWorkerResponse`, `isWorkerResponse` |
| `qr-export`        | `@/packages/qr-export`        | `generateQRSvg`, `PayloadRejectedError`, `rasterizeSvgToCanvas`                               |
| `optical-transfer` | `@/packages/optical-transfer` | `createPrismSession`, `estimateTransferFrames`, `TRANSFER_DENSITY_PROFILES`                   |
