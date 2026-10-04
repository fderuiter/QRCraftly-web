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
 * Arithmetic the modem needs, built only from + - * / so that every JavaScript engine produces the
 * same bits. `Math.cbrt` and `Math.pow` are allowed to differ in the last place between engines.
 */

/**
 * Cube root by Newton's method with a fixed iteration count, started above the root so the
 * sequence falls monotonically.
 * @param x - Value, 0 or more.
 * @returns The cube root.
 */
export function cubeRoot(x: number): number {
  if (!(x > 0)) return 0;
  let y = x > 1 ? x : 1;
  for (let i = 0; i < 40; i++) y = (2 * y + x / (y * y)) / 3;
  return y;
}

/**
 * Fifth root by Newton's method with a fixed iteration count.
 * @param x - Value, 0 or more.
 * @returns The fifth root.
 */
function fifthRoot(x: number): number {
  if (!(x > 0)) return 0;
  let y = x > 1 ? x : 1;
  for (let i = 0; i < 60; i++) {
    const y2 = y * y;
    y = (4 * y + x / (y2 * y2)) / 5;
  }
  return y;
}

let linearTable: Float64Array | null = null;

/**
 * The sRGB transfer function (gamma 2.4 with a linear toe) for each 8-bit value.
 * @param value - Channel value from 0 to 255.
 * @returns Linear light from 0 to 1.
 */
export function srgbToLinear(value: number): number {
  if (!linearTable) {
    linearTable = new Float64Array(256);
    for (let i = 0; i < 256; i++) {
      const c = i / 255;
      if (c <= 0.04045) {
        linearTable[i] = c / 12.92;
      } else {
        const a = (c + 0.055) / 1.055;
        // a^2.4 = a^2 * a^(2/5)
        linearTable[i] = a * a * fifthRoot(a * a);
      }
    }
  }
  return linearTable[Math.max(0, Math.min(255, Math.round(value)))];
}
