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

type Pwm = NonNullable<CameraImpairments['pwm']>;

const SIZE = 60;
/** Camera rows and the centre column, well inside the screen (the camera is 72 rows, the screen 60 centred). */
const COLUMN = 36;
const FROM = 16;
const TO = 56;

/** A flat grey square frame, opaque. */
function flat(value: number): RgbaImage {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { width: SIZE, height: SIZE, data };
}

/** Captures the frame through the ideal channel with the given PWM bands (none when omitted). */
function capture(value: number, pwm?: Pwm): RgbaImage {
  return simulateCapture(flat(value), 'ideal', {
    pixelsPerCell: 1,
    cellPitch: 1,
    impairments: pwm ? { pwm } : undefined,
  });
}

/** The red value of each camera row from `from` to `to`, down the centre column. */
function column(img: RgbaImage, from: number, to: number): number[] {
  const values: number[] = [];
  for (let y = from; y < to; y++) values.push(img.data[(y * img.width + COLUMN) * 4]);
  return values;
}

beforeAll(() => loadOpticalModem());

describe('PWM banding through the capture', () => {
  it('leaves the image unchanged when the duty is 1', () => {
    const plain = capture(100);
    const full = capture(100, { period: 10, duty: 1, exposureRows: 2 });
    expect(full.data).toEqual(plain.data);
  });

  it('gives no bands when the exposure is a whole number of periods', () => {
    const values = column(capture(100, { period: 10, duty: 0.5, exposureRows: 20 }), FROM, TO);
    for (const v of values) expect(Math.abs(v - 100)).toBeLessThanOrEqual(1);
  });

  it('bands a short exposure into bright and dark rows with the PWM period, averaging to the flat level', () => {
    const values = column(capture(100, { period: 10, duty: 0.5, exposureRows: 2 }), FROM, TO);
    // The bands repeat every 10 rows.
    for (let i = 0; i + 10 < values.length; i++) expect(Math.abs(values[i] - values[i + 10])).toBeLessThanOrEqual(1);
    // Bright and dark rows both occur (gain 2 and gain 0 on a grey of 100).
    expect(Math.max(...values)).toBeGreaterThan(190);
    expect(Math.min(...values)).toBeLessThan(10);
    // Any whole period averages to the flat level.
    for (let start = 0; start + 10 <= values.length; start++) {
      const mean = values.slice(start, start + 10).reduce((a, b) => a + b, 0) / 10;
      expect(Math.abs(mean - 100)).toBeLessThanOrEqual(2);
    }
  });

  it('clamps a gain above 1 to 255 (a grey of 200 with gain 2 reads 255)', () => {
    const values = column(capture(200, { period: 10, duty: 0.5, exposureRows: 2 }), FROM, TO);
    expect(Math.max(...values)).toBe(255);
    expect(Math.min(...values)).toBeLessThan(10);
  });

  it('shifts the bands down by the phase, in rows', () => {
    const base = capture(100, { period: 10, duty: 0.5, exposureRows: 2 });
    const shifted = capture(100, { period: 10, duty: 0.5, exposureRows: 2, phase: 3 });
    const before = column(base, FROM, TO + 3);
    const after = column(shifted, FROM, TO);
    // Row y with phase 3 sees the exposure that row y + 3 sees without it.
    for (let i = 0; i < after.length; i++) expect(Math.abs(after[i] - before[i + 3])).toBeLessThanOrEqual(1);
    expect(after).not.toEqual(before.slice(0, after.length));
  });

  it('scales the gain by the duty: a window fully inside the lit part of a 25% duty gains 4', () => {
    const values = column(capture(40, { period: 8, duty: 0.25, exposureRows: 2 }), FROM, TO);
    // Each cycle has one 2-row window wholly lit (gain 2 / (2 * 0.25) = 4), so the brightest row is 40 * 4.
    expect(Math.abs(Math.max(...values) - 160)).toBeLessThanOrEqual(1);
    // The gain averages to 1 over a cycle, so every whole cycle averages to the flat level, not twice it.
    for (let start = 0; start + 8 <= values.length; start++) {
      const mean = values.slice(start, start + 8).reduce((a, b) => a + b, 0) / 8;
      expect(Math.abs(mean - 40)).toBeLessThanOrEqual(1);
    }
  });

  it('with no exposure rows, each row is lit for the duty share of the cycle at gain 1 / duty, else dark', () => {
    const values = column(capture(100, { period: 10, duty: 0.5, exposureRows: 0 }), FROM, TO);
    // Every row is either fully lit (100 / 0.5 = 200) or fully dark (0); nothing is at the flat level.
    for (const v of values) expect(Math.min(Math.abs(v - 200), Math.abs(v))).toBeLessThanOrEqual(1);
    expect(Math.max(...values)).toBeGreaterThanOrEqual(199);
    expect(Math.min(...values)).toBeLessThanOrEqual(1);
    // Over 40 rows (four whole cycles) half the rows are lit.
    expect(values.filter((v) => v > 100).length).toBe(values.length / 2);
    // With no phase each cycle starts lit: camera rows 0 to 4 of every 10 are lit, rows 5 to 9 dark.
    for (let i = 0; i < values.length; i++) expect(values[i] > 100).toBe((FROM + i) % 10 < 5);
    // The bands repeat every 10 rows.
    for (let i = 0; i + 10 < values.length; i++) expect(Math.abs(values[i] - values[i + 10])).toBeLessThanOrEqual(1);
  });
});
