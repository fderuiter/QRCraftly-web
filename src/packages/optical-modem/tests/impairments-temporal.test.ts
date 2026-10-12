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
    // Luma moves by 4 levels, so the weight is 0.5 * (1 - 4 / 24) = 5/12: 104 * 7/12 + 100 * 5/12 = 102.33, which rounds to 102.
    expect(centre(image)[0]).toBe(102);
  });

  it('tapers the blend as the change grows, so a change of 16 levels keeps only a third of the weight', () => {
    const previous = simulateCapture(grey(100), 'ideal', { ...BASE });
    const image = simulateCapture(grey(116), 'ideal', {
      ...BASE,
      impairments: { temporal: { previous, weight: 0.5 } },
    });
    // The weight is 0.5 * (1 - 16 / 24) = 1/6: 116 * 5/6 + 100 * 1/6 = 113.33, which rounds to 113.
    expect(centre(image)[0]).toBe(113);
  });

  it('clamps the weight to 0 to 1, so a weight of 1.5 gives the same capture as 1 and a negative weight the same as 0', () => {
    const previous = simulateCapture(grey(100), 'ideal', { ...BASE });
    const plain = simulateCapture(grey(104), 'ideal', { ...BASE });
    const weightOne = simulateCapture(grey(104), 'ideal', {
      ...BASE,
      impairments: { temporal: { previous, weight: 1 } },
    });
    const weightOverOne = simulateCapture(grey(104), 'ideal', {
      ...BASE,
      impairments: { temporal: { previous, weight: 1.5 } },
    });
    const weightBelowZero = simulateCapture(grey(104), 'ideal', {
      ...BASE,
      impairments: { temporal: { previous, weight: -0.5 } },
    });
    expect(weightOverOne.data).toEqual(weightOne.data);
    expect(weightBelowZero.data).toEqual(plain.data);
  });

  it('with threshold 0 never uses the previous capture, so gives the capture without noise reduction', () => {
    const previous = simulateCapture(grey(100), 'ideal', { ...BASE });
    const plain = simulateCapture(grey(104), 'ideal', { ...BASE });
    const withZeroThreshold = simulateCapture(grey(104), 'ideal', {
      ...BASE,
      impairments: { temporal: { previous, weight: 0.5, threshold: 0 } },
    });
    expect(withZeroThreshold.data).toEqual(plain.data);
    // Even where the previous capture matches exactly, a threshold of 0 must not blend.
    const same = simulateCapture(grey(104), 'ideal', { ...BASE });
    const sameWithZeroThreshold = simulateCapture(grey(104), 'ideal', {
      ...BASE,
      impairments: { temporal: { previous: same, weight: 0.5, threshold: 0 } },
    });
    expect(sameWithZeroThreshold.data).toEqual(same.data);
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
