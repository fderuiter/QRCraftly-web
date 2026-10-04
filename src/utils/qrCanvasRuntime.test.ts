import { describe, it, expect } from 'vitest';
import { type QrEncoder } from '@/packages/qr-matrix';
import { qrEncoder } from '../../tests/fixtures/qrEncoder';
import { getQrCanvasRuntime, setQrCanvasRuntime } from './qrCanvasRuntime';
import { QRErrorCorrectionLevel } from '../types';

describe('qrCanvasRuntime', () => {
  it('spawns no workers where Web Workers do not exist', () => {
    const runtime = getQrCanvasRuntime();
    expect(runtime.createMatrixWorker()).toBeNull();
    expect(runtime.createMazeWorker()).toBeNull();
  });

  it('loads the real encoder', async () => {
    const encoder = await getQrCanvasRuntime().loadEncoder();
    const { modules } = encoder.create('https://qrcraftly.com', { errorCorrectionLevel: QRErrorCorrectionLevel.M });
    expect(modules.size).toBeGreaterThanOrEqual(21);
    // Top-left Finder Pattern corner is always dark
    expect(modules.get(0, 0)).toBe(true);
  });

  it('reports modules as booleans', () => {
    const { modules } = qrEncoder.create('hello', { errorCorrectionLevel: QRErrorCorrectionLevel.L });
    for (let c = 0; c < modules.size; c++) {
      expect(typeof modules.get(0, c)).toBe('boolean');
    }
  });

  it('applies overrides and restores the previous runtime', () => {
    const before = getQrCanvasRuntime();
    const fake: QrEncoder = { create: () => ({ modules: { size: 1, get: () => true } }) };

    const restore = setQrCanvasRuntime({ loadEncoder: () => fake });
    expect(getQrCanvasRuntime().loadEncoder()).toBe(fake);
    expect(getQrCanvasRuntime().createMatrixWorker).toBe(before.createMatrixWorker);

    restore();
    expect(getQrCanvasRuntime()).toBe(before);
  });
});
