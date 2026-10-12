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
import { loadOpticalModem, simulateCapture, type RgbaImage } from '../index';

beforeAll(() => loadOpticalModem());

type Rgb = [number, number, number];

/** A 80 x 40 frame; with the ideal camera the frame sits at camera columns 8 to 87 and rows 4 to 43. */
const WIDTH = 80;
const HEIGHT = 40;
/** Camera column of the frame's vertical edge at frame x = 40. */
const EDGE = 48;
/** Camera row used for the horizontal scans. */
const ROW = 24;
const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];

function image(width: number, height: number, pixelAt: (x: number, y: number) => Rgb): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelAt(x, y);
      const at = (y * width + x) * 4;
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = 255;
    }
  }
  return { width, height, data };
}

function pixel(img: RgbaImage, x: number, y: number): Rgb {
  const at = (y * img.width + x) * 4;
  return [img.data[at], img.data[at + 1], img.data[at + 2]];
}

function luma([r, g, b]: Rgb): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Largest per-byte difference between two captures of the same size. */
function maxDiff(a: RgbaImage, b: RgbaImage): number {
  expect(b.data.length).toBe(a.data.length);
  let worst = 0;
  for (let i = 0; i < a.data.length; i++) worst = Math.max(worst, Math.abs(a.data[i] - b.data[i]));
  return worst;
}

/** Captures a frame with the ideal camera, with chroma noise reduction of `chromaPasses` passes, or none when omitted. */
function capture(frame: RgbaImage, chromaPasses?: number): RgbaImage {
  const options = chromaPasses === undefined ? { pixelsPerCell: 1, cellPitch: 1 } : { pixelsPerCell: 1, cellPitch: 1, impairments: { chromaPasses } };
  return simulateCapture(frame, 'ideal', options);
}

describe('chroma noise reduction in the channel simulator', () => {
  it('does nothing with zero passes', () => {
    const frame = image(WIDTH, HEIGHT, (x) => (x < WIDTH / 2 ? RED : BLUE));
    expect(capture(frame, 0).data).toEqual(capture(frame).data);
  });

  it('leaves a grey image unchanged (within rounding), bezel included', () => {
    const frame = image(WIDTH, HEIGHT, (x, y) => {
      const v = 20 + 2 * x + y;
      return [v, v, v];
    });
    expect(maxDiff(capture(frame, 3), capture(frame))).toBeLessThanOrEqual(1);
  });

  it('keeps the colour of a flat area far from the edges (within rounding)', () => {
    const colour: Rgb = [200, 90, 40];
    const frame = image(WIDTH, HEIGHT, () => colour);
    const out = capture(frame, 3);
    // Three passes reach three pixels; the frame edge sits 8 pixels from the camera edge, so these margins keep clear of it.
    for (let y = 12; y < 36; y++) {
      for (let x = 16; x < 80; x++) {
        const [r, g, b] = pixel(out, x, y);
        expect(Math.abs(r - colour[0])).toBeLessThanOrEqual(1);
        expect(Math.abs(g - colour[1])).toBeLessThanOrEqual(1);
        expect(Math.abs(b - colour[2])).toBeLessThanOrEqual(1);
      }
    }
  });

  it('smears a sharp red|blue colour edge, more with more passes', () => {
    const frame = image(WIDTH, HEIGHT, (x) => (x < WIDTH / 2 ? RED : BLUE));
    // Columns whose blue-minus-red is well short of pure red (-255) or pure blue (+255): the colour is mixing.
    const mixedColumns = (img: RgbaImage): number => {
      let count = 0;
      for (let x = EDGE - 12; x < EDGE + 12; x++) {
        const [r, , b] = pixel(img, x, ROW);
        if (Math.abs(b - r) < 250) count++;
      }
      return count;
    };
    const none = mixedColumns(capture(frame));
    const one = mixedColumns(capture(frame, 1));
    const three = mixedColumns(capture(frame, 3));
    expect(one).toBeGreaterThan(none);
    expect(three).toBeGreaterThan(one);

    // Two columns left of the edge is pure red without noise reduction; three passes reach it and make it bluer.
    const [rawR, , rawB] = pixel(capture(frame), EDGE - 2, ROW);
    const [smearR, , smearB] = pixel(capture(frame, 3), EDGE - 2, ROW);
    expect(smearB - smearR).toBeGreaterThan(rawB - rawR + 40);
  });

  it('keeps each pixel luma within two levels of the capture without noise reduction', () => {
    // Luma is exact before the caller clamps. Fully saturated red|blue pushes G below zero at the edge, and that clip
    // moves luma by about 5 to 7 levels, so this uses a mid-saturation pair where the clamp never bites.
    const frame = image(WIDTH, HEIGHT, (x) => (x < WIDTH / 2 ? [200, 80, 60] : [60, 80, 200]));
    const raw = capture(frame);
    for (const passes of [1, 3]) {
      const out = capture(frame, passes);
      for (let y = 0; y < out.height; y++) {
        for (let x = 0; x < out.width; x++) {
          expect(Math.abs(luma(pixel(out, x, y)) - luma(pixel(raw, x, y)))).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('keeps a black|white luma edge sharp (within rounding)', () => {
    const frame = image(WIDTH, HEIGHT, (x) => (x < WIDTH / 2 ? [0, 0, 0] : [255, 255, 255]));
    expect(maxDiff(capture(frame, 3), capture(frame))).toBeLessThanOrEqual(1);
    // The edge itself stays a step between two levels: the pixels either side of it hold the extremes.
    const out = capture(frame, 3);
    expect(pixel(out, EDGE - 6, ROW)[0]).toBeLessThanOrEqual(1);
    expect(pixel(out, EDGE + 6, ROW)[0]).toBeGreaterThanOrEqual(254);
  });
});
