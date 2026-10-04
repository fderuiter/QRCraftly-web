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
 * Base45 (RFC 9285): two bytes become three characters from the QR alphanumeric set, so a binary
 * Prism frame fits a QR code in alphanumeric mode, about 3% above its byte size, and still reads
 * as text through the platform barcode detector.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const BASE = ALPHABET.length;

const VALUE_OF: ReadonlyMap<string, number> = new Map([...ALPHABET].map((char, index) => [char, index]));

/** True when every character belongs to the Base45 alphabet. */
export function isBase45(text: string): boolean {
  for (const char of text) if (!VALUE_OF.has(char)) return false;
  return true;
}

/**
 * Number of Base45 characters that encode `byteLength` bytes.
 * @param byteLength - Length of the binary data.
 * @returns The text length.
 */
export function base45Length(byteLength: number): number {
  return Math.floor(byteLength / 2) * 3 + (byteLength % 2) * 2;
}

/**
 * Encodes bytes as Base45.
 * @param bytes - The binary data.
 * @returns Text in the Base45 alphabet.
 */
export function encodeBase45(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      const n = bytes[i] * 256 + bytes[i + 1];
      out += ALPHABET[n % BASE] + ALPHABET[Math.floor(n / BASE) % BASE] + ALPHABET[Math.floor(n / (BASE * BASE))];
    } else {
      out += ALPHABET[bytes[i] % BASE] + ALPHABET[Math.floor(bytes[i] / BASE)];
    }
  }
  return out;
}

/**
 * Decodes Base45 text. Never throws.
 * @param text - Text in the Base45 alphabet.
 * @returns The bytes, or null when the text is not valid Base45 (a stray character, a length that
 * leaves one character over, or a group that would exceed its byte range).
 */
export function decodeBase45(text: string): Uint8Array | null {
  if (text.length % 3 === 1) return null;
  const out = new Uint8Array(Math.floor(text.length / 3) * 2 + (text.length % 3 === 2 ? 1 : 0));
  let written = 0;
  for (let i = 0; i < text.length; i += 3) {
    const c = VALUE_OF.get(text[i]);
    const d = VALUE_OF.get(text[i + 1]);
    if (c === undefined || d === undefined) return null;
    if (i + 2 < text.length) {
      const e = VALUE_OF.get(text[i + 2]);
      if (e === undefined) return null;
      const n = c + d * BASE + e * BASE * BASE;
      if (n > 0xffff) return null;
      out[written++] = n >> 8;
      out[written++] = n & 0xff;
    } else {
      const n = c + d * BASE;
      if (n > 0xff) return null;
      out[written++] = n;
    }
  }
  return out;
}
