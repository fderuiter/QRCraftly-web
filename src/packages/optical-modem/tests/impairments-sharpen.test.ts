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

const WIDTH = 80;
const HEIGHT = 40;
/** Frame column where the step starts; the camera image is shifted by the bezel, so locate it per capture. */
const STEP = 40;

type Rgb = readonly [number, number, number];

/** A frame whose left half is `left` and right half is `right`, with a vertical step at column STEP. */
function stepFrame(left: Rgb, right: Rgb): RgbaImage {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const c = x < STEP ? left : right;
      data.set([c[0], c[1], c[2], 255], (y * WIDTH + x) * 4);
    }
  }
  return { width: WIDTH, height: HEIGHT, data };
}

const grey = (v: number): Rgb => [v, v, v];

/** The step frame, in grey: dark 80 on the left, bright 170 on the right. */
const greyStep = stepFrame(grey(80), grey(170));

function capture(frame: RgbaImage, sharpen?: { amount: number; passes?: number; threshold?: number; clamp?: number }): RgbaImage {
  if (!sharpen) return simulateCapture(frame, 'ideal', { pixelsPerCell: 1, cellPitch: 1 });
  return simulateCapture(frame, 'ideal', { pixelsPerCell: 1, cellPitch: 1, impairments: { sharpen } });
}

/** Red value at a camera pixel. */
function red(img: RgbaImage, x: number, y: number): number {
  return img.data[(y * img.width + x) * 4];
}

/** Camera column of the first bright pixel of the step, found on the unimpaired capture. */
function stepColumn(img: RgbaImage): number {
  const y = Math.floor(img.height / 2);
  for (let x = 1; x < img.width; x++) {
    if (red(img, x - 1, y) < 125 && red(img, x, y) >= 125) return x;
  }
  throw new Error('no step found');
}

interface Region {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The part of the camera image away from the bezel, where the frame's own border does not add detail. */
function interior(img: RgbaImage): Region {
  return { x0: 12, x1: img.width - 12, y0: 8, y1: img.height - 8 };
}

/** Largest per-channel difference between two captures inside a region. */
function maxDiff(a: RgbaImage, b: RgbaImage, region: Region): number {
  let worst = 0;
  for (let y = region.y0; y < region.y1; y++) {
    for (let x = region.x0; x < region.x1; x++) {
      for (let c = 0; c < 3; c++) {
        const i = (y * a.width + x) * 4 + c;
        worst = Math.max(worst, Math.abs(a.data[i] - b.data[i]));
      }
    }
  }
  return worst;
}

let baseline: RgbaImage;
let step: number;
let midRow: number;

beforeAll(async () => {
  await loadOpticalModem();
  baseline = capture(greyStep);
  step = stepColumn(baseline);
  midRow = Math.floor(baseline.height / 2);
});

describe('camera sharpening (ISP unsharp mask)', () => {

  it('amount 0 leaves the capture exactly as it is with no impairment', () => {
    const off = capture(greyStep, { amount: 0 });
    expect(off.width).toBe(baseline.width);
    expect(off.height).toBe(baseline.height);
    expect(off.data).toEqual(baseline.data);
  });

  it('leaves a flat area well away from the step unchanged', () => {
    const sharpened = capture(greyStep, { amount: 2 });
    const left = { x0: 16, x1: step - 8, y0: 12, y1: baseline.height - 12 };
    const right = { x0: step + 8, x1: baseline.width - 16, y0: 12, y1: baseline.height - 12 };
    expect(maxDiff(sharpened, baseline, left)).toBeLessThanOrEqual(1);
    expect(maxDiff(sharpened, baseline, right)).toBeLessThanOrEqual(1);
  });

  it('rings at the step: the dark side gets darker and the bright side brighter', () => {
    const sharpened = capture(greyStep, { amount: 1 });
    // The warp softens the edge over a couple of camera pixels, so check the plateaus and the pixels either side of the edge.
    expect(red(baseline, step - 6, midRow)).toBeCloseTo(80, 0);
    expect(red(baseline, step + 6, midRow)).toBeCloseTo(170, 0);
    expect(red(sharpened, step - 1, midRow)).toBeLessThan(red(baseline, step - 1, midRow));
    expect(red(sharpened, step, midRow)).toBeGreaterThan(red(baseline, step, midRow));
    expect(red(sharpened, step - 6, midRow)).toBeCloseTo(80, 0);
    expect(red(sharpened, step + 6, midRow)).toBeCloseTo(170, 0);
  });

  it('rings more with a larger amount', () => {
    const weak = capture(greyStep, { amount: 0.5 });
    const strong = capture(greyStep, { amount: 2 });
    expect(red(strong, step - 1, midRow)).toBeLessThan(red(weak, step - 1, midRow));
    expect(red(strong, step, midRow)).toBeGreaterThan(red(weak, step, midRow));
  });

  it('clamp limits the change to at most clamp levels', () => {
    const clamp = 5;
    const sharpened = capture(greyStep, { amount: 10, clamp });
    const whole = { x0: 0, x1: baseline.width, y0: 0, y1: baseline.height };
    expect(maxDiff(sharpened, baseline, whole)).toBeLessThanOrEqual(clamp + 1);
    // Unclamped, the step's change would be 10 * 22.5 levels, so the clamp is what binds here.
    expect(Math.abs(red(sharpened, step - 1, midRow) - red(baseline, step - 1, midRow))).toBeGreaterThanOrEqual(clamp - 1);
    expect(Math.abs(red(sharpened, step, midRow) - red(baseline, step, midRow))).toBeGreaterThanOrEqual(clamp - 1);
  });

  it('a threshold above the step detail leaves the image unchanged', () => {
    // The step's detail is about 22.5 levels on either side, so a threshold of 40 cores all of it.
    const sharpened = capture(greyStep, { amount: 2, threshold: 40 });
    expect(maxDiff(sharpened, baseline, interior(baseline))).toBe(0);
  });

  it('coring subtracts the threshold from detail that exceeds it', () => {
    // With amount 1, a threshold of 10 shrinks every change whose detail is over 10 by exactly 10 levels
    // in its own direction. Compare the full and cored captures at the strongest overshoot pixel.
    const full = capture(greyStep, { amount: 1 });
    const cored = capture(greyStep, { amount: 1, threshold: 10 });
    let at = step - 3;
    for (let x = step - 3; x <= step + 3; x++) {
      if (Math.abs(red(full, x, midRow) - red(baseline, x, midRow)) > Math.abs(red(full, at, midRow) - red(baseline, at, midRow))) at = x;
    }
    const fullChange = red(full, at, midRow) - red(baseline, at, midRow);
    const coredChange = red(cored, at, midRow) - red(baseline, at, midRow);
    expect(Math.abs(fullChange)).toBeGreaterThan(10);
    expect(Math.sign(coredChange)).toBe(Math.sign(fullChange));
    expect(Math.abs(fullChange - coredChange - Math.sign(fullChange) * 10)).toBeLessThanOrEqual(1.5);
  });

  it('a pure chroma step at equal luma is barely changed, while a luma step of similar size rings', () => {
    // Both sides have luma 100 (0.299 R + 0.587 G + 0.114 B): the left is neutral and the right is
    // greener and redder, so only the colour differs. Luma differs by about 0.3 levels.
    const chromaFrame = stepFrame(grey(100), [150, 75, 100]);
    const chromaBase = capture(chromaFrame);
    const chromaSharpened = capture(chromaFrame, { amount: 2 });
    expect(maxDiff(chromaSharpened, chromaBase, interior(chromaBase))).toBeLessThanOrEqual(1);

    // Control: a luma step of comparable contrast in the same place does ring visibly.
    const lumaFrame = stepFrame(grey(100), grey(150));
    const lumaBase = capture(lumaFrame);
    const lumaSharpened = capture(lumaFrame, { amount: 2 });
    expect(maxDiff(lumaSharpened, lumaBase, interior(lumaBase))).toBeGreaterThanOrEqual(5);
  });

  it('a negative threshold is treated as 0, so it gives the same capture as threshold 0', () => {
    // Without the clamp, any detail, however small, would jump by the full amount times the threshold at detail 0.
    const zero = capture(greyStep, { amount: 1, threshold: 0 });
    const negative = capture(greyStep, { amount: 1, threshold: -5 });
    expect(negative.data).toEqual(zero.data);
  });

  it('more passes widen the ringing: more columns next to the edge change by over one level', () => {
    const one = capture(greyStep, { amount: 2, passes: 1 });
    const three = capture(greyStep, { amount: 2, passes: 3 });
    const widthOfRinging = (img: RgbaImage): number => {
      let columns = 0;
      for (let x = step - 12; x < step + 12; x++) {
        if (Math.abs(red(img, x, midRow) - red(baseline, x, midRow)) > 1) columns++;
      }
      return columns;
    };
    expect(widthOfRinging(three)).toBeGreaterThan(widthOfRinging(one));
  });
});
