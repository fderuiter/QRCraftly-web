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

import type { CameraPermission } from './feedback/link';

/**
 * What asking for the sender's webcam came back with: a refusal and a missing camera are told apart.
 * @param error - The error `getUserMedia` rejected with.
 * @returns 'denied' or 'unavailable'.
 * @throws The error itself when it is neither, so the caller reports it as a failure.
 */
export function permissionOf(error: unknown): CameraPermission {
  // A DOMException is not an Error everywhere, so read its name as a plain property.
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') return 'unavailable';
  throw error;
}

/**
 * Explains a failed camera request in plain words, with what to do next.
 * @param error - The error `getUserMedia` rejected with.
 * @returns A user-facing explanation.
 */
export function describeCameraError(error: Error): string {
  switch (error.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow the camera for this site in your browser settings, then activate the scanner again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is in use by another app or tab. Close it there, then activate the scanner again.';
    default:
      return error.message || 'The camera could not be started.';
  }
}
