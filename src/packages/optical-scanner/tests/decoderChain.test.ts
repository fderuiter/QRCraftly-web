/**
 * The decoder chain (#1099, ADR 0023): the platform detector first, the zxing-wasm reader in the
 * worker, our reader (#1178) last; multi-frame confirmation; byte-exact results.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createNativeQrDetector, createResultGate, cameraStrategyFor, decodeCameraCode } from '../index';
import { decodeWithZxing, installZxing, zxingState } from '../reader';
import { renderCorpusFrame } from '../../../../tests/utils/scannerCorpus';
import { qrReader } from '../../../../tests/fixtures/qrReader';

const WASM = path.resolve('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm');

/** Cuts the centre square of a frame at native resolution, as the engine's region of interest does. */
function centreRegion(frame: { data: Uint8ClampedArray; width: number; height: number }) {
  const side = Math.min(frame.width, frame.height);
  const left = Math.floor((frame.width - side) / 2);
  const top = Math.floor((frame.height - side) / 2);
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    const from = ((top + y) * frame.width + left) * 4;
    data.set(frame.data.subarray(from, from + side * 4), y * side * 4);
  }
  return { data, width: side, height: side, left, top };
}

describe('result gate', () => {
  it('drops a single spurious decode and accepts two that agree within the window', () => {
    const gate = createResultGate();
    expect(gate.offer('MISREAD', 'qr-decode', 0)).toBe(false);
    expect(gate.offer('REAL', 'zxing', 100)).toBe(false);
    expect(gate.offer('REAL', 'zxing', 300)).toBe(true);
  });

  it('does not count agreeing decodes further apart than the window', () => {
    const gate = createResultGate({ windowMs: 500 });
    expect(gate.offer('SLOW', 'qr-decode', 0)).toBe(false);
    expect(gate.offer('SLOW', 'qr-decode', 800)).toBe(false);
    expect(gate.offer('SLOW', 'qr-decode', 1000)).toBe(true);
  });

  it('trusts the platform detector on one frame', () => {
    expect(createResultGate().offer('NATIVE', 'native', 0)).toBe(true);
  });

  it('emits each distinct payload once per hold period', () => {
    const gate = createResultGate({ confirmations: 1, holdMs: 3000 });
    expect(gate.offer('A', 'zxing', 0)).toBe(true);
    expect(gate.offer('A', 'zxing', 100)).toBe(false);
    expect(gate.offer('B', 'zxing', 200)).toBe(true);
    expect(gate.offer('A', 'zxing', 2900)).toBe(false);
    expect(gate.offer('A', 'zxing', 3000)).toBe(true);
    expect(gate.offer('B', 'zxing', 3100)).toBe(false);
  });

  it('emits every decode for streams (one confirmation, no hold) and forgets everything on reset', () => {
    const stream = createResultGate({ confirmations: 1, holdMs: 0 });
    expect([stream.offer('F|0', 'qr-decode', 0), stream.offer('F|0', 'qr-decode', 10)]).toEqual([true, true]);

    const gate = createResultGate();
    gate.offer('X', 'qr-decode', 0);
    gate.reset();
    expect(gate.offer('X', 'qr-decode', 10)).toBe(false);
  });
});

describe('native detector', () => {
  /** A stub `BarcodeDetector` constructor reporting the given formats. */
  const stubDetector = (formats: string[], found: Array<{ rawValue: string; cornerPoints?: Array<{ x: number; y: number }> }>) => {
    const detect = vi.fn(async () => found);
    const ctor = Object.assign(
      class {
        detect = detect;
      },
      { getSupportedFormats: async () => formats }
    );
    return { ctor, detect };
  };

  it('is not used without BarcodeDetector or when it cannot read QR codes', async () => {
    expect(await createNativeQrDetector(undefined)).toBeNull();
    expect(await createNativeQrDetector(stubDetector(['ean_13'], []).ctor)).toBeNull();
  });

  it('reads QR codes with text and corners, without bytes', async () => {
    const corners = [
      { x: 1, y: 2 },
      { x: 9, y: 2 },
      { x: 9, y: 10 },
      { x: 1, y: 10 },
    ];
    const { ctor } = stubDetector(['qr_code', 'ean_13'], [{ rawValue: 'https://qrcraftly.com', cornerPoints: corners }]);
    const detector = await createNativeQrDetector(ctor);
    const code = await detector?.detect({} as ImageBitmap);
    expect(code).toEqual({ text: 'https://qrcraftly.com', bytes: null, corners });
  });
});

describe('zxing-wasm reader (ADR 0023)', () => {
  beforeAll(async () => {
    // Node has no ImageData; the reader only reads its data, width and height.
    if (typeof globalThis.ImageData === 'undefined') {
      vi.stubGlobal(
        'ImageData',
        class {
          constructor(
            public data: Uint8ClampedArray,
            public width: number,
            public height: number
          ) {}
        }
      );
    }
    expect(zxingState()).toBe('absent');
    expect(await installZxing(await WebAssembly.compile(fs.readFileSync(WASM)))).toBe(true);
    expect(zxingState()).toBe('ready');
  });

  it('decodes a 2 px-module code in a 1080p frame from the native-resolution region (#1099)', async () => {
    const frame = renderCorpusFrame({ text: 'https://qrcraftly.com/scan', modulePx: 2, width: 1920, height: 1080 });
    const region = centreRegion(frame);

    const zxing = await decodeWithZxing(region.data, region.width, region.height);
    expect(zxing?.text).toBe('https://qrcraftly.com/scan');
    expect(zxing?.corners).not.toBeNull();

    const ours = decodeCameraCode(qrReader, region.data, region.width, region.height, cameraStrategyFor(1));
    expect(ours?.text).toBe('https://qrcraftly.com/scan');
  });

  it('returns the exact payload bytes, not just text', async () => {
    const text = 'Grüße';
    const frame = renderCorpusFrame({ text, modulePx: 4, width: 640, height: 480 });
    const code = await decodeWithZxing(frame.data, frame.width, frame.height);
    expect(code?.text).toBe(text);
    expect(Array.from(code?.bytes ?? [])).toEqual(Array.from(new TextEncoder().encode(text)));
  });

  it('finds nothing in a frame with no code', async () => {
    const frame = renderCorpusFrame({ text: null, noise: 20, width: 640, height: 480 });
    expect(await decodeWithZxing(frame.data, frame.width, frame.height)).toBeNull();
  });
});

describe('file scans with the platform detector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('decodes a photo natively and never creates the worker', async () => {
    class FakeBitmap {
      width = 1200;
      height = 900;
      close = vi.fn();
    }
    const detect = vi.fn(async () => [{ rawValue: 'NATIVE-PHOTO' }]);
    vi.stubGlobal(
      'BarcodeDetector',
      Object.assign(
        class {
          detect = detect;
        },
        { getSupportedFormats: async () => ['qr_code'] }
      )
    );
    vi.stubGlobal('ImageBitmap', FakeBitmap);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => new FakeBitmap()));
    const WorkerSpy = vi.fn();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('Worker', WorkerSpy);

    const { scan } = await import('../index');
    const result = await scan(new Blob(['jpeg'], { type: 'image/jpeg' }));

    expect(result).toMatchObject({ status: 'pass', data: 'NATIVE-PHOTO', source: 'native', bytes: null });
    expect(detect).toHaveBeenCalledWith(expect.any(FakeBitmap));
    expect(WorkerSpy).not.toHaveBeenCalled();
  });
});
