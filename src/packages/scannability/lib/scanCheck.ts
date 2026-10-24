/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

/*
 * The one way the app checks a finished image (#1600): exports, the wallet card and the
 * transfer handshake all call these instead of loading the pixel check and the QR reader
 * themselves. Both load on demand, so pages that never export download neither up front.
 * Whether a check runs at all (templates, an explicit override) stays with the caller.
 */
import type { PixelFrame, ScannabilityResult } from './checker';

/** Runs the full pixel check on one frame with the loaded reader. */
export type PixelCheck = (frame: PixelFrame, moduleCount?: number, quietZoneModules?: number) => ScannabilityResult;

let loading: Promise<PixelCheck> | null = null;

/**
 * Loads the full pixel check and our QR reader (#1178) once, for these checks and the evaluator's
 * main-thread fallback alike. A failed load is forgotten, so the next check retries.
 * @returns The loaded check.
 */
export function loadPixelCheck(): Promise<PixelCheck> {
  loading ??= Promise.all([import('../checker'), import('@/packages/qr-decode').then(({ loadQrReader }) => loadQrReader())])
    .then(
      ([{ performScannabilityCheck }, reader]): PixelCheck =>
        (frame, moduleCount, quietZoneModules) =>
          performScannabilityCheck(reader, frame, frame.width, frame.height, moduleCount, quietZoneModules)
    )
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

/**
 * Starts loading the check ahead of time, for example once the page is idle, so a later copy or
 * share keeps its user gesture.
 * @returns Resolves when the check is ready; rejects if it could not load.
 */
export async function warmScanCheck(): Promise<void> {
  await loadPixelCheck();
}

/**
 * Checks that a rendered frame decodes and survives the print simulation.
 * @param frame - The frame's pixels and size, and its module count when known.
 * @param frame.imageData - The pixels.
 * @param frame.width - Width in pixels.
 * @param frame.height - Height in pixels.
 * @param frame.moduleCount - Modules a side, when known.
 * @returns Whether the frame passes.
 */
export async function isFrameScannable(frame: { imageData: ImageData; width: number; height: number; moduleCount?: number }): Promise<boolean> {
  const check = await loadPixelCheck();
  const { data } = frame.imageData;
  return check({ data, width: frame.width, height: frame.height }, frame.moduleCount).success;
}

/**
 * Checks a canvas the way {@link isFrameScannable} checks a frame.
 * @param canvas - The finished image.
 * @returns Whether it passes; false when the canvas has no 2D context.
 */
export async function isCanvasScannable(canvas: HTMLCanvasElement): Promise<boolean> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  return isFrameScannable({ imageData: ctx.getImageData(0, 0, canvas.width, canvas.height), width: canvas.width, height: canvas.height });
}
