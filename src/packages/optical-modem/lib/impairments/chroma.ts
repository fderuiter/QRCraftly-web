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
  blurChroma(cb, width, height, passes);
  blurChroma(cr, width, height, passes);
  for (let i = 0; i < size; i++) {
    const y = luma[i];
    const red = y + cr[i] / 0.713;
    const blue = y + cb[i] / 0.564;
    planes[0][i] = red;
    planes[1][i] = (y - 0.299 * red - 0.114 * blue) / 0.587;
    planes[2][i] = blue;
  }
}

/**
 * Separable [1 2 1] / 4 blur, repeated `passes` times. Each row and column is extended by
 * repeating its edge pixel, so the blur never reads outside the image.
 * @param plane - One colour-difference plane, blurred in place.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param passes - Number of blur passes.
 */
function blurChroma(plane: Float32Array, width: number, height: number, passes: number): void {
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
