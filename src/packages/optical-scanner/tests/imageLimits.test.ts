/*
    QRCraftly
    Copyright (C) 2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { describe, expect, it } from 'vitest';
import {
  IMAGE_TOO_LARGE_BYTES_MESSAGE,
  IMAGE_TOO_LARGE_PIXELS_MESSAGE,
  MAX_IMAGE_BYTES,
  assertImageWithinLimits,
  readImageSize,
} from '../index';

const pad = (bytes: number[]) => Uint8Array.from([...bytes, ...new Array<number>(Math.max(0, 40 - bytes.length)).fill(0)]);
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const text = (value: string) => [...value].map((char) => char.charCodeAt(0));

/** A PNG header that declares the given size. The file itself is tiny. */
const png = (width: number, height: number) =>
  pad([0x89, ...text('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...text('IHDR'), ...be32(width), ...be32(height)]);

const jpeg = (width: number, height: number) =>
  pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255]);

describe('readImageSize', () => {
  it('reads PNG, JPEG, GIF, BMP and the three WebP forms', () => {
    expect(readImageSize(png(1200, 800))).toEqual({ width: 1200, height: 800 });
    expect(readImageSize(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
    expect(readImageSize(pad([...text('GIF89a'), ...le16(300), ...le16(200)]))).toEqual({ width: 300, height: 200 });
    expect(readImageSize(pad([...text('BM'), ...new Array<number>(16).fill(0), ...le32(500), ...le32(400)]))).toEqual({ width: 500, height: 400 });
    const riff = [...text('RIFF'), 0, 0, 0, 0, ...text('WEBP')];
    expect(readImageSize(pad([...riff, ...text('VP8 '), 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(320), ...le16(240)]))).toEqual({ width: 320, height: 240 });
    expect(readImageSize(pad([...riff, ...text('VP8L'), 0, 0, 0, 0, 0x2f, ...le32(99 | (49 << 14))]))).toEqual({ width: 100, height: 50 });
    expect(readImageSize(pad([...riff, ...text('VP8X'), 0, 0, 0, 0, 0, 0, 0, 0, 0xf3, 0x01, 0x00, 0x63, 0x00, 0x00]))).toEqual({ width: 500, height: 100 });
  });

  it('skips JPEG segments to find the frame header', () => {
    const bytes = pad([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x03, 0xe8, 0x07, 0xd0]);
    expect(readImageSize(bytes)).toEqual({ width: 2000, height: 1000 });
  });

  it('returns null for other formats and for cut-off headers', () => {
    expect(readImageSize(pad(text('%PDF-1.7')))).toBeNull();
    expect(readImageSize(Uint8Array.from([0x89, 0x50]))).toBeNull();
  });
});

describe('assertImageWithinLimits (#1160)', () => {
  it('accepts an ordinary image', async () => {
    await expect(assertImageWithinLimits(new Blob([png(4000, 3000)], { type: 'image/png' }))).resolves.toBeUndefined();
  });

  it('refuses a small file that declares a huge image', async () => {
    const bomb = new Blob([png(65535, 65535)], { type: 'image/png' });
    expect(bomb.size).toBeLessThan(100);
    await expect(assertImageWithinLimits(bomb)).rejects.toThrow(IMAGE_TOO_LARGE_PIXELS_MESSAGE);
    await expect(assertImageWithinLimits(new Blob([jpeg(30000, 30000)], { type: 'image/jpeg' }))).rejects.toThrow(/40 megapixels/);
  });

  it('refuses a file over 50 MB without reading it', async () => {
    const big = { size: MAX_IMAGE_BYTES + 1, slice: () => { throw new Error('should not read'); } } as unknown as Blob;
    await expect(assertImageWithinLimits(big)).rejects.toThrow(IMAGE_TOO_LARGE_BYTES_MESSAGE);
  });

  it('allows a format it cannot read the size of', async () => {
    await expect(assertImageWithinLimits(new Blob([pad(text('not an image'))], { type: 'image/avif' }))).resolves.toBeUndefined();
  });
});
