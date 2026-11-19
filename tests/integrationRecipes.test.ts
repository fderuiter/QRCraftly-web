import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
// @ts-expect-error - jsdom type declarations
import { JSDOM } from 'jsdom';

if (typeof globalThis.DOMParser === 'undefined') {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Node = dom.window.Node;
}

import { loadQrEncoder, buildMatrix, resolveEncodedValue, type MatrixSource } from '@/packages/qr-matrix';
import type { WorkerMatrixRequest, WorkerMatrixResponse } from '@/packages/qr-matrix/worker-matrix';
import {
  auditModuleContrast,
  createScannabilityEvaluator,
  assertWorkerRequest,
  assertWorkerResponse,
  isWorkerResponse,
  type WorkerRequest,
  type WorkerResponse,
} from '@/packages/scannability';
import {
  formatPayload,
  validatePayload,
  validateConfig,
  identifyProtocol,
  VCardContract,
  type VCardData,
} from '@/packages/qr-payload';
import {
  generateQRSvg,
  generateQREps,
  convertSvgToEps,
  generateQRPdf,
  convertSvgToPdf,
  PayloadRejectedError,
  type VectorExportOptions,
} from '@/packages/qr-export';
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
import {
  buildTargetMatrix,
  applyBlast,
  planBarrage,
  analyzeDamage,
  healthTone,
} from '@/packages/arcade';
import {
  createPrismSession,
  estimateTransferFrames,
  TRANSFER_DENSITY_PROFILES,
} from '@/packages/optical-transfer';
import { QRType, type QRModules, type QRConfig } from '@/packages/core/types';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { createMulberry32 } from '@/packages/core/math';
import { guides } from '@/data/guides';

/**
 * Renders a crisp black-on-white RGBA frame with an explicit quiet zone around `matrix`.
 */
function renderMatrixToRgba(matrix: QRModules, quietZoneModules: number, pxPerModule: number) {
  const totalModules = matrix.size + quietZoneModules * 2;
  const sidePx = totalModules * pxPerModule;
  const pixels = new Uint8ClampedArray(sidePx * sidePx * 4);
  pixels.fill(255);

  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (!matrix.get(row, col)) continue;
      const startY = (row + quietZoneModules) * pxPerModule;
      const startX = (col + quietZoneModules) * pxPerModule;
      for (let dy = 0; dy < pxPerModule; dy++) {
        for (let dx = 0; dx < pxPerModule; dx++) {
          const offset = ((startY + dy) * sidePx + (startX + dx)) * 4;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
          pixels[offset + 3] = 255;
        }
      }
    }
  }

  return { pixels, width: sidePx, height: sidePx };
}

describe('Developer Integration Guide Recipes', () => {
  it('recipe 1: builds QR module matrix synchronously with loadQrEncoder and aligns worker-matrix types', async () => {
    const encoder = await loadQrEncoder();
    const source: MatrixSource = {
      type: QRType.URL,
      value: 'https://qrcraftly.com',
      errorCorrectionLevel: 'M',
    };

    const resolved = resolveEncodedValue(source);
    expect(resolved).toBe('https://qrcraftly.com');

    const matrix: QRModules = buildMatrix(source, encoder);
    expect(matrix.size).toBeGreaterThan(20);
    expect(matrix.get(0, 0)).toBe(true);

    const req: WorkerMatrixRequest = {
      id: 1,
      config: { ...DEFAULT_CONFIG, type: QRType.URL, value: 'https://qrcraftly.com' },
    };
    const statuses: Array<WorkerMatrixResponse['status']> = ['success', 'validationFailed', 'error'];
    expect(req.id).toBe(1);
    expect(statuses).toHaveLength(3);
  });

  it('recipe 2: formats, validates, identifies, and hydrates RFC 6350 vCard payloads', () => {
    const contact: VCardData = {
      version: '4.0',
      firstName: 'Ada',
      lastName: 'Lovelace',
      organization: 'Analytical Engine Lab',
      title: 'Mathematician',
      phone: '+14155550199',
      email: 'ada@example.com',
      website: 'https://qrcraftly.com',
    };

    const encoded = formatPayload(QRType.VCARD, contact);
    expect(encoded).toContain('BEGIN:VCARD');
    expect(encoded).toContain('VERSION:4.0');
    expect(validatePayload(encoded, QRType.VCARD)).toEqual([]);

    const config: QRConfig = { ...DEFAULT_CONFIG, type: QRType.VCARD, value: encoded };
    expect(validateConfig(config)).toEqual([]);
    expect(identifyProtocol(encoded)).toBe(QRType.VCARD);

    const hydrated = VCardContract.hydrate(encoded);
    expect(hydrated.firstName).toBe('Ada');
    expect(hydrated.lastName).toBe('Lovelace');
    expect(hydrated.organization).toBe('Analytical Engine Lab');
  });

  it('recipe 3: validates WorkerRequest with moduleCount excluding quietZoneModules and zero contrast violations', async () => {
    const encoder = await loadQrEncoder();
    const matrix = buildMatrix(
      { type: QRType.URL, value: 'https://qrcraftly.com', errorCorrectionLevel: 'M' },
      encoder
    );
    const quietZoneModules = 4;
    const { pixels, width, height } = renderMatrixToRgba(matrix, quietZoneModules, 8);

    const request: WorkerRequest = {
      imageData: { data: pixels, width, height },
      width,
      height,
      sequenceId: 1,
      configId: 'test-cfg',
      moduleCount: matrix.size,
      quietZoneModules,
      buffer: pixels.buffer,
    };

    expect(() => assertWorkerRequest(request)).not.toThrow();

    const contrastResult = auditModuleContrast(
      { data: pixels, width, height },
      request.moduleCount!,
      request.quietZoneModules
    );
    expect(contrastResult).not.toBeNull();
    expect(contrastResult?.violations).toBe(0);
    expect(contrastResult?.minContrast).toBe(21);

    // Passing matrix.size + 2 * quietZoneModules misaligns cell sampling and produces false violations
    const misalignedResult = auditModuleContrast(
      { data: pixels, width, height },
      matrix.size + quietZoneModules * 2,
      quietZoneModules
    );
    expect(misalignedResult?.violations).toBeGreaterThan(0);

    const successResponse: WorkerResponse = {
      success: true,
      physicalReady: true,
      configId: 'test-cfg',
      sequenceId: 1,
      minLocalContrast: contrastResult?.minContrast ?? 255,
      localContrastViolations: contrastResult?.violations ?? 0,
      buffer: pixels.buffer,
    };
    expect(isWorkerResponse(successResponse)).toBe(true);
    expect(() => assertWorkerResponse(successResponse)).not.toThrow();

    const droppedResponse: WorkerResponse = {
      dropped: true,
      configId: 'test-cfg',
    };
    expect(isWorkerResponse(droppedResponse)).toBe(true);
    expect(() => assertWorkerResponse(droppedResponse)).not.toThrow();
  });

  it('recipe 3b: runs headless createScannabilityEvaluator with main-thread fallback', async () => {
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      type: QRType.URL,
      value: 'https://qrcraftly.com',
      errorCorrectionLevel: 'M',
      quietZoneModules: 4,
    };
    const encoder = await loadQrEncoder();
    const matrix = buildMatrix(config, encoder);
    const { pixels, width, height } = renderMatrixToRgba(matrix, config.quietZoneModules, 8);

    const evaluator = createScannabilityEvaluator({
      config,
      createWorker: () => null,
    });

    try {
      const assessment = await evaluator.check({
        imageData: { data: pixels, width, height },
        moduleCount: matrix.size,
        quietZoneModules: config.quietZoneModules,
      });
      expect(assessment).not.toBeNull();
      expect(assessment?.status).toBe('physical-pass');
      expect(assessment?.health.score).toBeGreaterThanOrEqual(80);
    } finally {
      evaluator.destroy();
    }
  });

  it('recipe 4: generates SVG, CMYK EPS, and CMYK PDF vector print exports', async () => {
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      type: QRType.URL,
      value: 'https://qrcraftly.com',
      errorCorrectionLevel: 'M',
    };
    const cmykOptions: VectorExportOptions = { colorSpace: 'cmyk' };

    const svg = await generateQRSvg(config);
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('</svg>');

    const epsFromSvg = await convertSvgToEps(svg, cmykOptions);
    const directEps = await generateQREps(config, cmykOptions);
    expect(epsFromSvg).toContain('%!PS-Adobe-3.0 EPSF-3.0');
    expect(epsFromSvg).toContain('setcmykcolor');
    expect(directEps).toContain('%!PS-Adobe-3.0 EPSF-3.0');

    const pdfFromSvg = await convertSvgToPdf(svg, cmykOptions);
    const directPdf = await generateQRPdf(config, cmykOptions);
    const pdfHeader = new TextDecoder().decode(pdfFromSvg.subarray(0, 64));
    const fullPdfText = new TextDecoder('latin1').decode(directPdf);
    expect(pdfHeader).toMatch(/^%PDF-/);
    expect(fullPdfText).toContain('0 0 0 1 k');
    expect(fullPdfText).toContain('%%EOF');
  });

  it('recipe 4b: rejects invalid payloads with PayloadRejectedError', async () => {
    const invalidConfig: QRConfig = {
      ...DEFAULT_CONFIG,
      type: QRType.URL,
      value: 'javascript:alert(1)',
    };

    await expect(generateQRSvg(invalidConfig)).rejects.toThrow(PayloadRejectedError);
  });

  it('recipe 5: parses CSV rows, categorizes unsafe links, renders SVGs, and writes a ZIP archive', async () => {
    const csvInput = [
      'url,label',
      'https://qrcraftly.com,home',
      'javascript:alert(1),unsafe_row',
    ].join('\n');

    const table = parseCsv(csvInput, { maxRows: MAX_BULK_CSV_ROWS });
    const payloadCol = pickColumn(table.headers, PAYLOAD_COLUMN_WORDS) ?? 'url';
    const stemCol = pickColumn(table.headers, FILENAME_COLUMN_WORDS, { exclude: payloadCol }) ?? 'label';

    const report = categorizeCsvRows(table.rows, payloadCol, DEFAULT_CONFIG, undefined, {
      contentType: 'link',
      rowNumbers: table.rowNumbers,
    });
    expect(report.validCount).toBe(1);
    expect(report.unsafeCount).toBe(1);

    const batch = await runBatch(batchRows(report, stemCol, table.rowNumbers), {
      format: 'svg',
      render: async (payload) => generateQRSvg({ ...DEFAULT_CONFIG, type: QRType.URL, value: payload }),
      describeFailure: (err) => (err instanceof Error ? err.message : 'Row failed'),
      isCancelled: () => false,
    });
    expect(batch.entries).toHaveLength(1);

    const skipped = [...skippedFromReport(report), ...batch.skipped];
    expect(skipped).toHaveLength(1);

    const zipBytes = createZip([
      ...batch.entries,
      { name: errorLogFileName(), data: formatErrorLogCsv(skipped) },
    ]);
    expect(zipBytes[0]).toBe(0x50);
    expect(zipBytes[1]).toBe(0x4b);
  });

  it('recipe 6: models Reed-Solomon and finder pattern damage with @/packages/arcade', async () => {
    const encoder = await loadQrEncoder();
    const target = buildTargetMatrix('https://qrcraftly.com', 'H', encoder);
    const strikes = planBarrage(target.size, 2, [1], createMulberry32(7));

    let damaged: ReadonlySet<number> = new Set<number>();
    for (const strike of strikes) {
      damaged = applyBlast(damaged, target.size, strike.row, strike.col, strike.radius);
    }

    const analysis = analyzeDamage(damaged, target.size, target.ecc);
    expect(analysis.damagedCount).toBeGreaterThan(0);
    expect(['healthy', 'warning', 'critical']).toContain(healthTone(analysis.healthPercent));
  });

  it('recipe 7: estimates frames and initializes air-gapped optical transfer session', async () => {
    const payload = new Uint8Array(32 * 1024);
    const estimates = estimateTransferFrames(payload.length, 'balanced', 'lt');
    expect(estimates.k).toBeGreaterThan(0);
    expect(estimates.frames).toBeGreaterThan(estimates.k);

    const session = await createPrismSession(payload, {
      fileName: 'test.bin',
      mimeType: 'application/octet-stream',
      maxVersion: TRANSFER_DENSITY_PROFILES.balanced.maxVersion,
      errorCorrectionLevel: TRANSFER_DENSITY_PROFILES.balanced.errorCorrectionLevel,
    });

    expect(session.symbolSize).toBe(estimates.symbolSize);
    expect(session.manifest.files[0].name).toBe('test.bin');
  });

  it('documents all 14 packages and all 11 @/packages/core subpaths in both manuals', () => {
    const packagesDir = path.resolve(process.cwd(), 'src', 'packages');
    const coreDir = path.join(packagesDir, 'core');

    const packageNames = fs
      .readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(packageNames).toHaveLength(14);

    const coreSubpaths = fs
      .readdirSync(coreDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
      .map((entry) => entry.name.replace(/\.ts$/, ''))
      .sort();
    expect(coreSubpaths).toHaveLength(11);
    expect(fs.existsSync(path.join(coreDir, 'index.ts'))).toBe(false);

    const integrationMd = fs.readFileSync(
      path.resolve(process.cwd(), 'docs', 'public', 'INTEGRATION.md'),
      'utf-8'
    );
    const devGuide = guides.find((guide) => guide.slug === 'developer-integration-guide');
    expect(devGuide).toBeDefined();
    const devGuideSerialized = JSON.stringify(devGuide);

    for (const pkg of packageNames) {
      expect(integrationMd).toContain(`@/packages/${pkg}`);
      expect(devGuideSerialized).toContain(`@/packages/${pkg}`);
    }
    for (const sub of coreSubpaths) {
      expect(integrationMd).toContain(`@/packages/core/${sub}`);
      expect(devGuideSerialized).toContain(`@/packages/core/${sub}`);
    }
  });
});
