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

/** A phone ISP's edge enhancement: an unsharp mask on luma with a coring threshold and a clamp. */
export interface Sharpening {
  /** Gain on the detail signal (luma minus its blur); 0 is off, phones use about 0.5 to 2. */
  amount: number;
  /** Passes of a [1 2 1] / 4 blur that make the detail signal's low-pass (default 1). */
  passes?: number;
  /** Detail smaller than this many 8-bit levels is left alone (coring, default 0). */
  threshold?: number;
  /** Largest change to a pixel in 8-bit levels, so edges ring but do not explode (default 255). */
  clamp?: number;
}

/**
 * Sharpens RGB planes in place: an unsharp mask on luma whose detail is added equally to all three channels.
 * Detail is luma minus its blurred copy; detail within the threshold is ignored, and the rest is
 * cored (the threshold is subtracted) and scaled by the amount, then limited to the clamp. The
 * result is not clamped to 0 to 255 here, so the caller must do that.
 * @param planes - Red, green and blue planes, 0 to 255.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param sharpening - The settings.
 */
export function sharpen(planes: Float32Array[], width: number, height: number, sharpening: Sharpening): void {
  const { amount, passes = 1, clamp = 255 } = sharpening;
  const threshold = Math.max(0, sharpening.threshold ?? 0);
  const size = width * height;
  if (size === 0 || amount === 0) return;
  const [red, green, blue] = planes;
  const luma = new Float32Array(size);
  for (let i = 0; i < size; i++) luma[i] = 0.299 * red[i] + 0.587 * green[i] + 0.114 * blue[i];
  const low = Float32Array.from(luma);
  blurPlane(low, width, height, passes);
  const limit = Math.abs(clamp);
  for (let i = 0; i < size; i++) {
    const detail = luma[i] - low[i];
    let change = 0;
    if (Math.abs(detail) > threshold) change = amount * (detail - Math.sign(detail) * threshold);
    change = Math.min(limit, Math.max(-limit, change));
    red[i] += change;
    green[i] += change;
    blue[i] += change;
  }
}
