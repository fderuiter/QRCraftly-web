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
 * @param planes - Red, green and blue planes, 0 to 255.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param passes - Passes of a [1 2 1] / 4 blur on Cb and Cr; 0 leaves the planes alone.
 */
export function denoiseChroma(planes: Float32Array[], width: number, height: number, passes: number): void {
  void planes;
  void width;
  void height;
  void passes;
}
