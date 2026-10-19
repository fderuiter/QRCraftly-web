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
 * How a Blob reaches the browser through a short-lived object URL: saved as a download named
 * `fileName` (used as given, so sanitize it first when it can come from a stranger), or opened
 * in a new tab whose URL is revoked after `revokeAfterMs`.
 */
export type BlobHandoff =
  | { readonly kind: 'download'; readonly fileName: string }
  | { readonly kind: 'open'; readonly revokeAfterMs: number };

/**
 * The one place a Blob URL reaches a link or a new tab. App-layer saves and opens go through
 * here, so the object URL is created and revoked the same way each time.
 * @param blob - The bytes to hand over, typed with their MIME type.
 * @param handoff - Whether to download the blob or open it in a new tab.
 */
export function handOffBlob(blob: Blob, handoff: BlobHandoff): void {
  const url = URL.createObjectURL(blob);
  if (handoff.kind === 'open') {
    // nosemgrep: require-isdangerousurl -- a Blob URL made by URL.createObjectURL, never user text
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), handoff.revokeAfterMs);
    return;
  }
  const a = document.createElement('a');
  // nosemgrep: require-isdangerousurl -- a Blob URL made by URL.createObjectURL, never user text
  a.href = url;
  a.download = handoff.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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
  // Names can come from a stream a stranger is showing: never hand the browser an unsafe one.
  handOffBlob(new Blob([data], { type: mimeType }), { kind: 'download', fileName: sanitizeFileName(fileName) });
}
