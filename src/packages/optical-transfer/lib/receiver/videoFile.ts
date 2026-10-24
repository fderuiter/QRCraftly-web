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

import { MAX_VIDEO_UPLOAD_BYTES, formatLimit } from '../limits';

/** The parts of an uploaded file the checks read. */
export type UploadedFile = Pick<File, 'name' | 'type' | 'size'>;

/**
 * Checks whether an uploaded file is a video the receiver can scan: by its type, or by its
 * extension when the browser gives no type.
 * @param file - The uploaded file.
 */
function isVideoFile(file: UploadedFile): boolean {
  return file.type ? file.type.startsWith('video/') : /\.(mp4|webm|ogg|mov|mkv|avi|3gp|m4v)$/i.test(file.name);
}

/**
 * Says why an uploaded video cannot be scanned for a transfer.
 * @param file - The uploaded file.
 * @returns A sentence for the person, or null when the video can be scanned.
 */
export function validateReceivedFile(file: UploadedFile): string | null {
  if (!isVideoFile(file)) return 'Invalid file type. Please upload a supported video file (e.g. MP4, WebM).';
  if (file.size > MAX_VIDEO_UPLOAD_BYTES) return `This video is too large to scan. The limit is ${formatLimit(MAX_VIDEO_UPLOAD_BYTES)}.`;
  return null;
}
