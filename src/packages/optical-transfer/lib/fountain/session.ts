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


/**
 * Payload compression applied before fountain encoding.
 * `none` means the file bytes are sent verbatim (incompressible input).
 */
export type TransferCompression = 'none' | 'deflate-raw';

/** Compression must save at least this fraction of the input to be kept. */
export const MIN_COMPRESSION_SAVING = 0.05;

/** What a receiver knows about each received file once its bytes are verified. */
export interface FountainSessionHeader {
  fileName: string;
  mimeType: string;
  /** Size of the original (uncompressed) file in bytes. */
  fileSize: number;
  /** Lowercase hex SHA-256 of the original (uncompressed) file. */
  sha256: string;
  /** Compression applied to the payload. */
  compression: TransferCompression;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = /^[0-9a-f]*$/i.test(hex) && hex.length % 2 === 0 ? hex : '';
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Computes the lowercase hex SHA-256 digest of bytes with WebCrypto.
 * @param bytes Input bytes.
 * @returns Hex digest.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return bytesToHex(new Uint8Array(digest));
}

/** Thrown when decompressed output passes the size the session header declared. */
export class DecompressionLimitError extends Error {
  constructor(limit: number) {
    super(`The transfer expands to more than the ${limit} bytes it declared, so it was stopped.`);
    this.name = 'DecompressionLimitError';
  }
}

/**
 * Pipes `input` through a (de)compression stream. With `limit`, output is written straight into one
 * preallocated buffer and the stream is cancelled the moment it passes `limit` bytes, so a deflate
 * bomb never allocates more than the declared size. Without it, parts are collected and joined.
 */
async function runTransform(
  input: Uint8Array,
  stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> },
  limit?: number
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const written = writer.write(new Uint8Array(input)).then(() => writer.close());
  written.catch(() => {});
  const reader = stream.readable.getReader();

  if (limit !== undefined) {
    const buffer = new Uint8Array(limit);
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > limit) {
        await reader.cancel().catch(() => {});
        throw new DecompressionLimitError(limit);
      }
      buffer.set(value, length);
      length += value.length;
    }
    await written;
    return length === limit ? buffer : buffer.slice(0, length);
  }

  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  await written;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const PRECOMPRESSED_MIME = /^(image\/(jpeg|png|gif|webp|avif|heic|heif)|video\/|audio\/(mpeg|mp4|aac|ogg|opus|webm)|application\/(zip|gzip|x-gzip|x-7z-compressed|vnd\.rar|x-rar-compressed|x-xz|x-bzip2|zstd))/i;

/**
 * Compresses a payload with `CompressionStream('deflate-raw')` when that saves at
 * least {@link MIN_COMPRESSION_SAVING}; otherwise returns it untouched with the
 * `none` flag. Known pre-compressed MIME types skip the attempt entirely.
 * @param bytes File bytes.
 * @param mimeType Optional MIME type hint.
 * @returns The payload to send and the compression flag.
 */
export async function compressForTransfer(
  bytes: Uint8Array,
  mimeType = ''
): Promise<{ data: Uint8Array; compression: TransferCompression }> {
  if (typeof CompressionStream === 'undefined' || bytes.length === 0 || PRECOMPRESSED_MIME.test(mimeType)) {
    return { data: bytes, compression: 'none' };
  }
  try {
    const compressed = await runTransform(bytes, new CompressionStream('deflate-raw'));
    if (compressed.length <= bytes.length * (1 - MIN_COMPRESSION_SAVING)) {
      return { data: compressed, compression: 'deflate-raw' };
    }
  } catch {
    // Fall through to the uncompressed payload.
  }
  return { data: bytes, compression: 'none' };
}

/**
 * Reverses {@link compressForTransfer} with `DecompressionStream('deflate-raw')`.
 * @param data Received payload.
 * @param compression Compression flag from the session header.
 * @param expectedSize Size the header declares. Decompression stops as soon as the output passes it.
 * @returns The original file bytes.
 * @throws DecompressionLimitError when the output would exceed `expectedSize`.
 */
export async function decompressTransferPayload(
  data: Uint8Array,
  compression: TransferCompression,
  expectedSize?: number
): Promise<Uint8Array> {
  if (compression === 'none') return data;
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress the transfer (DecompressionStream unavailable).');
  }
  return runTransform(data, new DecompressionStream('deflate-raw'), expectedSize);
}

/** Highest QR version any transfer density may produce (ISO/IEC 18004). */
export const MAX_QR_VERSION = 20;
/** QR error correction levels a transfer stream can use. */
export type StreamErrorCorrection = 'L' | 'M' | 'Q' | 'H';

/** Alphanumeric-mode character capacity per QR version 1-20 (ISO/IEC 18004 Table 7). */
export const ALPHANUMERIC_CAPACITY: Record<StreamErrorCorrection, readonly number[]> = {
  L: [25, 47, 77, 114, 154, 195, 224, 279, 335, 395, 468, 535, 619, 667, 758, 854, 938, 1046, 1153, 1249],
  M: [20, 38, 61, 90, 122, 154, 178, 221, 262, 311, 366, 419, 483, 528, 600, 656, 734, 816, 909, 970],
  Q: [16, 29, 47, 67, 87, 108, 125, 157, 189, 221, 259, 296, 352, 376, 426, 470, 531, 574, 644, 702],
  H: [10, 20, 35, 50, 64, 84, 93, 122, 143, 174, 200, 227, 259, 283, 321, 365, 408, 452, 493, 557],
};

/**
 * How much data each transfer QR carries. Denser codes move more bytes per
 * frame but need a steadier, sharper camera view. The stream's error
 * correction comes from the profile, not from the page's QR appearance: the
 * fountain code already survives lost frames, so per-frame redundancy only has
 * to cover blur and glare within a frame.
 */
export type TransferDensity = 'reliable' | 'balanced' | 'fast';

export interface TransferDensityProfile {
  /** Highest QR version a droplet may use. */
  maxVersion: number;
  /** Error correction level of every droplet QR. */
  errorCorrectionLevel: StreamErrorCorrection;
}

export const TRANSFER_DENSITY_PROFILES: Readonly<Record<TransferDensity, TransferDensityProfile>> = {
  reliable: { maxVersion: 7, errorCorrectionLevel: 'Q' },
  balanced: { maxVersion: 9, errorCorrectionLevel: 'M' },
  fast: { maxVersion: 11, errorCorrectionLevel: 'M' },
};

/** Density used when the sender does not pick one. */
export const DEFAULT_TRANSFER_DENSITY: TransferDensity = 'balanced';

/**
 * Narrows an untrusted value to a known transfer density.
 * @param value Candidate density.
 * @returns The density, or the default when unknown.
 */
export function resolveTransferDensity(value: unknown): TransferDensity {
  return value === 'reliable' || value === 'balanced' || value === 'fast' ? value : DEFAULT_TRANSFER_DENSITY;
}
