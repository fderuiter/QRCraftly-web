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

import { cborDecode, cborEncode, cborHeadLength } from './cbor';
import { FountainEncoder, defaultMaxSeq } from './encoder';
import { FOUNTAIN_URI_PREFIX } from './envelope';
import { MAX_RECEIVE_BYTES, formatLimit } from '../limits';

/**
 * Payload compression applied before fountain encoding.
 * `none` means the file bytes are sent verbatim (incompressible input).
 */
export type TransferCompression = 'none' | 'deflate-raw';

const COMPRESSION_FLAGS: Record<TransferCompression, number> = { none: 0, 'deflate-raw': 1 };
const SESSION_FORMAT_VERSION = 1;

/** Compression must save at least this fraction of the input to be kept. */
export const MIN_COMPRESSION_SAVING = 0.05;

/**
 * Session header carried inside the fountain message, ahead of the payload.
 * Every droplet binds to it through the BC-UR message checksum, so a receiver
 * that joins mid-stream learns it as soon as the message is reconstructed.
 */
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
 * Encodes the fountain message: a CBOR byte string (so the UR type `bytes`
 * holds) wrapping `[version, fileName, mimeType, fileSize, sha256, compression, payload]`.
 * @param header Session header.
 * @param payload Possibly compressed file bytes.
 * @returns The message bytes to fountain-encode.
 */
export function encodeSessionMessage(header: FountainSessionHeader, payload: Uint8Array): Uint8Array {
  const inner = cborEncode([
    SESSION_FORMAT_VERSION,
    header.fileName,
    header.mimeType,
    header.fileSize,
    hexToBytes(header.sha256),
    COMPRESSION_FLAGS[header.compression],
    payload,
  ]);
  return cborEncode(inner);
}

/**
 * Decodes a fountain message produced by {@link encodeSessionMessage}.
 * @param message Reassembled message bytes.
 * @returns The header and payload, or null when malformed.
 */
export function decodeSessionMessage(message: Uint8Array): { header: FountainSessionHeader; payload: Uint8Array } | null {
  try {
    const outer = cborDecode(message);
    if (!(outer instanceof Uint8Array)) return null;
    const inner = cborDecode(outer);
    if (!Array.isArray(inner) || inner.length !== 7) return null;
    const [version, fileName, mimeType, fileSize, sha, flag, payload] = inner;
    if (
      version !== SESSION_FORMAT_VERSION ||
      typeof fileName !== 'string' ||
      typeof mimeType !== 'string' ||
      typeof fileSize !== 'number' ||
      !(sha instanceof Uint8Array) ||
      sha.length !== 32 ||
      (flag !== COMPRESSION_FLAGS.none && flag !== COMPRESSION_FLAGS['deflate-raw']) ||
      !(payload instanceof Uint8Array)
    ) {
      return null;
    }
    return {
      header: {
        fileName,
        mimeType,
        fileSize,
        sha256: bytesToHex(sha),
        compression: flag === COMPRESSION_FLAGS['deflate-raw'] ? 'deflate-raw' : 'none',
      },
      payload,
    };
  } catch {
    return null;
  }
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
/** Upper bound for a fountain symbol (fragment) in bytes. */
export const MAX_SYMBOL_SIZE = 400;
/** Lower bound for a fountain symbol (fragment) in bytes. */
export const MIN_SYMBOL_SIZE = 8;

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

function toStreamEcc(level: string): StreamErrorCorrection {
  return level === 'L' || level === 'M' || level === 'H' ? level : 'Q';
}

/**
 * Worst-case length of a serialized droplet string for the given session shape.
 * @param symbolSize Fragment size in bytes.
 * @param k Source block count.
 * @param messageLength Message length in bytes.
 * @param maxSeq Highest sequence number the stream will emit.
 * @returns Maximum number of characters in `UR:BYTES/<seq>-<k>/<bytewords>`.
 */
export function maxDropletStringLength(symbolSize: number, k: number, messageLength: number, maxSeq: number): number {
  const cborLength =
    1 + cborHeadLength(maxSeq) + cborHeadLength(k) + cborHeadLength(messageLength) + cborHeadLength(0xffffffff) +
    cborHeadLength(symbolSize) + symbolSize;
  const path = FOUNTAIN_URI_PREFIX.length + String(maxSeq).length + 1 + String(k).length + 1;
  return path + 2 * (cborLength + 4);
}

/**
 * Picks the largest symbol size (≤ `requested`, clamped to
 * [{@link MIN_SYMBOL_SIZE}, {@link MAX_SYMBOL_SIZE}]) whose worst-case droplet
 * still fits a QR code of version ≤ `maxVersion` at the given ECC level in
 * alphanumeric mode.
 * @param messageLength Fountain message length in bytes.
 * @param errorCorrectionLevel ECC level L, M, Q or H; anything else is treated as Q.
 * @param requested Optional requested symbol size cap.
 * @param maxVersion Highest allowed QR version (1-{@link MAX_QR_VERSION}).
 * @returns The chosen symbol size, K and sequence ceiling.
 * @throws RangeError if even the minimum symbol size cannot fit.
 */
export function resolveFountainSymbolSize(
  messageLength: number,
  errorCorrectionLevel: string,
  requested: number = MAX_SYMBOL_SIZE,
  maxVersion: number = TRANSFER_DENSITY_PROFILES.reliable.maxVersion
): { symbolSize: number; k: number; maxSeq: number } {
  const ecc = toStreamEcc(errorCorrectionLevel);
  const version = Math.min(MAX_QR_VERSION, Math.max(1, Math.floor(maxVersion)));
  const capacity = ALPHANUMERIC_CAPACITY[ecc][version - 1];
  const ceiling = Math.min(MAX_SYMBOL_SIZE, Math.max(MIN_SYMBOL_SIZE, Math.floor(requested) || MAX_SYMBOL_SIZE));
  const length = Math.max(1, messageLength);

  for (let symbolSize = ceiling; symbolSize >= MIN_SYMBOL_SIZE; symbolSize--) {
    const k = Math.ceil(length / symbolSize);
    const maxSeq = defaultMaxSeq(k);
    if (maxDropletStringLength(symbolSize, k, length, maxSeq) <= capacity) {
      return { symbolSize, k, maxSeq };
    }
  }
  throw new RangeError(`File is too large to stream within QR version ${version} at ECC ${ecc}.`);
}

/** Inputs for {@link createFountainSession}. */
export interface FountainSessionOptions {
  fileName: string;
  mimeType: string;
  /** ECC level of the droplet QR codes (defaults to Q). */
  errorCorrectionLevel?: string;
  requestedSymbolSize?: number;
  /** Highest QR version a droplet may use (defaults to 7). */
  maxVersion?: number;
  /** Precomputed SHA-256 of `bytes`, to avoid hashing twice. */
  sha256?: string;
}

/**
 * Builds a complete sender session: hashes and compresses the file, wraps it in
 * the session header and returns a density-bounded fountain encoder.
 * @param bytes Original file bytes.
 * @param options File metadata and density options.
 * @returns The encoder, header and chosen symbol size.
 */
export async function createFountainSession(
  bytes: Uint8Array,
  options: FountainSessionOptions
): Promise<{ encoder: FountainEncoder; header: FountainSessionHeader; symbolSize: number }> {
  const sha256 = options.sha256 ?? (await sha256Hex(bytes));
  const { data, compression } = await compressForTransfer(bytes, options.mimeType);
  const header: FountainSessionHeader = {
    fileName: options.fileName,
    mimeType: options.mimeType || 'application/octet-stream',
    fileSize: bytes.length,
    sha256,
    compression,
  };
  const message = encodeSessionMessage(header, data);
  const { symbolSize, maxSeq } = resolveFountainSymbolSize(
    message.length,
    options.errorCorrectionLevel ?? 'Q',
    options.requestedSymbolSize,
    options.maxVersion
  );
  return { encoder: new FountainEncoder(message, { blockSize: symbolSize, maxSeq }), header, symbolSize };
}

/**
 * Opens a reconstructed fountain message: parses the header, decompresses the
 * payload and verifies its SHA-256 against the header.
 * @param message Reassembled message bytes.
 * @returns The verified file bytes and header.
 * @throws Error when the header is malformed, decompression fails or the hash mismatches.
 */
export async function openFountainSession(message: Uint8Array): Promise<{ data: Uint8Array; header: FountainSessionHeader }> {
  const decoded = decodeSessionMessage(message);
  if (!decoded) throw new Error('Malformed fountain session header.');
  const { fileSize } = decoded.header;
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
    throw new Error('Malformed fountain session header: invalid file size.');
  }
  // Refuse an oversized claim before any buffer is allocated.
  if (fileSize > MAX_RECEIVE_BYTES) {
    throw new Error(`File transfer rejected: the sender claims ${fileSize} bytes, more than the ${formatLimit(MAX_RECEIVE_BYTES)} limit.`);
  }
  const data = await decompressTransferPayload(decoded.payload, decoded.header.compression, fileSize);
  if (data.length !== decoded.header.fileSize) {
    throw new Error('Integrity validation failed! Reconstructed size does not match the session header.');
  }
  const actual = await sha256Hex(data);
  if (actual !== decoded.header.sha256) {
    throw new Error(
      `Integrity validation failed! SHA-256 mismatch.\nExpected: ${decoded.header.sha256}\nActual: ${actual}`
    );
  }
  return { data, header: decoded.header };
}
