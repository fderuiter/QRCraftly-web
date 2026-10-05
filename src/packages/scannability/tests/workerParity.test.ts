/**
 * Worker / main-thread parity for the Scannability Health check.
 *
 * The Scannability Worker and the main-thread fallback run one shared step sequence, so real QR
 * frames (including a dangerous-URL payload) must produce identical results on both paths.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { qrEncoder as QRCode } from '../../../../tests/fixtures/qrEncoder';
import { qrReader } from '../../../../tests/fixtures/qrReader';
import { performScannabilityCheck, type PixelFrame } from '../checker';

/** Rasterizes a QR code into RGBA pixels (black on white, 4-module quiet zone). */
function renderQr(text: string, scale = 4): PixelFrame {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const margin = 4;
  const size = (modules.size + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (!modules.get(row, col)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const px = (col + margin) * scale + x;
          const py = (row + margin) * scale + y;
          const idx = (py * size + px) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
        }
      }
    }
  }
  return { data, width: size, height: size };
}

const blankFrame = (): PixelFrame => ({
  data: new Uint8ClampedArray(40 * 40 * 4).fill(255),
  width: 40,
  height: 40,
});

type Handler = (event: { data: unknown }) => Promise<void> | void;

interface FakeWorkerScope {
  onmessage: Handler | null;
  postMessage: (message: unknown) => void;
}

const posted: unknown[] = [];
const scope: FakeWorkerScope = {
  onmessage: null,
  postMessage: (message) => {
    posted.push(message);
  },
};

async function runInWorker(frame: PixelFrame, configId: string, moduleCount?: number) {
  posted.length = 0;
  const handler = scope.onmessage;
  if (!handler) throw new Error('Worker did not install a message handler');
  await handler({
    data: {
      imageData: { data: frame.data.slice(), width: frame.width, height: frame.height },
      width: frame.width,
      height: frame.height,
      isTest: true,
      configId,
      moduleCount,
    },
  });
  return posted[0];
}

describe('Scannability Worker parity with the main-thread check', () => {
  beforeAll(async () => {
    Object.defineProperty(globalThis, 'self', { value: scope, configurable: true, writable: true });
    await import('../worker');
  });

  afterAll(() => {
    Reflect.deleteProperty(globalThis, 'self');
  });

  it.each([
    ['a safe URL', () => renderQr('https://qrcraftly.com'), 'SAFE'],
    ['a dangerous javascript: URL', () => renderQr('javascript:alert(1)'), 'DANGEROUS'],
    ['a frame without a code', blankFrame, 'BLANK'],
  ])('matches for %s', async (_label, makeFrame, configId) => {
    const frame = makeFrame();
    const mainThread = performScannabilityCheck(qrReader, frame, frame.width, frame.height, true, 25);
    const worker = await runInWorker(frame, configId, 25);

    expect(worker).toEqual({ ...mainThread, configId, sequenceId: undefined, buffer: undefined });
  });

  it('flags a dangerous payload as a security violation on both paths', async () => {
    const frame = renderQr('javascript:alert(1)');
    expect(performScannabilityCheck(qrReader, frame, frame.width, frame.height, true)).toMatchObject({
      success: false,
      error: 'SECURITY_VIOLATION',
    });
    await expect(runInWorker(frame, 'SEC')).resolves.toMatchObject({
      success: false,
      error: 'SECURITY_VIOLATION',
    });
  });

  it('passes a clean code on both paths', async () => {
    const frame = renderQr('https://qrcraftly.com');
    expect(performScannabilityCheck(qrReader, frame, frame.width, frame.height, true)).toMatchObject({
      success: true,
      physicalReady: true,
    });
  });
});
