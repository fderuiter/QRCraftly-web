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


import type { HandshakeInfo } from '../contracts';
import { sha256Hex } from '../fountain/session';
import { DANGEROUS_SCHEMES } from '../streamLookahead';
import { MAX_RECEIVE_BYTES } from '../limits';

/** Largest legacy `F|` stream the receiver accepts. */
const MAX_LEGACY_CHUNKS = 5000;

/** Largest chunk the legacy sender produces (it caps `chunkSize` below 256 bytes). */
const MAX_LEGACY_CHUNK_BYTES = 256;

/** Largest file a legacy stream can legitimately describe: its chunk limit times its chunk size. */
export const MAX_LEGACY_FILE_BYTES = Math.min(MAX_LEGACY_CHUNKS * MAX_LEGACY_CHUNK_BYTES, MAX_RECEIVE_BYTES);

/** A legacy `F|index|total|base64` data frame. */
export interface LegacyChunkFrame {
  index: number;
  total: number;
  base64: string;
}

/**
 * Parses a legacy `F|index|total|base64` data frame.
 * @param text Decoded QR text.
 * @returns The chunk, or null when the text is not a well-formed data frame.
 */
export function parseLegacyChunk(text: string): LegacyChunkFrame | null {
  if (!text.startsWith('F|')) return null;
  const parts = text.split('|');
  if (parts.length !== 4) return null;
  const index = parseInt(parts[1], 10);
  const total = parseInt(parts[2], 10);
  if (isNaN(index) || isNaN(total)) return null;
  return { index, total, base64: parts[3] };
}

/**
 * Checks a legacy chunk's bounds.
 * @returns A user-facing rejection message, or null when the chunk is acceptable.
 */
export function legacyChunkRejection({ index, total }: LegacyChunkFrame): string | null {
  if (total < 1 || total > MAX_LEGACY_CHUNKS) {
    return `File transfer rejected: exceeds the maximum limit of ${MAX_LEGACY_CHUNKS} chunks.`;
  }
  if (index < 0 || index >= total) {
    return 'File transfer rejected: invalid chunk metadata or index range.';
  }
  return null;
}

/**
 * Parses a legacy `H|fileName|fileSize|mimeType|sha256` handshake frame.
 * @throws When the frame is malformed.
 */
export function parseLegacyHandshake(text: string): HandshakeInfo {
  const parts = text.split('|');
  if (parts.length < 5) {
    throw new Error('Malformed handshake frame received.');
  }
  const fileSize = parseInt(parts[2], 10);
  if (isNaN(fileSize) || fileSize < 0 || String(fileSize) !== parts[2].trim()) {
    throw new Error('Invalid file size in handshake.');
  }
  // Reject an oversized claim before anything is allocated.
  if (fileSize > MAX_LEGACY_FILE_BYTES) {
    throw new Error(
      `File transfer rejected: the sender claims ${fileSize} bytes, more than the ${(MAX_LEGACY_FILE_BYTES / 1e6).toFixed(1)} MB this kind of stream can carry.`
    );
  }
  // An empty or malformed hash would skip the integrity check, so it is required.
  if (!/^[0-9a-f]{64}$/i.test(parts[4])) {
    throw new Error('File transfer rejected: the handshake has no valid SHA-256 hash, so the file could not be verified.');
  }
  return { fileName: parts[1], fileSize, mimeType: parts[3], sha256: parts[4] };
}

/**
 * Decodes a chunk's base64 payload as UTF-8 text for the Stream Lookahead check.
 * @returns The text, or an empty string when the payload is not valid base64.
 */
export function decodeChunkText(base64: string): string {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

/**
 * Finds a dangerous URI scheme at the start of a single decoded frame, ignoring control and
 * zero-width characters. Only the start counts: the text is shown or copied, never navigated to, so
 * a name or sentence that merely contains `about:` is not an attack (#1160).
 * @returns The matched scheme, or undefined.
 */
export function findDangerousScheme(text: string): string | undefined {
  const cleanText = text.replace(/[\x00-\x1F\x7F-\x9F\s\u200B-\u200D\uFEFF]+/g, '').toLowerCase();
  return DANGEROUS_SCHEMES.find(scheme => cleanText.startsWith(scheme));
}

/**
 * Verifies reassembled bytes against the SHA-256 announced by the handshake or fountain header.
 * @throws When the digest does not match.
 */
export async function assertIntegrity(data: Uint8Array, expectedSha256: string): Promise<void> {
  const actual = await sha256Hex(data);
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Integrity validation failed! SHA-256 hash does not match handshake value.\nExpected: ${expectedSha256}\nActual: ${actual}`
    );
  }
}
