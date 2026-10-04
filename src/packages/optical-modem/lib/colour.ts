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

import { cubeRoot, srgbToLinear } from './math';

/** An 8-bit sRGB colour. */
export type Rgb = readonly [number, number, number];
/** A colour in OKLab: lightness, then the green-red and blue-yellow axes. */
export type Lab = readonly [number, number, number];

/**
 * Converts an sRGB colour to OKLab, the perceptual space the constellations are spaced in.
 * @param rgb - Channels from 0 to 255.
 * @returns The colour in OKLab.
 */
export function rgbToOklab(rgb: Rgb): Lab {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  const l = cubeRoot(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = cubeRoot(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = cubeRoot(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * Euclidean distance between two OKLab colours.
 * @param a - First colour.
 * @param b - Second colour.
 * @returns The distance.
 */
export function labDistance(a: Lab, b: Lab): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/**
 * Integer luma (Rec. 601 weights in 8-bit fixed point).
 * @param r - Red, 0 to 255.
 * @param g - Green, 0 to 255.
 * @param b - Blue, 0 to 255.
 * @returns Luma, 0 to 255.
 */
export function lumaOf(r: number, g: number, b: number): number {
  return (77 * r + 150 * g + 29 * b) >> 8;
}
