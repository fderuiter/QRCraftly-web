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

// No imports on purpose: the generator's first load pulls this in, so it stays tiny.

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
