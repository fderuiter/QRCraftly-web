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

import { beforeAll, describe, expect, it } from 'vitest';
import { loadOpticalModem, simulateCapture, type CameraImpairments, type RgbaImage } from '../index';

type Lens = NonNullable<CameraImpairments['lens']>;

const FRAME_WIDTH = 100;
const FRAME_HEIGHT = 60;
const BEZEL = 16;
/** Rows and columns measured for edges: the black cross sits on camera row 36 and column 60, so measure beside it. */
const ROW = 37;
const COL = 61;

/**
 * A white 100 x 60 frame with a black cross through its centre. The ideal preset puts the screen at
 * camera x 10 to 110 and y 6 to 66, so the camera is 120 x 72 and its centre (60, 36) is the frame
 * centre, where the cross crosses. There is no dark border: bilinear sampling mixes a dark border
 * into the screen's edge pixels, and that can average to exactly the bezel grey.
 */
function frame(): RgbaImage {
  const data = new Uint8ClampedArray(FRAME_WIDTH * FRAME_HEIGHT * 4);
  for (let y = 0; y < FRAME_HEIGHT; y++) {
    for (let x = 0; x < FRAME_WIDTH; x++) {
      const cross = x === FRAME_WIDTH / 2 || y === FRAME_HEIGHT / 2;
      const level = cross ? 0 : 255;
      data.set([level, level, level, 255], (y * FRAME_WIDTH + x) * 4);
    }
  }
  return { width: FRAME_WIDTH, height: FRAME_HEIGHT, data };
}

const SOURCE = frame();

function capture(lens?: Lens): RgbaImage {
  return simulateCapture(SOURCE, 'ideal', {
    pixelsPerCell: 1,
    cellPitch: 1,
    impairments: lens === undefined ? {} : { lens },
  });
}

function pixelAt(image: RgbaImage, x: number, y: number): number[] {
  const at = (y * image.width + x) * 4;
  return Array.from(image.data.slice(at, at + 4));
}

/** A camera pixel shows the screen when it is mostly white, not bezel grey (16). */
function isScreen(image: RgbaImage, x: number, y: number): boolean {
  return pixelAt(image, x, y)[0] > (BEZEL + 255) / 2;
}

function firstScreenColumn(image: RgbaImage, y: number): number {
  for (let x = 0; x < image.width; x++) if (isScreen(image, x, y)) return x;
  return -1;
}

function lastScreenColumn(image: RgbaImage, y: number): number {
  for (let x = image.width - 1; x >= 0; x--) if (isScreen(image, x, y)) return x;
  return -1;
}

function firstScreenRow(image: RgbaImage, x: number): number {
  for (let y = 0; y < image.height; y++) if (isScreen(image, x, y)) return y;
  return -1;
}

function lastScreenRow(image: RgbaImage, x: number): number {
  for (let y = image.height - 1; y >= 0; y--) if (isScreen(image, x, y)) return y;
  return -1;
}

beforeAll(() => loadOpticalModem());

describe('lens distortion in the camera', () => {
  it('leaves the capture exactly as it is with no lens, or with every coefficient at zero', () => {
    const plain = capture();
    expect(capture({ k1: 0 })).toEqual(plain);
    expect(capture({ k1: 0, k2: 0, p1: 0, p2: 0 })).toEqual(plain);
  });

  it('places the unwarped screen at camera x 10 to 109 on row 37 and y 6 to 65 on column 61', () => {
    const plain = capture();
    expect(plain.width).toBe(120);
    expect(plain.height).toBe(72);
    expect(firstScreenColumn(plain, ROW)).toBe(10);
    expect(lastScreenColumn(plain, ROW)).toBe(109);
    expect(firstScreenRow(plain, COL)).toBe(6);
    expect(lastScreenRow(plain, COL)).toBe(65);
  });

  it('keeps the exact centre of the picture fixed for any k1', () => {
    const plain = capture();
    for (const k1 of [-0.3, 0.1, 0.3]) {
      expect(pixelAt(capture({ k1 }), 60, 36)).toEqual(pixelAt(plain, 60, 36));
    }
  });

  it('barrel distortion (k1 > 0) pulls a corner inwards, so a pixel that was screen turns to bezel', () => {
    const plain = capture();
    const barrel = capture({ k1: 0.3 });
    expect(isScreen(plain, 11, 7)).toBe(true);
    expect(isScreen(barrel, 11, 7)).toBe(false);
    expect(pixelAt(barrel, 11, 7).slice(0, 3)).toEqual([BEZEL, BEZEL, BEZEL]);
  });

  it('barrel distortion keeps the picture well inside the screen as screen', () => {
    const barrel = capture({ k1: 0.3 });
    expect(isScreen(barrel, 20, 20)).toBe(true);
    expect(isScreen(barrel, COL, ROW)).toBe(true);
  });

  it('barrel distortion moves the edge midpoints inwards, and the corners further still', () => {
    const barrel = capture({ k1: 0.3 });
    const midpoint = firstScreenColumn(barrel, ROW);
    const corner = firstScreenColumn(barrel, 7);
    expect(midpoint).toBeGreaterThan(10);
    expect(corner).toBeGreaterThan(midpoint);
  });

  it('barrel distortion is symmetric about the centre column and row', () => {
    const barrel = capture({ k1: 0.3 });
    const left = firstScreenColumn(barrel, ROW);
    expect(lastScreenColumn(barrel, ROW)).toBe(barrel.width - 1 - left);
    const top = firstScreenRow(barrel, COL);
    expect(lastScreenRow(barrel, COL)).toBe(barrel.height - 1 - top);
  });

  it('decentring p2 slides the picture sideways: -p2 slides it back the other way, and the two sides move by different amounts', () => {
    const plain = capture();
    const toLeft = capture({ k1: 0, p2: 0.05 });
    const toRight = capture({ k1: 0, p2: -0.05 });
    const centreOf = (image: RgbaImage): number => (firstScreenColumn(image, ROW) + lastScreenColumn(image, ROW)) / 2;
    expect(centreOf(toLeft)).toBeLessThan(centreOf(plain) - 3);
    expect(centreOf(toRight)).toBeGreaterThan(centreOf(plain) + 3);
    const leftShift = firstScreenColumn(toLeft, ROW) - firstScreenColumn(plain, ROW);
    const rightShift = lastScreenColumn(toLeft, ROW) - lastScreenColumn(plain, ROW);
    expect(leftShift).toBeLessThan(0);
    expect(rightShift).toBeLessThan(0);
    expect(Math.abs(leftShift - rightShift)).toBeGreaterThanOrEqual(2);
  });

  it('decentring p2 leaves the top and bottom edges on column 61 where they were', () => {
    const plain = capture();
    const decentred = capture({ k1: 0, p2: 0.05 });
    expect(firstScreenRow(decentred, COL)).toBe(firstScreenRow(plain, COL));
    expect(lastScreenRow(decentred, COL)).toBe(lastScreenRow(plain, COL));
  });

  it('decentring p1 slides the picture up or down: -p1 slides it back, and the top and bottom edges move the same way', () => {
    const plain = capture();
    const up = capture({ k1: 0, p1: 0.05 });
    const down = capture({ k1: 0, p1: -0.05 });
    const centreOf = (image: RgbaImage): number => (firstScreenRow(image, COL) + lastScreenRow(image, COL)) / 2;
    expect(centreOf(up)).toBeLessThan(centreOf(plain));
    expect(centreOf(down)).toBeGreaterThan(centreOf(plain));
    const topShift = firstScreenRow(up, COL) - firstScreenRow(plain, COL);
    const bottomShift = lastScreenRow(up, COL) - lastScreenRow(plain, COL);
    expect(topShift).toBeLessThan(0);
    expect(bottomShift).toBeLessThan(0);
    expect(Math.abs(topShift - bottomShift)).toBeLessThanOrEqual(1);
  });

  it('decentring p1 leaves the left and right edges on row 37 where they were', () => {
    const plain = capture();
    const decentred = capture({ k1: 0, p1: 0.05 });
    expect(firstScreenColumn(decentred, ROW)).toBe(firstScreenColumn(plain, ROW));
    expect(lastScreenColumn(decentred, ROW)).toBe(lastScreenColumn(plain, ROW));
  });
});
