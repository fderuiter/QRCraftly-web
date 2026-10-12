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
 * Blurs a plane in place with a separable [1 2 1] / 4 kernel, repeating the edge pixels: 1 pass is a
 * deviation of 0.7 px, 2 is 1.0 px, 4 is 1.4 px.
 * @param plane - The plane, row by row.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param passes - Number of passes.
 */
export function blurPlane(plane: Float32Array, width: number, height: number, passes: number): void {
  const tmp = new Float32Array(plane.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = y * width + x;
        tmp[at] = 0.25 * plane[at - (x > 0 ? 1 : 0)] + 0.5 * plane[at] + 0.25 * plane[at + (x < width - 1 ? 1 : 0)];
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = y * width + x;
        plane[at] = 0.25 * tmp[at - (y > 0 ? width : 0)] + 0.5 * tmp[at] + 0.25 * tmp[at + (y < height - 1 ? width : 0)];
      }
    }
  }
}
