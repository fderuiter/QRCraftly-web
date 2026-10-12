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
 * Hand motion as a rolling-shutter camera records it, and what the stabiliser (EIS) does about it
 * for one frame. The sensor reads rows top to bottom, so motion during readout shears and stretches
 * the picture; the stabiliser then shifts and turns the whole frame.
 */
export interface CameraMotion {
  /** Sideways image motion during readout, in camera pixels per camera row (shear). */
  shear?: number;
  /** Vertical image motion during readout, as a fraction of a row per row (stretch or squash). */
  stretch?: number;
  /** Whole-frame shift the stabiliser applies, in camera pixels. */
  shiftX?: number;
  shiftY?: number;
  /** Whole-frame rotation the stabiliser leaves, as tan(angle / 2), about the image centre. */
  rotation?: number;
}

/**
 * Maps a camera pixel position to where the scene point it shows would sit with a still camera.
 *
 * The output pixel at (x, y) shows the content found at the returned position, so the result is the
 * inverse of the motion. Missing fields count as 0, with cx = width / 2 and cy = height / 2. The model
 * applies the rolling shutter first, then undoes the stabiliser's whole-frame shift and turn about the centre:
 *
 * - x1 = x - shear * (y - cy), y1 = y - stretch * (y - cy)
 * - dx = x1 - cx - shiftX, dy = y1 - cy - shiftY
 * - x2 = cx + dx cos + dy sin, y2 = cy - dx sin + dy cos, with t = rotation, cos = (1 - t²) / (1 + t²), sin = 2t / (1 + t²)
 *
 * Sign convention (in the capture, not the still-camera position): a positive `shiftX` moves the picture
 * right, so content at camera column c appears at c + shiftX. A positive `shear` makes rows below the
 * centre show content shifted right (rows above it, left). A positive `stretch` moves content away from
 * the centre row, by a factor of 1 / (1 - stretch). A positive `rotation` moves the top of a vertical
 * line right and its bottom left.
 *
 * @param x - Camera x in pixels.
 * @param y - Camera y in pixels (the readout row).
 * @param width - Camera width in pixels.
 * @param height - Camera height in pixels.
 * @param motion - The motion.
 * @returns The still-camera position in camera pixels.
 */
export function steady(x: number, y: number, width: number, height: number, motion: CameraMotion): [number, number] {
  const cx = width / 2;
  const cy = height / 2;
  const shear = motion.shear ?? 0;
  const stretch = motion.stretch ?? 0;
  const shiftX = motion.shiftX ?? 0;
  const shiftY = motion.shiftY ?? 0;
  const t = motion.rotation ?? 0;
  if (shear === 0 && stretch === 0 && shiftX === 0 && shiftY === 0 && t === 0) return [x, y];
  // Rolling shutter: each row was read while the picture had moved by a row-dependent amount.
  const x1 = x - shear * (y - cy);
  const y1 = y - stretch * (y - cy);
  // Undo the stabiliser's whole-frame shift, then its turn about the centre.
  const dx = x1 - cx - shiftX;
  const dy = y1 - cy - shiftY;
  const k = 1 + t * t;
  const cos = (1 - t * t) / k;
  const sin = (2 * t) / k;
  return [cx + dx * cos + dy * sin, cy - dx * sin + dy * cos];
}
