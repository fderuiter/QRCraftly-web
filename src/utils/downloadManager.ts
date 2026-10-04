/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { sanitizeFileName } from './fileNames';

/**
 * Shared file download manager that triggers browser file saving
 * while safely destroying temporary data object URLs immediately afterward.
 * @param data - The Uint8Array binary data.
 * @param fileName - The target download file name.
 * @param mimeType - Optional MIME-type of the downloaded file.
 */
export function triggerFileDownload(
  data: Uint8Array,
  fileName: string,
  mimeType: string = 'application/octet-stream'
): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  // nosemgrep: require-isdangerousurl -- a Blob URL made by URL.createObjectURL, never user text
  a.href = url;
  // Names can come from a stream a stranger is showing: never hand the browser an unsafe one.
  a.download = sanitizeFileName(fileName);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
