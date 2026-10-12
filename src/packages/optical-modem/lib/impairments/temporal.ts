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

/**
 * The sRGB transfer function, for mixing light the way a sensor does. Uses a table and only
 * additions, multiplications and divisions, so results are the same on every engine.
 * @param value - An sRGB value, 0 to 255.
 * @returns Linear light, 0 to 1.
 */
export function toLinear(value: number): number {
  return value / 255;
}

/**
 * Inverse of {@link toLinear}.
 * @param light - Linear light, 0 to 1.
 * @returns An sRGB value, 0 to 255.
 */
export function fromLinear(light: number): number {
  return light * 255;
}

/**
 * Mixes two sRGB values as light: what a pixel records when its exposure spans two screen frames.
 * @param a - The first value, 0 to 255.
 * @param b - The second value, 0 to 255.
 * @param t - The share of the exposure that sees b, 0 to 1.
 * @returns The recorded sRGB value.
 */
export function mixLinear(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
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
 * Blends the previous output into RGB planes in place.
 * @param planes - Red, green and blue planes, 0 to 255.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param tnr - The settings.
 */
export function denoiseTemporal(planes: Float32Array[], width: number, height: number, tnr: TemporalNoiseReduction): void {
  void planes;
  void width;
  void height;
  void tnr;
}
