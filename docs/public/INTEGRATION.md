---
publish-approved: true
audience: developers # internal developer documentation, not published on /security
---

# Public Developer Integration Guide and Architecture Manual

Technical integration guide for embedding QRCraftly's client-side QR matrix generation, structured payload formatting, Web Worker scannability auditing, vector and CMYK print exports, CSV batch automation, damage simulation, and air-gapped optical transfer packages.

## 1. Architectural Overview and Boundary Rules

QRCraftly is architected as standalone deep modules under `src/packages/`. Every computation runs on the client device (browser or Node.js) using WebAssembly and Web Workers without server intermediaries or network transit.

### The Four Deep Module Boundary Rules

1. **Entry-point boundary from app**: External application layers and consumer code import only root package entry points (`@/packages/<name>` or `@/packages/<name>/<entrypoint>`), never internal `lib/` or `tests/` subfolders.
2. **Intra-package freedom**: Files inside a package import each other directly, reaching other packages only through their root entry-point seams.
3. **Tests through entry points**: Test suites import through root entry points (`@/packages/<name>`), validating public interface contracts.
4. **No circular dependencies and barrel-free core**: Dependency cycles between modules are forbidden. Cross-package types and utilities live in `@/packages/core/<subpath>`, a leaf package that imports nothing else in `src/` and intentionally omits a root `index.ts` barrel.

Automated boundary compliance is verified with:

```bash
pnpm run lint:boundaries
```

## 2. QR Matrix Generation (`@/packages/qr-matrix`)

The `@/packages/qr-matrix` package owns the canonical pipeline turning a configuration into a two-dimensional binary module matrix (`QRModules`). The Rust WebAssembly encoder (`qr-encode.wasm`) loads asynchronously once via `loadQrEncoder`, after which matrix construction runs synchronously.

### Synchronous Matrix Building and Worker Error Handling

When using `createMatrixWorker()`, callers must handle `'success'`, `'validationFailed'`, and `'error'` worker status messages so rejected configurations and payload capacity errors never hang pending UI states.

```typescript
import {
  loadQrEncoder,
  buildMatrix,
  resolveEncodedValue,
  createMatrixWorker,
  type MatrixSource,
  type QrEncodeError,
} from '@/packages/qr-matrix';
import { QRType, type QRModules, type QRConfig } from '@/packages/core/types';
import { DEFAULT_CONFIG } from '@/packages/core/config';

type MatrixWorkerMessage =
  | { status: 'success'; sequenceId: number; size: number; matrix: Uint8Array }
  | { status: 'validationFailed'; sequenceId: number; violations: string[] }
  | {
      status: 'error';
      sequenceId: number;
      error: string;
      kind?: QrEncodeError['kind'];
    };

export async function generateMatrixSnippet(): Promise<QRModules> {
  const encoder = await loadQrEncoder();

  const source: MatrixSource = {
    type: QRType.URL,
    value: 'https://qrcraftly.com',
    errorCorrectionLevel: 'M',
  };

  const normalized = resolveEncodedValue(source);
  console.log('Normalized payload:', normalized);

  return buildMatrix(source, encoder);
}

export function runMatrixWorkerSnippet(): void {
  const worker = createMatrixWorker();
  if (!worker) return;

  worker.onmessage = (event: MessageEvent<MatrixWorkerMessage>) => {
    const message = event.data;
    if (message.status === 'success') {
      console.log(`Matrix generated: ${message.size}x${message.size} modules`);
      worker.terminate();
    } else if (message.status === 'validationFailed') {
      console.error('Configuration rejected:', message.violations.join('; '));
      worker.terminate();
    } else if (message.status === 'error') {
      console.error(
        `Encoding failed (${message.kind ?? 'unknown'}): ${message.error}`
      );
      worker.terminate();
    }
  };

  const config: QRConfig = {
    ...DEFAULT_CONFIG,
    type: QRType.URL,
    value: 'https://qrcraftly.com',
    errorCorrectionLevel: 'M',
  };

  worker.postMessage({ config, sequenceId: 1 });
}
```

## 3. Structured Payloads (`@/packages/qr-payload`)

The `@/packages/qr-payload` package formats, parses, and validates RFC-compliant payloads across URLs, plain text, Wi-Fi networks, RFC 6350 vCard contacts (versions 2.1, 3.0, 4.0, and MECARD), RFC 5545 calendar events, emails, SMS, phone numbers, GPS coordinates, meeting links, social profiles, and crypto or EPC SEPA payments. Contact `.vcf` file imports live at `@/packages/qr-payload/vcardFile`.

### RFC 6350 vCard Formatting and Validation Recipe

```typescript
import {
  formatPayload,
  validatePayload,
  validateConfig,
  identifyProtocol,
  VCardContract,
  type VCardData,
} from '@/packages/qr-payload';
import { QRType, type QRConfig } from '@/packages/core/types';
import { DEFAULT_CONFIG } from '@/packages/core/config';

export function buildVCardPayloadSnippet(): string {
  const contact: VCardData = {
    version: '4.0',
    firstName: 'Ada',
    lastName: 'Lovelace',
    organization: 'Analytical Engine Lab',
    title: 'Mathematician',
    phone: '+14155550199',
    email: 'ada@example.com',
    website: 'https://qrcraftly.com',
    street: '10 St James Square',
    city: 'London',
    zip: 'SW1Y 4LE',
    country: 'UK',
  };

  const encoded = formatPayload(QRType.VCARD, contact);
  const payloadViolations = validatePayload(encoded, QRType.VCARD);
  if (payloadViolations.length > 0) {
    throw new Error(payloadViolations.join('; '));
  }

  const config: QRConfig = {
    ...DEFAULT_CONFIG,
    type: QRType.VCARD,
    value: encoded,
  };
  const configViolations = validateConfig(config);
  if (configViolations.length > 0) {
    throw new Error(configViolations.join('; '));
  }

  const detectedType = identifyProtocol(encoded);
  const hydrated = VCardContract.hydrate(encoded);
  console.log(
    `Detected ${detectedType} for ${hydrated.firstName} ${hydrated.lastName}`
  );

  return encoded;
}
```

## 4. Off-Thread Scannability Audits (`@/packages/scannability`)

The `@/packages/scannability` package runs contrast auditing, two-pass WebAssembly QR decoding, and module-unit print simulation off the main thread. Most integrations should call `createScannabilityEvaluator`, which encapsulates canvas capture, zero-copy buffer transfer, request sequencing, the 1500 ms watchdog, backpressure, and main-thread fallback behind a single `ScannabilityAssessment`.

### Scannability Worker Request Contract

Callers communicating directly with `createScannabilityWorker()` must supply positive `width` and `height` dimensions and pass `moduleCount` **excluding** `quietZoneModules` (`auditModuleContrast` adds `2 * quietZoneModules` internally when computing quiet-zone borders; adding the quiet zone to `moduleCount` shifts module sampling cells and triggers false contrast violations).

| Field              | Type                                                           | Required             | Description                                                                             |
| :----------------- | :------------------------------------------------------------- | :------------------- | :-------------------------------------------------------------------------------------- |
| `width`            | `number`                                                       | Yes                  | Positive rendered frame width in pixels (`> 0`)                                         |
| `height`           | `number`                                                       | Yes                  | Positive rendered frame height in pixels (`> 0`)                                        |
| `imageData`        | `{ data: Uint8ClampedArray; width?: number; height?: number }` | Unless `imageBitmap` | Raw RGBA pixel buffer extracted from a canvas                                           |
| `imageBitmap`      | `ImageBitmap`                                                  | Unless `imageData`   | Transferred `ImageBitmap` handle for offscreen decoding                                 |
| `configId`         | `string \| null`                                               | Optional             | Configuration tag echoed on responses and required on `dropped` or `retryWithImageData` |
| `sequenceId`       | `number`                                                       | Optional             | Monotonically increasing request number for frame ordering                              |
| `moduleCount`      | `number`                                                       | Optional             | QR matrix modules per side **excluding** `quietZoneModules` (`matrix.size`)             |
| `quietZoneModules` | `number`                                                       | Optional             | Unprinted quiet zone width in modules around the matrix (`>= 0`, default `4`)           |
| `buffer`           | `ArrayBuffer`                                                  | Optional             | Transferable backing buffer returned to the main thread for reuse                       |

### Headless Evaluator and Worker Protocol Recipes

```typescript
import {
  createScannabilityEvaluator,
  createScannabilityWorker,
  assertWorkerRequest,
  assertWorkerResponse,
  isWorkerResponse,
  type ScannabilityAssessment,
  type WorkerRequest,
} from '@/packages/scannability';
import { QRType, type QRConfig } from '@/packages/core/types';
import { DEFAULT_CONFIG } from '@/packages/core/config';

export async function runEvaluatorSnippet(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  matrixSize: number
): Promise<ScannabilityAssessment | null> {
  const config: QRConfig = {
    ...DEFAULT_CONFIG,
    type: QRType.URL,
    value: 'https://qrcraftly.com',
    quietZoneModules: 4,
  };

  const evaluator = createScannabilityEvaluator({ config });
  const unsubscribe = evaluator.subscribe((assessment) => {
    console.log(
      `Status=${assessment.status}, score=${assessment.health.score}`
    );
  });

  try {
    return await evaluator.check({
      imageData: { data: pixels, width, height },
      moduleCount: matrixSize,
      quietZoneModules: config.quietZoneModules,
    });
  } finally {
    unsubscribe();
    evaluator.destroy();
  }
}

export function runScannabilityWorkerSnippet(matrixSize: number): void {
  const worker = createScannabilityWorker();
  if (!worker) return;

  worker.onmessage = (e: MessageEvent<unknown>) => {
    if (isWorkerResponse(e.data)) {
      if ('dropped' in e.data && e.data.dropped) {
        console.warn('Superseded frame dropped for config:', e.data.configId);
      } else if ('retryWithImageData' in e.data && e.data.retryWithImageData) {
        console.info(
          'Worker requested raw ImageData fallback for config:',
          e.data.configId
        );
      } else if ('success' in e.data) {
        assertWorkerResponse(e.data);
        console.log(
          `Scan verdict: success=${e.data.success}, physicalReady=${e.data.physicalReady}`
        );
      }
    }
  };

  const width = 296;
  const height = 296;
  const pixels = new Uint8ClampedArray(width * height * 4);

  const request: WorkerRequest = {
    imageData: { data: pixels, width, height },
    width,
    height,
    sequenceId: 1,
    configId: 'cfg-sample',
    moduleCount: matrixSize, // Exclude quietZoneModules (e.g. 29, never 29 + 8)
    quietZoneModules: 4,
    buffer: pixels.buffer,
  };

  assertWorkerRequest(request);
  worker.postMessage(request, [pixels.buffer]);
}
```

## 5. Vector SVG, EPS, PDF, and CMYK Print Exports (`@/packages/qr-export`)

The `@/packages/qr-export` package produces self-contained SVG markup (`generateQRSvg`), Encapsulated PostScript (`generateQREps`, `convertSvgToEps`), and single-page vector PDFs (`generateQRPdf`, `convertSvgToPdf`). Pass `VectorExportOptions` with `colorSpace: 'cmyk'` to emit CMYK PostScript/PDF vector operators (`setcmykcolor` and `k`) and `/DeviceCMYK` 4-channel image streams for commercial offset print workflows.

### Multi-Format Vector and CMYK Export Recipe

```typescript
import {
  generateQRSvg,
  generateQREps,
  convertSvgToEps,
  generateQRPdf,
  convertSvgToPdf,
  PayloadRejectedError,
  MissingImageError,
  type VectorExportOptions,
} from '@/packages/qr-export';
import { QRType, type QRConfig } from '@/packages/core/types';
import { DEFAULT_CONFIG } from '@/packages/core/config';

export async function exportPrintAssetsSnippet(): Promise<{
  svg: string;
  eps: string;
  pdf: Uint8Array;
}> {
  const config: QRConfig = {
    ...DEFAULT_CONFIG,
    type: QRType.URL,
    value: 'https://qrcraftly.com',
    errorCorrectionLevel: 'H',
  };

  const printOptions: VectorExportOptions = {
    colorSpace: 'cmyk',
  };

  try {
    // Option A: Generate SVG once and convert to CMYK EPS and PDF
    const svg = await generateQRSvg(config, {
      onLogoOmitted: () =>
        console.warn('Logo asset unavailable; exported without logo'),
    });
    const eps = await convertSvgToEps(svg, printOptions);
    const pdf = await convertSvgToPdf(svg, printOptions);

    // Option B: Direct one-step CMYK EPS or PDF helpers
    const directEps = await generateQREps(config, printOptions);
    const directPdf = await generateQRPdf(config, printOptions);
    console.log(
      `Direct exports ready: EPS=${directEps.length} chars, PDF=${directPdf.byteLength} bytes`
    );

    return { svg, eps, pdf };
  } catch (error) {
    if (error instanceof PayloadRejectedError) {
      console.error('Payload failed security validation:', error.violations);
    } else if (error instanceof MissingImageError) {
      console.error(
        'Embedded logo could not be decoded for EPS/PDF output:',
        error.message
      );
    }
    throw error;
  }
}
```

## 6. Bulk CSV Batch Automation (`@/packages/bulk-csv`)

The `@/packages/bulk-csv` package powers in-memory batch QR generation up to `MAX_BULK_CSV_ROWS` (500 rows per batch): RFC 4180 CSV parsing, column detection, preflight link-safety and control-character categorization, cooperative row rendering, error log formatting, and stored ZIP archiving.

### Headless CSV Preflight and ZIP Archive Recipe

```typescript
import {
  parseCsv,
  pickColumn,
  PAYLOAD_COLUMN_WORDS,
  FILENAME_COLUMN_WORDS,
  categorizeCsvRows,
  batchRows,
  skippedFromReport,
  runBatch,
  formatErrorLogCsv,
  errorLogFileName,
  createZip,
  MAX_BULK_CSV_ROWS,
} from '@/packages/bulk-csv';
import { generateQRSvg } from '@/packages/qr-export';
import { QRType, type QRConfig } from '@/packages/core/types';
import { DEFAULT_CONFIG } from '@/packages/core/config';

export async function runCsvBatchSnippet(csvText: string): Promise<Uint8Array> {
  const table = parseCsv(csvText, { maxRows: MAX_BULK_CSV_ROWS });
  const payloadCol =
    pickColumn(table.headers, PAYLOAD_COLUMN_WORDS) ?? table.headers[0] ?? '';
  const nameCol =
    pickColumn(table.headers, FILENAME_COLUMN_WORDS, { exclude: payloadCol }) ??
    '';

  const report = categorizeCsvRows(
    table.rows,
    payloadCol,
    DEFAULT_CONFIG,
    undefined,
    {
      contentType: 'link',
      rowNumbers: table.rowNumbers,
    }
  );

  const rows = batchRows(report, nameCol, table.rowNumbers);
  const batch = await runBatch(rows, {
    format: 'svg',
    render: async (payload) => {
      const rowConfig: QRConfig = {
        ...DEFAULT_CONFIG,
        type: QRType.URL,
        value: payload,
      };
      return generateQRSvg(rowConfig);
    },
    describeFailure: (err) =>
      err instanceof Error ? err.message : 'Render failed',
    isCancelled: () => false,
  });

  const skipped = [...skippedFromReport(report), ...batch.skipped];
  const entries = [...batch.entries];
  if (skipped.length > 0) {
    const logCsv = formatErrorLogCsv(skipped);
    entries.push({ name: errorLogFileName(), data: logCsv });
  }

  return createZip(entries);
}
```

## 7. Arcade Damage Simulation (`@/packages/arcade`)

The `@/packages/arcade` package exposes headless Reed-Solomon and finder-pattern damage modeling alongside projectile physics and `EmpiricalScanPipeline`. Callers build a `TargetMatrix` once, apply circular module blasts or seeded artillery barrages, and inspect recovery budgets and failure causes.

### Reed-Solomon and Finder Damage Analysis Recipe

```typescript
import {
  buildTargetMatrix,
  applyBlast,
  planBarrage,
  analyzeDamage,
  healthTone,
} from '@/packages/arcade';
import { loadQrEncoder } from '@/packages/qr-matrix';
import { createMulberry32 } from '@/packages/core/math';

export async function simulateQrDamageSnippet(): Promise<void> {
  const encoder = await loadQrEncoder();
  const target = buildTargetMatrix('https://qrcraftly.com', 'H', encoder);

  // Plan 3 deterministic strikes using core's seeded PRNG
  const strikes = planBarrage(target.size, 3, [1, 2], createMulberry32(42));
  let damaged: ReadonlySet<number> = new Set<number>();
  for (const strike of strikes) {
    damaged = applyBlast(
      damaged,
      target.size,
      strike.row,
      strike.col,
      strike.radius
    );
  }

  const analysis = analyzeDamage(damaged, target.size, target.ecc);
  const tone = healthTone(analysis.healthPercent);
  console.log(
    `Damaged ${analysis.damagedCount}/${analysis.budget} modules, tone=${tone}, decodable=${analysis.failure === null}`
  );
}
```

## 8. Air-Gapped Optical Transfer (`@/packages/optical-transfer`)

The `@/packages/optical-transfer` package implements one-way screen-to-camera transmission over animated QR code streams using Luby Transform rateless fountain codes (Prism session wire format) and wallet-compatible BC-UR (`@/packages/optical-transfer/bcur`).

### Headless Session and Capacity Planning Recipe

```typescript
import {
  createPrismSession,
  estimateTransferFrames,
  TRANSFER_DENSITY_PROFILES,
} from '@/packages/optical-transfer';

export async function opticalTransferSnippet(): Promise<void> {
  const payload = new Uint8Array(64 * 1024);
  const estimate = estimateTransferFrames(payload.length, 'balanced', 'lt');
  console.log(
    `Source symbols K=${estimate.k}, estimated frames=${estimate.frames}`
  );

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

## 9. Registered Public Packages (`src/packages/`)

All 14 packages under `src/packages/` expose strict entry-point seams enforced by `pnpm run lint:boundaries`:

| Package            | Entry Points                                                                                   | Primary Exports & Role                                                                                                             |
| :----------------- | :--------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `arcade`           | `@/packages/arcade`, `@/packages/arcade/client`, `@/packages/arcade/handoff`                   | `buildTargetMatrix`, `analyzeDamage`, `applyBlast`, `planBarrage`, `MicroGrid`, `EmpiricalScanPipeline`                            |
| `bulk-csv`         | `@/packages/bulk-csv`                                                                          | `parseCsv`, `categorizeCsvRows`, `batchRows`, `runBatch`, `formatErrorLogCsv`, `parseExcelToCsv`, `createZip`                      |
| `core`             | `@/packages/core/<subpath>` (no `index.ts` barrel)                                             | Leaf cross-package types, checksums, URL/SVG sanitizers, PRNG, and ZIP writer across 11 subpaths below                             |
| `link-safety`      | `@/packages/link-safety`                                                                       | `analyseLink`, `LinkFinding`, offline UTS #39 confusable, IP-host, and redirector inspection                                       |
| `optical-modem`    | `@/packages/optical-modem`, `crosstalk`, `gpu`, `flag`                                         | **Experimental** (`VITE_OPTICAL_MODEM=true`): color-grid optical modem, `encodeModemFrame`, `decodeModemFrame`, `ProbeRun`         |
| `optical-scanner`  | `@/packages/optical-scanner`, `client`, `scheduler`, `worker`                                  | `scan`, `createCameraScannerEngine`, `useQrScanner`, `AdaptiveFrameScheduler`, `DoubleBufferPool`                                  |
| `optical-transfer` | `@/packages/optical-transfer`, `protocol`, `multicode`, `feedback`, `colour`, `client`, `bcur` | `createPrismSession`, `estimateTransferFrames`, `PrismReceiver`, `FountainEncoder`, `BcUrEncoder`                                  |
| `qr-decode`        | `@/packages/qr-decode`                                                                         | `loadQrReader`, `createQrReader`, Rust WebAssembly multi-code and tracked-tile QR reader                                           |
| `qr-export`        | `@/packages/qr-export`, `@/packages/qr-export/scene`                                           | `generateQRSvg`, `generateQREps`, `convertSvgToEps`, `generateQRPdf`, `convertSvgToPdf`, `VectorExportOptions`, `renderWalletCard` |
| `qr-matrix`        | `@/packages/qr-matrix`, `encoder`, `mosaic`, `maze`, `canvas`                                  | `buildMatrix`, `loadQrEncoder`, `resolveEncodedValue`, `createMatrixWorker`, `createMazeWorker`, `drawQR`, `planMosaic`            |
| `qr-payload`       | `@/packages/qr-payload`, `vcardFile`, `youtube`                                                | `formatPayload`, `validatePayload`, `validateConfig`, `identifyProtocol`, RFC generator contracts, `readVCardFile`                 |
| `scannability`     | `@/packages/scannability`, `client`, `checker`, `scan`, `worker`                               | `createScannabilityEvaluator`, `createScannabilityWorker`, `auditModuleContrast`, `simulatePrint`, `assertWorkerRequest`           |
| `wallet-pass`      | `@/packages/wallet-pass`                                                                       | `createPassSigner`, `buildApplePass`, `buildGoogleSaveLink`, browser WebCrypto `.pkpass` CMS signing                               |
| `wasm-runtime`     | `@/packages/wasm-runtime`                                                                      | `compileWasmUrl`, `compileWasmBytes`, `instantiateWasm`, `WasmModuleError`, same-origin WebAssembly loader                         |

### Shared Core Subpaths (`@/packages/core`)

Per [ADR 0052](../adr/0052-shared-core-package.md), `@/packages/core` has one entry point per concern and no `index.ts` barrel file. Import each subpath directly:

| Subpath                    | Primary Exports & Purpose                                                                                                |
| :------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `@/packages/core/checksum` | `crc32`, `crc32c`, `crc32Hex` for ZIP archives and Prism frame integrity                                                 |
| `@/packages/core/config`   | `DEFAULT_CONFIG` baseline generator configuration                                                                        |
| `@/packages/core/ecc`      | `EccLevel` and `ECC_LEVELS` error correction tier constants                                                              |
| `@/packages/core/encoding` | Byte conversions, hex helpers, sRGB relative luminance LUTs, and `sha256`                                                |
| `@/packages/core/files`    | Cross-platform file-name sanitization, invisible-character checks, and file inspection                                   |
| `@/packages/core/math`     | `createMulberry32` deterministic PRNG and `fnv1a` string hashing                                                         |
| `@/packages/core/security` | `isDangerousUrl`, `sanitizeSvg`, image upload limits, and Trusted Types helpers (`sameOriginWorker`, `parseInertMarkup`) |
| `@/packages/core/site`     | `getPublicDomain` configured canonical origin                                                                            |
| `@/packages/core/types`    | `QRConfig`, `QRType`, `QRStyle`, `QRErrorCorrectionLevel`, `QRModules`, frame, border, mosaic, gradient, and Wi-Fi types |
| `@/packages/core/url`      | URL protocol normalization helpers                                                                                       |
| `@/packages/core/zip`      | `createZip`, `ZipEntry`, `CreateZipOptions` stored ZIP archive writer                                                    |
