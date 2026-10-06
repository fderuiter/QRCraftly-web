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

/** An 8-bit sRGB colour. */
export type Rgb = readonly [number, number, number];
/** A colour in OKLab: lightness, then the green-red and blue-yellow axes. The modem module converts to it. */
export type Lab = readonly [number, number, number];

/**
 * Euclidean distance between two OKLab colours, for the probe report.
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
