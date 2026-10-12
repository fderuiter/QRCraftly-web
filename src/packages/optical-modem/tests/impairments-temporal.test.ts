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
import { loadOpticalModem, simulateCapture, type CaptureOptions, type RgbaImage } from '../index';

const FRAME = 60;

beforeAll(() => loadOpticalModem());

const BASE: CaptureOptions = { pixelsPerCell: 1, cellPitch: 1, tearFraction: 1 };

/** A flat frame of one colour, RGBA with full alpha. */
function flat(width: number, height: number, rgb: readonly [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function grey(value: number): RgbaImage {
  return flat(FRAME, FRAME, [value, value, value]);
}

/** The colour at the centre of a camera image, which always lies on the screen. */
function centre(image: RgbaImage): [number, number, number] {
  const at = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
  return [image.data[at], image.data[at + 1], image.data[at + 2]];
}

function expectNear(actual: number, expected: number, tolerance = 1): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

describe('optical modem frame blending', () => {
  const black = flat(FRAME, FRAME, [0, 0, 0]);
  const white = flat(FRAME, FRAME, [255, 255, 255]);

  it('mixes black and white as sRGB values when linear light is off', () => {
    const image = simulateCapture(black, 'ideal', { ...BASE, next: white, impairments: { blend: 0.5, linearLight: false } });
    expectNear(centre(image)[0], 128);
  });

  it('mixes black and white as light when linear light is on', () => {
    const image = simulateCapture(black, 'ideal', { ...BASE, next: white, impairments: { blend: 0.5, linearLight: true } });
    // Half the light of white is sRGB 187.5, not 128.
    expectNear(centre(image)[0], 188);
  });

  it('mixes a quarter of white as light, not as sRGB values', () => {
    const image = simulateCapture(black, 'ideal', { ...BASE, next: white, impairments: { blend: 0.25, linearLight: true } });
    // A quarter of the light of white is sRGB 137; as sRGB values it would be 64.
    expectNear(centre(image)[0], 137);
  });

  it('a blend of 0 gives the same capture as one without the next frame', () => {
    const frame = flat(FRAME, FRAME, [40, 120, 200]);
    const nextFrame = flat(FRAME, FRAME, [220, 30, 90]);
    const withoutNext = simulateCapture(frame, 'ideal', { ...BASE });
    const withBlendZero = simulateCapture(frame, 'ideal', { ...BASE, next: nextFrame, impairments: { blend: 0 } });
    expect(withBlendZero.data).toEqual(withoutNext.data);
  });

  it.each([false, true])('blending a colour with itself leaves it unchanged (linear light %s)', (linearLight) => {
    const colour = flat(FRAME, FRAME, [200, 90, 30]);
    const image = simulateCapture(colour, 'ideal', { ...BASE, next: colour, impairments: { blend: 0.5, linearLight } });
    const [r, g, b] = centre(image);
    expectNear(r, 200);
    expectNear(g, 90);
    expectNear(b, 30);
  });
});

describe('optical modem temporal noise reduction', () => {
  it('pulls a small change towards the previous capture', () => {
    const previous = simulateCapture(grey(100), 'ideal', { ...BASE });
    const image = simulateCapture(grey(104), 'ideal', {
      ...BASE,
      impairments: { temporal: { previous, weight: 0.5 } },
    });
    // Luma moves by 4 levels, so the weight is 0.5 * (1 - 4 / 24): 104 * 0.583 + 100 * 0.417, about 102.3.
    const [r] = centre(image);
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(104);
    expectNear(r, 102);
  });

  it('ignores the previous capture where the change is large', () => {
    const previous = simulateCapture(grey(100), 'ideal', { ...BASE });
    const image = simulateCapture(grey(200), 'ideal', {
      ...BASE,
      impairments: { temporal: { previous, weight: 0.5 } },
    });
    expectNear(centre(image)[0], 200);
  });

  it('with weight 0 gives exactly the capture without noise reduction', () => {
    const previous = simulateCapture(grey(100), 'ideal', { ...BASE });
    const plain = simulateCapture(grey(104), 'ideal', { ...BASE });
    const withZeroWeight = simulateCapture(grey(104), 'ideal', {
      ...BASE,
      impairments: { temporal: { previous, weight: 0 } },
    });
    expect(withZeroWeight.data).toEqual(plain.data);
  });

  it('rejects a previous image of a different size', () => {
    const previous = simulateCapture(grey(100), 'ideal', { pixelsPerCell: 2, cellPitch: 1, tearFraction: 1 });
    expect(() =>
      simulateCapture(grey(104), 'ideal', {
        ...BASE,
        impairments: { temporal: { previous, weight: 0.5 } },
      })
    ).toThrow(/previous image/);
  });
});
