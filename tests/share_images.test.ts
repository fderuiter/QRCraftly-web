import zlib from 'node:zlib';
import { qrReader } from './fixtures/qrReader';
import { describe, expect, it } from 'vitest';
import { buildMatrix, loadQrEncoder } from '@/packages/qr-matrix';
import { QRErrorCorrectionLevel, QRType } from '@/types';
import { drawable, textWidth, wrapText } from '../scripts/utils/pixelImage';
import { SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH, renderExampleSvg, renderMosaicExamplePng, renderShareImage } from '../scripts/utils/shareImages';

/** Reads an indexed PNG written by encodePng back into RGBA pixels. */
function decodeIndexedPng(png: Buffer): { width: number; height: number; rgba: Uint8ClampedArray } {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let palette = Buffer.alloc(0);
  const data: Buffer[] = [];
  let width = 0;
  let height = 0;
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    }
    if (type === 'PLTE') palette = body;
    if (type === 'IDAT') data.push(body);
    at += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(data));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const index = raw[row * (width + 1) + 1 + col];
      const out = (row * width + col) * 4;
      rgba.set([palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2], 255], out);
    }
  }
  return { width, height, rgba };
}

describe('share images (#1030)', () => {
  const address = 'https://qrcraftly.com/wifi-qr-code';

  async function gridFor(value: string) {
    return buildMatrix({ type: QRType.URL, value, errorCorrectionLevel: QRErrorCorrectionLevel.M }, await loadQrEncoder());
  }

  it('is a 1200 by 630 PNG', async () => {
    const png = renderShareImage('WiFi QR Code Generator', 'qrcraftly.com', await gridFor(address));
    const { width, height } = decodeIndexedPng(png);
    expect([width, height]).toEqual([SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT]);
  });

  it('carries a QR code that scans back to the page address', async () => {
    const png = renderShareImage('WiFi QR Code Generator', 'qrcraftly.com', await gridFor(address));
    const { width, height, rgba } = decodeIndexedPng(png);
    expect(qrReader.read(rgba, width, height, { inverted: true })[0]?.text).toBe(address);
  });

  it('is byte-for-byte reproducible and survives long headings', async () => {
    const grid = await gridFor(address);
    const long = 'A very long heading that has to wrap over several lines to fit beside the code panel';
    expect(renderShareImage(long, 'qrcraftly.com', grid).equals(renderShareImage(long, 'qrcraftly.com', grid))).toBe(true);
    expect(decodeIndexedPng(renderShareImage(long, 'qrcraftly.com', grid)).width).toBe(SHARE_IMAGE_WIDTH);
  });
});

describe('example SVG', () => {
  it('draws a quiet-zone-padded QR code that scans back to its payload', async () => {
    const payload = 'WIFI:T:WPA;S:QRCraftly_Guest;P:examplepass123;;';
    const grid = buildMatrix({ type: QRType.WIFI, value: payload, errorCorrectionLevel: QRErrorCorrectionLevel.M }, await loadQrEncoder());
    const svg = renderExampleSvg(grid);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
    const total = grid.size + 8;
    expect(svg).toContain(`viewBox="0 0 ${total} ${total}"`);

    // Rasterise the path at 4px per module by replaying its runs, then scan it.
    const scale = 4;
    const side = total * scale;
    const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
    for (const [, x, y, w] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let row = 0; row < scale; row++) {
        for (let col = 0; col < Number(w) * scale; col++) {
          const at = ((Number(y) * scale + row) * side + Number(x) * scale + col) * 4;
          rgba.set([0, 0, 0], at);
        }
      }
    }
    expect(qrReader.read(rgba, side, side, { inverted: true })[0]?.text).toBe(payload);
  });
});

/** Reads a truecolour PNG written by encodeRgbPng back into RGBA pixels. */
function decodeRgbPng(png: Buffer): { width: number; height: number; rgba: Uint8ClampedArray } {
  const data: Buffer[] = [];
  let width = 0;
  let height = 0;
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      expect(body[9]).toBe(2);
    }
    if (type === 'IDAT') data.push(body);
    at += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(data));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const from = row * (width * 3 + 1) + 1 + col * 3;
      rgba.set([raw[from], raw[from + 1], raw[from + 2], 255], (row * width + col) * 4);
    }
  }
  return { width, height, rgba };
}

describe('mosaic examples (#1035)', () => {
  const address = 'https://qrcraftly.com/';

  it.each(['halftone', 'tiles'] as const)('draws a %s mosaic that still scans back to the address', async (mode) => {
    const grid = buildMatrix({ type: QRType.URL, value: address, errorCorrectionLevel: QRErrorCorrectionLevel.H }, await loadQrEncoder());
    const png = renderMosaicExamplePng(grid, mode);
    const { width, height, rgba } = decodeRgbPng(png);
    expect(width).toBe((grid.size + 8) * 12);
    expect(height).toBe(width);
    expect(qrReader.read(rgba, width, height, { inverted: true })[0]?.text).toBe(address);
    // It is a picture, not a black and white code: many distinct colours.
    const colours = new Set<number>();
    for (let i = 0; i < rgba.length; i += 4) colours.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
    expect(colours.size).toBeGreaterThan(20);
    expect(png.length).toBeLessThan(60_000);
  });

  it('is byte-for-byte reproducible', async () => {
    const grid = buildMatrix({ type: QRType.URL, value: address, errorCorrectionLevel: QRErrorCorrectionLevel.H }, await loadQrEncoder());
    expect(renderMosaicExamplePng(grid, 'tiles').equals(renderMosaicExamplePng(grid, 'tiles'))).toBe(true);
  });
});

describe('pixel text', () => {
  it('wraps words to the width and replaces characters the font lacks', () => {
    const lines = wrapText('FREE STATIC QR CODES FOR EVERYONE', 5, 300);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => textWidth(line, 5) <= 300)).toBe(true);
    expect(drawable('Wi-Fi ✓')).not.toContain('✓');
  });
});
