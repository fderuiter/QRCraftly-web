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

import { scan } from '@/packages/optical-scanner';
import type { ScanCorners } from '@/packages/optical-scanner';
import type { PixelFrame, ScannabilityStatus } from '@/packages/scannability';
import { describeScan, type ScanDescription } from '@/components/scanner/describeScan';

/** Side of the square the code is redrawn into for the print simulation, in pixels. */
const CHECK_SIZE = 512;
/** Margin kept around the code when cropping to it, as a fraction of the code's size (about the quiet zone). */
const CROP_MARGIN = 0.15;

/** What checking one picture found. */
export type CheckOutcome =
  | { kind: 'unreadable'; message: string }
  | {
      kind: 'read';
      /** What the code holds, described like a scanner result. */
      scan: ScanDescription;
      /** Screen scan and print simulation result; null when the code is blocked, so no verdict is shown for it. */
      status: ScannabilityStatus | null;
    };

const NOT_FOUND_MESSAGE =
  'No QR code was found in this picture. Try a straighter, sharper picture with the whole code and its blank border in view.';

/**
 * Cuts the code out of the picture and redraws it on a white square, so the print simulation
 * judges the code and not the photo around it.
 * @param image - The decoded picture.
 * @param corners - Where the scanner found the code, when it knows.
 * @returns The pixels of the redrawn square, or null when no canvas is available.
 */
function framePixels(image: ImageBitmap, corners: ScanCorners | null | undefined): PixelFrame | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = CHECK_SIZE;
  canvas.height = CHECK_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  let left = 0;
  let top = 0;
  let size = Math.max(image.width, image.height);
  if (corners) {
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const side = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY);
    const margin = side * CROP_MARGIN;
    size = side + margin * 2;
    left = minX - margin;
    top = minY - margin;
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CHECK_SIZE, CHECK_SIZE);
  const scale = CHECK_SIZE / size;
  ctx.drawImage(image, -left * scale, -top * scale, image.width * scale, image.height * scale);
  return ctx.getImageData(0, 0, CHECK_SIZE, CHECK_SIZE);
}

/**
 * Checks a picture of a QR code, even one made elsewhere: reads it, then redraws it and runs the
 * same screen-scan and print-simulation checks the generator runs on its own codes. Everything
 * happens in this browser; the picture is never sent anywhere.
 * @param file - The picture.
 * @returns What the code holds and how well it scans, or why it could not be read.
 */
export async function checkQrImage(file: Blob): Promise<CheckOutcome> {
  const scanned = await scan(file);
  if (scanned.status !== 'pass' || scanned.data === null) {
    return { kind: 'unreadable', message: scanned.error && scanned.error !== 'NOT_FOUND' ? scanned.error : NOT_FOUND_MESSAGE };
  }
  const description = describeScan(scanned.data);
  if (description.blocked) return { kind: 'read', scan: description, status: null };

  // The scanner read it, so the code scans on a screen. The print simulation can only upgrade that.
  let status: ScannabilityStatus = 'digital-pass';
  try {
    const bitmap = await createImageBitmap(file);
    const frame = framePixels(bitmap, scanned.corners);
    bitmap.close();
    if (frame) {
      const [{ performScannabilityCheck }, { loadQrReader }] = await Promise.all([
        import('@/packages/scannability/checker'),
        import('@/packages/qr-decode'),
      ]);
      const result = performScannabilityCheck(await loadQrReader(), frame, frame.width, frame.height, false);
      if (result.success && result.physicalReady) status = 'physical-pass';
    }
  } catch {
    // No canvas or bitmap support: report the screen scan only.
  }
  return { kind: 'read', scan: description, status };
}
