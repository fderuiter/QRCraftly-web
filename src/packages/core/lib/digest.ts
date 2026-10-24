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

// Kept apart from sha256.ts so that startup chunks using the synchronous hash do not carry these.
import { bytesToHex } from './hex';

/**
 * SHA-256 with Web Crypto.
 * @param bytes - The bytes to hash.
 * @returns The 32-byte digest.
 */
export async function sha256Digest(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
}

/**
 * Lowercase hex SHA-256 with Web Crypto.
 * @param bytes - The bytes to hash.
 * @returns The 64-character hex digest.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(await sha256Digest(bytes));
}
