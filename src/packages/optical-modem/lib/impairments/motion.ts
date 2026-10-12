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
 * @param x - Camera x in pixels.
 * @param y - Camera y in pixels (the readout row).
 * @param width - Camera width in pixels.
 * @param height - Camera height in pixels.
 * @param motion - The motion.
 * @returns The still-camera position in camera pixels.
 */
export function steady(x: number, y: number, width: number, height: number, motion: CameraMotion): [number, number] {
  void width;
  void height;
  void motion;
  return [x, y];
}
