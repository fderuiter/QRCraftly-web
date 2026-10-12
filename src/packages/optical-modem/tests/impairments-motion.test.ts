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

/*
 * With the 'ideal' channel at one camera pixel per frame pixel, a 100 x 60 frame sits centred in a
 * 120 x 72 camera image: screen columns 10 to 109 and rows 6 to 65. Camera pixel (x, y) covers
 * [x, x + 1) x [y, y + 1), so the centre of the camera is (60, 36) and a pixel's centre is at +0.5.
 * Measurements use the darkness-weighted centroid of the line within a window, compared against an
 * unmoved capture of the same frame, so the sampling offsets of the channel cancel out.
 */
const FRAME_WIDTH = 100;
const FRAME_HEIGHT = 60;
const LINE_COLUMN = 50; // camera column 60, the centre column
const LINE_ROW = 20; // camera row 26, above the centre row
const CENTRE_X = 60;
const CENTRE_Y = 36;
const WINDOW = 8;

/** A white frame with one black column. */
function verticalLine(column: number): RgbaImage {
  const data = new Uint8ClampedArray(FRAME_WIDTH * FRAME_HEIGHT * 4).fill(255);
  for (let y = 0; y < FRAME_HEIGHT; y++) {
    const at = (y * FRAME_WIDTH + column) * 4;
    data[at] = 0;
    data[at + 1] = 0;
    data[at + 2] = 0;
  }
  return { width: FRAME_WIDTH, height: FRAME_HEIGHT, data };
}

/** A white frame with one black row. */
function horizontalLine(row: number): RgbaImage {
  const data = new Uint8ClampedArray(FRAME_WIDTH * FRAME_HEIGHT * 4).fill(255);
  for (let x = 0; x < FRAME_WIDTH; x++) {
    const at = (row * FRAME_WIDTH + x) * 4;
    data[at] = 0;
    data[at + 1] = 0;
    data[at + 2] = 0;
  }
  return { width: FRAME_WIDTH, height: FRAME_HEIGHT, data };
}

/** Darkness-weighted centre of a vertical line crossing camera row `row` near column `around`. */
function columnCentroid(image: RgbaImage, row: number, around: number): number {
  let total = 0;
  let weighted = 0;
  for (let x = around - WINDOW; x <= around + WINDOW; x++) {
    const darkness = 255 - image.data[(row * image.width + x) * 4];
    total += darkness;
    weighted += darkness * (x + 0.5);
  }
  return weighted / total;
}

/** Darkness-weighted centre of a horizontal line crossing camera column `column` near row `around`. */
function rowCentroid(image: RgbaImage, column: number, around: number): number {
  let total = 0;
  let weighted = 0;
  for (let y = around - WINDOW; y <= around + WINDOW; y++) {
    const darkness = 255 - image.data[(y * image.width + column) * 4];
    total += darkness;
    weighted += darkness * (y + 0.5);
  }
  return weighted / total;
}

type Motion = NonNullable<CameraImpairments['motion']>;

function capture(frame: RgbaImage, motion?: Motion): RgbaImage {
  return simulateCapture(frame, 'ideal', {
    pixelsPerCell: 1,
    cellPitch: 1,
    impairments: motion === undefined ? undefined : { motion },
  });
}

beforeAll(() => loadOpticalModem());

describe('rolling-shutter and stabiliser motion', () => {
  it('empty motion equals no impairment exactly', () => {
    const frame = verticalLine(LINE_COLUMN);
    const plain = capture(frame);
    const withEmpty = capture(frame, {});
    expect(withEmpty.width).toBe(plain.width);
    expect(withEmpty.height).toBe(plain.height);
    expect(withEmpty.data).toEqual(plain.data);
  });

  it('shiftX moves the line by that many columns everywhere', () => {
    const frame = verticalLine(LINE_COLUMN);
    const still = capture(frame);
    const moved = capture(frame, { shiftX: 5 });
    for (const row of [8, 20, 36, 52, 64]) {
      expect(columnCentroid(moved, row, CENTRE_X) - columnCentroid(still, row, CENTRE_X)).toBeCloseTo(5, 2);
    }
    // Content at camera column 60 now appears at column 65: the darkest column near the line moves by 5.
    const darkest = (image: RgbaImage, row: number): number => {
      let best = CENTRE_X - WINDOW;
      for (let x = CENTRE_X - WINDOW; x <= CENTRE_X + WINDOW; x++) {
        if (image.data[(row * image.width + x) * 4] < image.data[(row * image.width + best) * 4]) best = x;
      }
      return best;
    };
    expect(darkest(still, 36)).toBe(CENTRE_X);
    expect(darkest(moved, 36)).toBe(CENTRE_X + 5);
  });

  it('shear slants a vertical line by shear times the rows between, with the centre rows barely moved', () => {
    const frame = verticalLine(LINE_COLUMN);
    const still = capture(frame);
    const sheared = capture(frame, { shear: 0.2 });
    // A row's pixel centre is at r + 0.5, so its shift is shear * (r + 0.5 - cy).
    const shiftAt = (row: number): number => columnCentroid(sheared, row, CENTRE_X) - columnCentroid(still, row, CENTRE_X);
    expect(shiftAt(8)).toBeCloseTo(0.2 * (8.5 - CENTRE_Y), 1);
    expect(shiftAt(64)).toBeCloseTo(0.2 * (64.5 - CENTRE_Y), 1);
    // The top and bottom rows differ by shear times the rows between them.
    expect(shiftAt(64) - shiftAt(8)).toBeCloseTo(0.2 * (64 - 8), 1);
    // The rows straddling the centre hardly move (under a tenth of a pixel).
    expect(Math.abs(shiftAt(35))).toBeLessThan(0.1);
    expect(Math.abs(shiftAt(36))).toBeLessThan(0.15);
    // Rows below the centre move right, rows above move left.
    expect(shiftAt(64)).toBeGreaterThan(0);
    expect(shiftAt(8)).toBeLessThan(0);
  });

  it('stretch moves a horizontal line above the centre away from the centre', () => {
    const frame = horizontalLine(LINE_ROW);
    const still = capture(frame);
    const stretched = capture(frame, { stretch: 0.1 });
    // Content at row 26.5 (the line's mid-line) appears at 36 + (26.5 - 36) / (1 - 0.1), about 25.44.
    const expected = CENTRE_Y + (26.5 - CENTRE_Y) / (1 - 0.1);
    const measured = rowCentroid(stretched, CENTRE_X, 26);
    expect(measured).toBeCloseTo(expected, 1);
    expect(measured).toBeLessThan(rowCentroid(still, CENTRE_X, 26));
  });

  it('negative stretch moves a horizontal line above the centre toward the centre', () => {
    const frame = horizontalLine(LINE_ROW);
    const still = capture(frame);
    const squashed = capture(frame, { stretch: -0.1 });
    const expected = CENTRE_Y + (26.5 - CENTRE_Y) / (1 + 0.1);
    const measured = rowCentroid(squashed, CENTRE_X, 26);
    expect(measured).toBeCloseTo(expected, 1);
    expect(measured).toBeGreaterThan(rowCentroid(still, CENTRE_X, 26));
  });

  it('a small rotation moves the top and bottom of a vertical line in opposite directions', () => {
    const frame = verticalLine(LINE_COLUMN);
    const still = capture(frame);
    const turned = capture(frame, { rotation: 0.02 });
    const top = columnCentroid(turned, 8, CENTRE_X) - columnCentroid(still, 8, CENTRE_X);
    const bottom = columnCentroid(turned, 64, CENTRE_X) - columnCentroid(still, 64, CENTRE_X);
    // A rotation of 2 * atan(0.02), about 0.04 rad, moves the top row (about 27 rows above the centre) right by about 1.1 px.
    // The bottom row, about 28 rows below, moves left by about the same amount.
    expect(top).toBeGreaterThan(0.9);
    expect(top).toBeLessThan(1.3);
    expect(bottom).toBeLessThan(-0.9);
    expect(bottom).toBeGreaterThan(-1.3);
  });

  it('shiftY moves a horizontal line down by that many rows everywhere', () => {
    const frame = horizontalLine(LINE_ROW);
    const still = capture(frame);
    const moved = capture(frame, { shiftY: 5 });
    for (const column of [30, 45, CENTRE_X, 75, 90]) {
      const shift = rowCentroid(moved, column, 26) - rowCentroid(still, column, 26);
      expect(Math.abs(shift - 5)).toBeLessThanOrEqual(0.1);
    }
  });

  it('a small rotation moves the left and right ends of a horizontal centre-row line in opposite vertical directions', () => {
    // Frame row 30 is camera row 36, the centre row. The JSDoc says the top of a vertical line moves right under a
    // positive rotation, so the picture turns clockwise on screen: the right end of a horizontal line moves down and the
    // left end moves up. Each end is about 30 columns from the centre, so about 30 * 2 * 0.02 = 1.2 px.
    const frame = horizontalLine(CENTRE_Y - 6);
    const still = capture(frame);
    const turned = capture(frame, { rotation: 0.02 });
    const leftEnd = rowCentroid(turned, 30, CENTRE_Y) - rowCentroid(still, 30, CENTRE_Y);
    const rightEnd = rowCentroid(turned, 90, CENTRE_Y) - rowCentroid(still, 90, CENTRE_Y);
    expect(leftEnd).toBeLessThan(-0.9);
    expect(leftEnd).toBeGreaterThan(-1.5);
    expect(rightEnd).toBeGreaterThan(0.9);
    expect(rightEnd).toBeLessThan(1.5);
  });
});
