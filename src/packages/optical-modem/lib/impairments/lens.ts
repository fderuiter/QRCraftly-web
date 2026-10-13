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
 * Lens distortion in the Brown-Conrady form, using the OpenCV convention. The forward model maps an
 * ideal normalised point q = (u, v) to the distorted point d = (du, dv) that the camera records:
 *
 *   d = q * (1 + k1 r² + k2 r⁴) + (2 p1 u v + p2 (r² + 2 u²), p1 (r² + 2 v²) + 2 p2 u v)
 *
 * with r² = u² + v². Coordinates are measured from the image centre in units of half the image
 * diagonal, so r = 1 is a corner. k1 < 0 is barrel and k1 > 0 is pincushion.
 */
export interface LensDistortion {
  /** Radial term on r squared (OpenCV k1). Negative is barrel, positive is pincushion. */
  k1: number;
  /** Radial term on r to the fourth (OpenCV k2). */
  k2?: number;
  /** Decentring (tangential) term p1 (OpenCV p1). */
  p1?: number;
  /** Decentring (tangential) term p2 (OpenCV p2). */
  p2?: number;
}

/** Fixed number of fixed-point steps used to invert the forward model. */
const INVERSE_STEPS = 20;
/** Below this radial factor the forward model folds back on itself, so iteration stops. */
const MIN_RADIAL = 0.1;

/**
 * Maps a camera pixel position to the ideal (undistorted) position it shows. The sample taken at
 * camera position (x, y) is the ideal image at the returned position, so with k1 < 0 (barrel) the
 * screen's edges are pulled inwards, most of all at its corners.
 *
 * The result is the inverse of the forward model in {@link LensDistortion}. It is found by fixed-point
 * iteration: start from q = d, then 20 times compute the radial factor and tangential terms at q and
 * set q = (d - tangential(q)) / radial(q). If the radial factor at q drops to 0.1 or below, the model
 * folds, so iteration stops and the last q is kept. Only + - * / and Math.sqrt are used, so the result
 * is deterministic. Missing k2, p1 and p2 count as 0, and with all four at 0 the position is returned
 * unchanged.
 * @param x - Camera (distorted) x in pixels.
 * @param y - Camera (distorted) y in pixels.
 * @param width - Camera width in pixels.
 * @param height - Camera height in pixels.
 * @param lens - The distortion, in the OpenCV convention.
 * @returns The ideal position in camera pixels.
 */
export function undistort(x: number, y: number, width: number, height: number, lens: LensDistortion): [number, number] {
  const k1 = lens.k1;
  const k2 = lens.k2 ?? 0;
  const p1 = lens.p1 ?? 0;
  const p2 = lens.p2 ?? 0;
  if (k1 === 0 && k2 === 0 && p1 === 0 && p2 === 0) return [x, y];
  const cx = width / 2;
  const cy = height / 2;
  const s = Math.sqrt(width * width + height * height) / 2;
  const du = (x - cx) / s;
  const dv = (y - cy) / s;
  let u = du;
  let v = dv;
  for (let step = 0; step < INVERSE_STEPS; step++) {
    const r2 = u * u + v * v;
    const radial = 1 + k1 * r2 + k2 * r2 * r2;
    if (radial <= MIN_RADIAL) break;
    const tu = 2 * p1 * u * v + p2 * (r2 + 2 * u * u);
    const tv = p1 * (r2 + 2 * v * v) + 2 * p2 * u * v;
    u = (du - tu) / radial;
    v = (dv - tv) / radial;
  }
  return [cx + u * s, cy + v * s];
}
