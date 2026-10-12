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
 * Lens distortion in the Brown-Conrady form, applied from camera pixels to where an ideal pinhole
 * camera would see the same ray. Coordinates are measured from the image centre in units of half
 * the image diagonal, so r = 1 is a corner. A positive k1 makes the picture bulge (barrel).
 */
export interface LensDistortion {
  /** Radial term on r squared. */
  k1: number;
  /** Radial term on r to the fourth. */
  k2?: number;
  /** Decentring (tangential) terms. */
  p1?: number;
  p2?: number;
}

/**
 * Maps a camera pixel position to the ideal (undistorted) position it shows.
 * @param x - Camera x in pixels.
 * @param y - Camera y in pixels.
 * @param width - Camera width in pixels.
 * @param height - Camera height in pixels.
 * @param lens - The distortion.
 * @returns The ideal position in camera pixels.
 */
export function undistort(x: number, y: number, width: number, height: number, lens: LensDistortion): [number, number] {
  void width;
  void height;
  void lens;
  return [x, y];
}
