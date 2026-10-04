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
 * Size limits for uploaded images (#1160). A small file can declare billions of pixels (a
 * decompression bomb), so the declared size is read from the header before the browser decodes
 * anything.
 */

/** Largest image file the scanner and checker will read. */
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

/** Most pixels an image may declare, about a 7000 x 5700 photo. */
export const MAX_IMAGE_PIXELS = 40_000_000;

export const IMAGE_TOO_LARGE_BYTES_MESSAGE = 'This image file is too large to scan. The limit is 50 MB. Try a smaller photo or a screenshot of the code.';
export const IMAGE_TOO_LARGE_PIXELS_MESSAGE = 'This image is too large to scan. The limit is 40 megapixels. Try a smaller photo or a screenshot of the code.';

/** How much of the file start is read to find the dimensions. A JPEG can carry a large preview first. */
const HEADER_BYTES = 1024 * 1024;

const JPEG_SIZE_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export interface ImageSize {
  width: number;
  height: number;
}

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

function jpegSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (JPEG_SIZE_MARKERS.has(marker)) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    // Markers without a length: SOI, EOI, RSTn, TEM.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

function webpSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  const kind = ascii(bytes, 12, 4);
  if (kind === 'VP8 ' && bytes.length >= 30) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (kind === 'VP8L' && bytes.length >= 25) {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X' && bytes.length >= 30) {
    const read24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
    return { width: read24(24) + 1, height: read24(27) + 1 };
  }
  return null;
}

/**
 * Reads the declared width and height from the start of a PNG, JPEG, GIF, WebP or BMP file.
 * @param bytes - The first bytes of the file.
 * @returns The size, or null for another format or a header that is cut off.
 */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 26) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return { width: view.getUint32(16), height: view.getUint32(20) };
  if (ascii(bytes, 0, 3) === 'GIF') return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes, view);
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return webpSize(bytes, view);
  if (ascii(bytes, 0, 2) === 'BM') return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
  return null;
}

/**
 * Refuses an image that is too big in bytes or in declared pixels, before any decoding.
 * @param file - The uploaded file.
 * @throws An error whose message tells the person what the limit is.
 */
export async function assertImageWithinLimits(file: Blob): Promise<void> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error(IMAGE_TOO_LARGE_BYTES_MESSAGE);
  if (typeof file.slice !== 'function') return;
  const head = file.slice(0, HEADER_BYTES);
  if (typeof head.arrayBuffer !== 'function') return;
  const size = readImageSize(new Uint8Array(await head.arrayBuffer()));
  if (size && size.width * size.height > MAX_IMAGE_PIXELS) throw new Error(IMAGE_TOO_LARGE_PIXELS_MESSAGE);
}
