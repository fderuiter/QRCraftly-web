import { describe, it, expect } from 'vitest';
import { qrEncoder as QRCode } from '../../../../tests/fixtures/qrEncoder';
import { scan } from '../index';

// Node has no ImageData; scan() only needs its shape.
class PixelFrame {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}
if (typeof globalThis.ImageData === 'undefined') {
  Object.defineProperty(globalThis, 'ImageData', { value: PixelFrame, configurable: true });
}

/** Rasterises `text` as a QR code with a quiet zone, `moduleSize` pixels per module. */
function renderQr(text: string, moduleSize: number, invert = false) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const count = qr.modules.size + 8;
  const size = Math.round(count * moduleSize);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / moduleSize) - 4;
      const my = Math.floor(y / moduleSize) - 4;
      const inside = mx >= 0 && my >= 0 && mx < qr.modules.size && my < qr.modules.size;
      const dark = inside && qr.modules.get(my, mx);
      const value = dark !== invert ? 0 : 255;
      const i = (y * size + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

describe('scan() frame decoding', () => {
  const read = async (frame: { data: Uint8ClampedArray; width: number; height: number }) =>
    (await scan(new ImageData(frame.data, frame.width, frame.height))).data;

  it('decodes a dark-on-light code', async () => {
    expect(await read(renderQr('UR:BYTES/1-9/LPADAX', 6))).toBe('UR:BYTES/1-9/LPADAX');
  });

  it('decodes an inverted (light-on-dark) code', async () => {
    expect(await read(renderQr('INVERTED', 6, true))).toBe('INVERTED');
  });

  it('decodes a dense stream frame at small module sizes', async () => {
    // About QR version 10 at ECC M, as the Fast transfer density produces.
    const text = `UR:BYTES/7-40/${'LPADAX'.repeat(50)}`;
    for (const moduleSize of [2, 3, 4.5]) {
      expect(await read(renderQr(text, moduleSize))).toBe(text);
    }
  });

  it('reports no code on a blank frame', async () => {
    const size = 200;
    const result = await scan(new ImageData(new Uint8ClampedArray(size * size * 4).fill(128), size, size));
    expect(result.status).toBe('fail');
    expect(result.data).toBeNull();
  });
});
