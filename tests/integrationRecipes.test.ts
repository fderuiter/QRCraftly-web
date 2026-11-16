import { describe, it, expect } from 'vitest';
import { loadQrEncoder, buildMatrix, resolveEncodedValue, type MatrixSource } from '@/packages/qr-matrix';
import {
  assertWorkerRequest,
  assertWorkerResponse,
  isWorkerResponse,
  type WorkerRequest,
  type WorkerResponse,
} from '@/packages/scannability';
import { generateQRSvg, PayloadRejectedError } from '@/packages/qr-export';
import {
  createPrismSession,
  estimateTransferFrames,
  TRANSFER_DENSITY_PROFILES,
} from '@/packages/optical-transfer';
import { QRType, type QRModules, type QRConfig } from '@/packages/core/types';
import { DEFAULT_CONFIG } from '@/packages/core/config';

describe('Developer Integration Guide Recipes', () => {
  it('recipe 1: builds QR module matrix synchronously with loadQrEncoder', async () => {
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
    // Finder patterns are dark at (0, 0)
    expect(matrix.get(0, 0)).toBe(true);
  });

  it('recipe 2: validates typed Web Worker request and response protocols', () => {
    const width = 256;
    const height = 256;
    const pixels = new Uint8ClampedArray(width * height * 4);

    const request: WorkerRequest = {
      imageData: { data: pixels, width, height },
      width,
      height,
      sequenceId: 1,
      configId: 'test-cfg',
      moduleCount: 29,
      quietZoneModules: 4,
      buffer: pixels.buffer,
    };

    expect(() => assertWorkerRequest(request)).not.toThrow();

    const successResponse: WorkerResponse = {
      success: true,
      physicalReady: true,
      configId: 'test-cfg',
      sequenceId: 1,
      minLocalContrast: 80,
      localContrastViolations: 0,
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

  it('recipe 3: generates resolution-independent vector SVG', async () => {
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      type: QRType.URL,
      value: 'https://qrcraftly.com',
      errorCorrectionLevel: 'M',
    } as QRConfig;

    const svg = await generateQRSvg(config);
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('</svg>');
  });

  it('recipe 3: rejects invalid payloads with PayloadRejectedError', async () => {
    const invalidConfig: QRConfig = {
      ...DEFAULT_CONFIG,
      type: QRType.URL,
      value: 'javascript:alert(1)',
    } as QRConfig;

    await expect(generateQRSvg(invalidConfig)).rejects.toThrow(PayloadRejectedError);
  });

  it('recipe 4: estimates frames and initializes air-gapped optical transfer session', async () => {
    const payload = new Uint8Array(32 * 1024); // 32 KB
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
});
