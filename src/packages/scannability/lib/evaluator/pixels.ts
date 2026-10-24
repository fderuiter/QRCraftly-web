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
 * Reading pixels for a check (#1601): from the preview canvas, a caller's frame, or a bitmap the
 * evaluator owns.
 */
import type { PixelFrame } from '../checker';
import type { ScannabilityCheckRequest } from '../evaluator';
import { releaseImageHandle } from '../imageHandle';
import type { EvaluatorState } from './state';

/** The preview canvas, when it has a size. */
export function sizedCanvas(s: EvaluatorState) {
  const canvas = s.options.getCanvas?.();
  return canvas && canvas.width > 0 && canvas.height > 0 ? canvas : null;
}

export function readCanvasPixels(s: EvaluatorState): PixelFrame | null {
  const canvas = sizedCanvas(s);
  if (!canvas) return null;
  try {
    return s.frames.readPixels(canvas);
  } catch (err) {
    console.error('Failed to read canvas data for scannability evaluation:', err);
    return null;
  }
}

/**
 * Converts a bitmap to pixels on the main thread and closes it.
 * @param s - Evaluator state.
 * @param bitmap - Bitmap the evaluator owns.
 * @returns Its pixels, or null when it cannot be drawn.
 */
export function convertBitmap(s: EvaluatorState, bitmap: ImageBitmap): PixelFrame | null {
  try {
    return bitmap.width > 0 && bitmap.height > 0 ? s.frames.bitmapToPixels(bitmap) : null;
  } catch {
    return null;
  } finally {
    releaseImageHandle(bitmap);
  }
}

/** The pixels a request still carries; a transferred buffer or bitmap has none left. */
export function pixelsFromRequest(s: EvaluatorState, request: ScannabilityCheckRequest): PixelFrame | null {
  const { imageData, imageBitmap } = request;
  // A transferred buffer is detached (byteLength 0) and a transferred bitmap reports 0x0.
  if (imageData && imageData.data.byteLength > 0) return imageData;
  if (imageBitmap && imageBitmap.width > 0 && imageBitmap.height > 0) {
    try {
      return s.frames.bitmapToPixels(imageBitmap);
    } catch {
      return null;
    }
  }
  return null;
}
