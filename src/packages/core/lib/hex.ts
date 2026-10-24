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

// Kept apart from bytes.ts so that only the code that uses hex pulls it into a chunk.

/**
 * Lowercase hex string to bytes. A string that is not even-length hex gives an empty array.
 * @param hex - Hex digits, two per byte.
 * @returns The decoded bytes.
 */
export function hexToBytes(hex: string): Uint8Array {
  const clean = /^[0-9a-f]*$/i.test(hex) && hex.length % 2 === 0 ? hex : '';
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Bytes to a lowercase hex string, two digits per byte.
 * @param bytes - The bytes to encode.
 * @returns The hex string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
