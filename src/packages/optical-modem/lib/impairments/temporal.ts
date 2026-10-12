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

/** Newton steps for the fifth root; from a start of 1 they converge well within this for any input in 0 to 1. */
const FIFTH_ROOT_STEPS = 40;

/** Linear light of each sRGB value 0 to 255, built on first use. */
let linearTable: Float64Array | null = null;

/**
 * x to the power 2.4 for x in 0 to 1, without Math.pow: x^2.4 = a * a^(1/5) with a = x * x, and the
 * fifth root by Newton's method on y^5 - a (y starts at 1, which lies above the root, so it falls onto it).
 * @param x - A value from 0 to 1.
 * @returns x^2.4.
 */
function powTwoPointFour(x: number): number {
  const a = x * x;
  if (a === 0) return 0;
  let y = 1;
  for (let step = 0; step < FIFTH_ROOT_STEPS; step++) {
    const y4 = y * y * y * y;
    y = y - (y * y4 - a) / (5 * y4);
  }
  return a * y;
}

/**
 * The 256-entry table of linear light, built once from the sRGB transfer function.
 * @returns LINEAR[i] is the linear light of sRGB value i; strictly increasing from 0 to 1.
 */
function linearTableOf(): Float64Array {
  if (linearTable === null) {
    const table = new Float64Array(256);
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      table[i] = v <= 0.04045 ? v / 12.92 : powTwoPointFour((v + 0.055) / 1.055);
    }
    linearTable = table;
  }
  return linearTable;
}

/**
 * The sRGB transfer function, for mixing light the way a sensor does. Uses a table and only
 * additions, multiplications and divisions, so results are the same on every engine.
 * @param value - An sRGB value, 0 to 255 (fractions are interpolated between the table entries).
 * @returns Linear light, 0 to 1.
 */
export function toLinear(value: number): number {
  const table = linearTableOf();
  const v = Math.min(255, Math.max(0, value));
  const lo = Math.floor(v);
  const hi = Math.min(255, lo + 1);
  const frac = v - lo;
  return table[lo] * (1 - frac) + table[hi] * frac;
}

/**
 * Inverse of {@link toLinear}: a binary search for the bracketing table entries, then linear interpolation.
 * @param light - Linear light, 0 to 1 (values outside are clamped).
 * @returns An sRGB value, 0 to 255.
 */
export function fromLinear(light: number): number {
  const table = linearTableOf();
  const target = Math.min(1, Math.max(0, light));
  // Find the largest index whose entry is at most the target; the table is strictly increasing.
  let lo = 0;
  let hi = 255;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (table[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  if (lo >= 255) return 255;
  return lo + (target - table[lo]) / (table[lo + 1] - table[lo]);
}

/**
 * Mixes two sRGB values as light: what a pixel records when its exposure spans two screen frames.
 * @param a - The first value, 0 to 255.
 * @param b - The second value, 0 to 255.
 * @param t - The share of the exposure that sees b, 0 to 1.
 * @returns The recorded sRGB value.
 */
export function mixLinear(a: number, b: number, t: number): number {
  return fromLinear(toLinear(a) * (1 - t) + toLinear(b) * t);
}

/** A phone ISP's temporal noise reduction: a blend with the previous output, held back where they differ. */
export interface TemporalNoiseReduction {
  /** The previous captured image, the same size. */
  previous: { width: number; height: number; data: Uint8ClampedArray };
  /** Weight of the previous image where it matches (0 to 1; phones use about 0.3 to 0.7). */
  weight: number;
  /** Difference in 8-bit levels (luma) above which the previous image is not used (default 24). */
  threshold?: number;
}

/**
 * Luma (BT.601) of an RGB triple.
 * @param r - Red, 0 to 255.
 * @param g - Green, 0 to 255.
 * @param b - Blue, 0 to 255.
 * @returns Luma, 0 to 255.
 */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Blends the previous output into RGB planes in place. Each pixel takes the previous image's
 * weight scaled down by how far its luma moved: `weight * max(0, 1 - d / threshold)`.
 * @param planes - Red, green and blue planes, 0 to 255.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param tnr - The settings.
 * @throws If the previous image is not `width` by `height` RGBA.
 */
export function denoiseTemporal(planes: Float32Array[], width: number, height: number, tnr: TemporalNoiseReduction): void {
  const { previous } = tnr;
  if (previous.width !== width || previous.height !== height || previous.data.length !== width * height * 4) {
    throw new Error(`Temporal noise reduction needs a ${width}x${height} previous image, got ${previous.width}x${previous.height}`);
  }
  const threshold = tnr.threshold ?? 24;
  const weight = Math.min(1, Math.max(0, tnr.weight));
  const [red, green, blue] = planes;
  const old = previous.data;
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const r = red[i];
    const g = green[i];
    const b = blue[i];
    const pr = old[p];
    const pg = old[p + 1];
    const pb = old[p + 2];
    const d = Math.abs(luma(r, g, b) - luma(pr, pg, pb));
    // A threshold of zero or less means the previous image is never used.
    const w = d < threshold ? weight * (1 - d / threshold) : 0;
    red[i] = r * (1 - w) + pr * w;
    green[i] = g * (1 - w) + pg * w;
    blue[i] = b * (1 - w) + pb * w;
  }
}
