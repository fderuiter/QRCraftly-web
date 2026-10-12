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

  it('barrel distortion (k1 < 0) pulls a corner inwards, so a pixel that was screen turns to bezel', () => {
    // The screen corner (10, 6) is forward-mapped to about (20.4, 12.3): r² = (50² + 30²) / 4896 = 0.6944,
    // radial = 1 - 0.3 × 0.6944 = 0.7917, so the corner moves 50 × 0.2083 px in x and 30 × 0.2083 px in y.
    // Camera pixel (11, 7) lies outside that corner, so it shows bezel.
    const plain = capture();
    const barrel = capture({ k1: -0.3 });
    expect(isScreen(plain, 11, 7)).toBe(true);
    expect(isScreen(barrel, 11, 7)).toBe(false);
    expect(pixelAt(barrel, 11, 7).slice(0, 3)).toEqual([BEZEL, BEZEL, BEZEL]);
  });

  it('barrel distortion keeps the picture well inside the screen as screen', () => {
    const barrel = capture({ k1: -0.3 });
    expect(isScreen(barrel, 20, 20)).toBe(true);
    expect(isScreen(barrel, COL, ROW)).toBe(true);
  });

  it('barrel distortion moves the edge midpoints inwards, and the corners further still', () => {
    const barrel = capture({ k1: -0.3 });
    const midpoint = firstScreenColumn(barrel, ROW);
    // Row 10 is near the top corner. Row 7 is above the screen's top corner altogether, so it has no screen.
    const corner = firstScreenColumn(barrel, 10);
    expect(midpoint).toBeGreaterThan(10);
    expect(corner).toBeGreaterThan(midpoint);
    expect(firstScreenColumn(barrel, 7)).toBe(-1);
  });

  it('barrel distortion is symmetric about the centre column and row', () => {
    const barrel = capture({ k1: -0.3 });
    const left = firstScreenColumn(barrel, ROW);
    expect(lastScreenColumn(barrel, ROW)).toBe(barrel.width - 1 - left);
    const top = firstScreenRow(barrel, COL);
    expect(lastScreenRow(barrel, COL)).toBe(barrel.height - 1 - top);
  });

  it('a k2-only term (k1 = 0) pulls the corner pixel (11, 7) to bezel and leaves the centre alone', () => {
    // r⁴ at the corner pixel: r² = (48.5² + 28.5²) / 4896 = 0.6464, so r⁴ = 0.4178 and k2 r⁴ = -0.0418.
    // The corner moves inwards by about 4% of its radius, which is enough to put (11, 7) outside the screen.
    const plain = capture();
    const k2Only = capture({ k1: 0, k2: -0.1 });
    expect(isScreen(plain, 11, 7)).toBe(true);
    expect(pixelAt(k2Only, 11, 7).slice(0, 3)).toEqual([BEZEL, BEZEL, BEZEL]);
    expect(pixelAt(k2Only, 60, 36)).toEqual(pixelAt(plain, 60, 36));
  });

  it('a stronger k1 moves the screen edge further than a weaker one, on both sides', () => {
    const weak = capture({ k1: -0.05 });
    const medium = capture({ k1: -0.15 });
    const strong = capture({ k1: -0.3 });
    expect(firstScreenColumn(medium, ROW)).toBeGreaterThan(firstScreenColumn(weak, ROW));
    expect(firstScreenColumn(strong, ROW)).toBeGreaterThan(firstScreenColumn(medium, ROW));
    expect(lastScreenColumn(medium, ROW)).toBeLessThan(lastScreenColumn(weak, ROW));
    expect(lastScreenColumn(strong, ROW)).toBeLessThan(lastScreenColumn(medium, ROW));
  });

  it('k1 = -0.05 puts the left edge midpoint where the forward model says, within 1 px', () => {
    // Forward model at the left edge midpoint, ideal point (10, 36), so v = 0 and p1 = p2 = k2 = 0.
    // s = √(120² + 72²) / 2 = √19584 / 2 = 69.97 (s² = 4896), so u = -50 / s = -0.7145 and u² = 2500 / 4896 = 0.5106.
    // radial = 1 + k1 u² = 1 - 0.05 × 0.5106 = 0.9745.
    // d_x = 60 + u × radial × s = 60 - 50 × 0.9745 = 60 - 48.72 = 11.28.
    // A pixel counts as screen when its centre is inside, so the first screen column i puts the edge within
    // half a pixel of i. The 1 px tolerance also covers the bilinear blur and the 3 x 3 sampling.
    const HAND_LEFT_EDGE = 11.28;
    // The right edge is the mirror image, at 120 - 11.28 = 108.72. Its last screen column 108 ends at 109.
    const HAND_RIGHT_EDGE = 108.72;
    const plain = capture();
    const barrel = capture({ k1: -0.05 });
    const left = firstScreenColumn(barrel, ROW);
    const right = lastScreenColumn(barrel, ROW) + 1;
    expect(Math.abs(left - HAND_LEFT_EDGE)).toBeLessThanOrEqual(1);
    expect(Math.abs(right - HAND_RIGHT_EDGE)).toBeLessThanOrEqual(1);
    // The undistorted edge sits 1.28 px from the hand value, so this check fails if the lens does nothing.
    expect(Math.abs(firstScreenColumn(plain, ROW) - HAND_LEFT_EDGE)).toBeGreaterThan(1);
  });

  it('decentring p2 = +0.05 slides the picture right, and -0.05 slides it left', () => {
    const plain = capture();
    const rightward = capture({ k1: 0, p2: 0.05 });
    const leftward = capture({ k1: 0, p2: -0.05 });
    const centreOf = (image: RgbaImage): number => (firstScreenColumn(image, ROW) + lastScreenColumn(image, ROW)) / 2;
    expect(centreOf(rightward)).toBeGreaterThan(centreOf(plain) + 3);
    expect(centreOf(leftward)).toBeLessThan(centreOf(plain) - 3);
  });

  it('decentring p2 moves both sides of the screen by the same amount, 3 p2 u² s = 5.36 px at p2 = 0.05', () => {
    // On row 37, v is about 0.02, so the x offset p2 (r² + 2 u²) is about p2 (3 u²) at both edges. It is even in u,
    // so the left and right edges move by the same amount: 3 × 0.05 × 0.5106 × 69.97 = 5.36 px.
    const HAND_SHIFT = 5.36;
    const plain = capture();
    const rightward = capture({ k1: 0, p2: 0.05 });
    const leftward = capture({ k1: 0, p2: -0.05 });
    const leftShift = firstScreenColumn(rightward, ROW) - firstScreenColumn(plain, ROW);
    const rightShift = lastScreenColumn(rightward, ROW) - lastScreenColumn(plain, ROW);
    expect(Math.abs(leftShift - HAND_SHIFT)).toBeLessThanOrEqual(1);
    expect(Math.abs(rightShift - HAND_SHIFT)).toBeLessThanOrEqual(1);
    expect(Math.abs(leftShift - rightShift)).toBeLessThanOrEqual(1);
    const leftwardLeft = firstScreenColumn(leftward, ROW) - firstScreenColumn(plain, ROW);
    const leftwardRight = lastScreenColumn(leftward, ROW) - lastScreenColumn(plain, ROW);
    expect(Math.abs(leftwardLeft + HAND_SHIFT)).toBeLessThanOrEqual(1);
    expect(Math.abs(leftwardRight + HAND_SHIFT)).toBeLessThanOrEqual(1);
  });

  it('decentring p2 = -0.05 leaves the top and bottom edges on column 61 where they were', () => {
    // Column 61 sits one pixel from the black cross. Moving the picture right carries the cross onto
    // column 61's neighbourhood and blurs the edge, so only the leftward shift is checked here.
    // The vertical offset p2 (2 u v) is zero at u = 0, and it is tiny at column 61.
    const plain = capture();
    const leftward = capture({ k1: 0, p2: -0.05 });
    expect(firstScreenRow(leftward, COL)).toBe(firstScreenRow(plain, COL));
    expect(lastScreenRow(leftward, COL)).toBe(lastScreenRow(plain, COL));
  });

  it('decentring p1 = +0.05 slides the picture down, and -0.05 slides it up', () => {
    const plain = capture();
    const down = capture({ k1: 0, p1: 0.05 });
    const up = capture({ k1: 0, p1: -0.05 });
    const centreOf = (image: RgbaImage): number => (firstScreenRow(image, COL) + lastScreenRow(image, COL)) / 2;
    expect(centreOf(down)).toBeGreaterThan(centreOf(plain) + 1);
    expect(centreOf(up)).toBeLessThan(centreOf(plain) - 1);
  });

  it('decentring p1 moves the top and bottom edges by the same amount, 3 p1 v² s = 1.93 px at p1 = 0.05', () => {
    // Column 61 is at u ≈ 0, so the vertical offset p1 (r² + 2 v²) is about p1 (3 v²). The top and bottom
    // edges sit at v = ±30 / s, so v² = 900 / 4896 = 0.1838, and 3 × 0.05 × 0.1838 × 69.97 = 1.93 px.
    const HAND_SHIFT = 1.93;
    const plain = capture();
    const down = capture({ k1: 0, p1: 0.05 });
    const topShift = firstScreenRow(down, COL) - firstScreenRow(plain, COL);
    const bottomShift = lastScreenRow(down, COL) - lastScreenRow(plain, COL);
    expect(Math.abs(topShift - HAND_SHIFT)).toBeLessThanOrEqual(1);
    expect(Math.abs(bottomShift - HAND_SHIFT)).toBeLessThanOrEqual(1);
    expect(Math.abs(topShift - bottomShift)).toBeLessThanOrEqual(1);
  });

  it('decentring p1 = -0.05 leaves the left and right edges on row 37 where they were', () => {
    // Row 37 is one row from the black horizontal cross, so a downward shift would blur it. The upward shift is checked
    // because it keeps the cross away from row 37.
    const plain = capture();
    const up = capture({ k1: 0, p1: -0.05 });
    expect(firstScreenColumn(up, ROW)).toBe(firstScreenColumn(plain, ROW));
    expect(lastScreenColumn(up, ROW)).toBe(lastScreenColumn(plain, ROW));
  });
});
