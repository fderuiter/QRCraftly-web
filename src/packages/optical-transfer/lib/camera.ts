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

import { classifyCameraError, type CameraErrorState } from '@/packages/optical-scanner';
import type { CameraPermission } from './feedback/link';

/**
 * What asking for the sender's webcam came back with. The error names are classified once, by
 * the scanner's Camera Session (#1585), so a camera in use reads as busy on every page.
 * @param error - The error `getUserMedia` rejected with.
 * @returns 'denied', 'unavailable' or 'busy'.
 * @throws The error itself when it is none of them, so the caller reports it as a failure.
 */
export function permissionOf(error: unknown): CameraPermission {
  const { status } = classifyCameraError(error);
  if (status === 'denied' || status === 'busy') return status;
  if (status === 'unavailable' || status === 'unsupported') return 'unavailable';
  throw error;
}

/** What to tell the person for each camera problem, with what to do next. */
const CAMERA_ERROR_COPY: Record<Exclude<CameraErrorState['status'], 'error'>, string> = {
  denied: 'Camera access was blocked. Allow the camera for this site in your browser settings, then activate the scanner again.',
  unavailable: 'No camera was found on this device.',
  busy: 'The camera is in use by another app or tab. Close it there, then activate the scanner again.',
  unsupported: 'This camera cannot stream at a size the scanner can use. Try another camera, then activate the scanner again.',
};

/**
 * Explains a failed camera request in plain words, with what to do next.
 * @param error - The error `getUserMedia` rejected with.
 * @returns A user-facing explanation.
 */
export function describeCameraError(error: Error): string {
  const { status } = classifyCameraError(error);
  return status === 'error' ? error.message || 'The camera could not be started.' : CAMERA_ERROR_COPY[status];
}
