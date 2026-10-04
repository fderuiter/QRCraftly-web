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
 * Receive-side limits. A transfer's claimed size comes from whoever is showing the stream, so every
 * allocation is bounded before it happens. The values are documented in `docs/ABUSE_PROTECTIONS.md`.
 */

/** Largest file the receiver accepts, in bytes (100 MB; hours of optical transfer at today's rates). */
export const MAX_RECEIVE_BYTES = 100 * 1024 * 1024;

/**
 * Largest fountain message the receiver accepts: the file plus the session header (name, type, hash)
 * and the few bytes by which deflate can expand incompressible data.
 */
export const MAX_RECEIVE_MESSAGE_BYTES = MAX_RECEIVE_BYTES + 1024 * 1024;

/** Source block count above which a new stream must repeat 8 times before decoder tables are built. */
export const LARGE_BLOCK_COUNT = 1 << 16;

/** Largest video a person may upload to be scanned for a transfer, in bytes (500 MB). */
export const MAX_VIDEO_UPLOAD_BYTES = 500 * 1024 * 1024;

/** Formats a byte count for a limit message, e.g. `100 MB`. */
export function formatLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
