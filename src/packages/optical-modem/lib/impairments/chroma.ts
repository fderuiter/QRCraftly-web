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

import { blurPlane } from './blur';

/**
 * A phone ISP's chroma noise reduction: blurs the colour-difference signals (BT.601 Cb and Cr)
 * and keeps luma, so colour edges smear while brightness edges stay sharp. Works in place.
 * The output is not clamped; the caller clamps to 0 to 255.
 * @param planes - Red, green and blue planes, 0 to 255.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param passes - Passes of a [1 2 1] / 4 blur on Cb and Cr; 0 leaves the planes alone.
 */
export function denoiseChroma(planes: Float32Array[], width: number, height: number, passes: number): void {
  if (passes <= 0) return;
  const size = width * height;
  const luma = new Float32Array(size);
  const cb = new Float32Array(size);
  const cr = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const red = planes[0][i];
    const green = planes[1][i];
    const blue = planes[2][i];
    const y = 0.299 * red + 0.587 * green + 0.114 * blue;
    luma[i] = y;
    cb[i] = (blue - y) * 0.564;
    cr[i] = (red - y) * 0.713;
  }
  blurPlane(cb, width, height, passes);
  blurPlane(cr, width, height, passes);
  for (let i = 0; i < size; i++) {
    const y = luma[i];
    const red = y + cr[i] / 0.713;
    const blue = y + cb[i] / 0.564;
    planes[0][i] = red;
    planes[1][i] = (y - 0.299 * red - 0.114 * blue) / 0.587;
    planes[2][i] = blue;
  }
}

