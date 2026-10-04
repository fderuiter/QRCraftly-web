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

import { crc32 } from '../fountain/crc32';
import { FountainEncoder } from '../fountain/encoder';
import {
  ALPHANUMERIC_CAPACITY,
  DEFAULT_TRANSFER_DENSITY,
  MAX_QR_VERSION,
  TRANSFER_DENSITY_PROFILES,
  compressForTransfer,
  decompressTransferPayload,
  sha256Hex,
  bytesToHex,
  type FountainSessionHeader,
  type StreamErrorCorrection,
  type TransferDensity,
} from '../fountain/session';
import { MAX_RECEIVE_BYTES, formatLimit } from '../limits';
import { base45Length } from './base45';
import { FRAME_OVERHEAD, MAX_SYMBOL_ID, encodeDataFrame, encodeManifestFrame } from './frame';
import {
  MANIFEST_VERSION,
  MAX_MANIFEST_MIME_BYTES,
  MAX_PRISM_SYMBOL_SIZE,
  MIN_PRISM_SYMBOL_SIZE,
  describeManifest,
  encodeManifest,
  fitFileName,
  sessionIdOf,
  type PrismManifest,
} from './manifest';

/** The manifest goes out as frame 1 and again every this many frames. */
export const MANIFEST_INTERVAL = 16;

/**
 * Bytes of binary a QR code of a given version and error correction carries as a Base45 frame.
 * @param errorCorrectionLevel - L, M, Q or H.
 * @param maxVersion - Highest QR version, 1 to 20.
 * @returns The frame size in bytes, header and CRC included.
 */
export function prismFrameCapacity(errorCorrectionLevel: StreamErrorCorrection, maxVersion: number): number {
  const version = Math.min(MAX_QR_VERSION, Math.max(1, Math.floor(maxVersion)));
  const characters = ALPHANUMERIC_CAPACITY[errorCorrectionLevel][version - 1];
  let bytes = Math.floor((characters * 2) / 3);
  while (base45Length(bytes) > characters) bytes -= 1;
  while (base45Length(bytes + 1) <= characters) bytes += 1;
  return bytes;
}

/**
 * The largest symbol that still fills a frame of the QR version and error correction the density
 * allows.
 * @param errorCorrectionLevel - L, M, Q or H.
 * @param maxVersion - Highest QR version.
 * @param symbolsPerFrame - Symbols sharing one frame (1 unless a profile packs several).
 * @returns Bytes per symbol, within the codec's limits.
 */
export function prismSymbolSize(errorCorrectionLevel: StreamErrorCorrection, maxVersion: number, symbolsPerFrame = 1): number {
  const room = Math.floor((prismFrameCapacity(errorCorrectionLevel, maxVersion) - FRAME_OVERHEAD) / symbolsPerFrame);
  return Math.min(MAX_PRISM_SYMBOL_SIZE, Math.max(MIN_PRISM_SYMBOL_SIZE, room));
}

/**
 * Estimates how many QR frames a receiver must scan to rebuild a file of `fileSize` bytes, before
 * compression. Decoding typically needs about 15% more symbols than source blocks, and one frame
 * in {@link MANIFEST_INTERVAL} is a manifest.
 * @param fileSize - File size in bytes.
 * @param density - Transfer density.
 * @returns Symbol size, source block count and the estimated frame count.
 */
export function estimateTransferFrames(
  fileSize: number,
  density: TransferDensity = DEFAULT_TRANSFER_DENSITY
): { symbolSize: number; k: number; frames: number } {
  const profile = TRANSFER_DENSITY_PROFILES[density];
  const symbolSize = prismSymbolSize(profile.errorCorrectionLevel, profile.maxVersion);
  const k = Math.max(1, Math.ceil(Math.max(1, fileSize) / symbolSize));
  return { symbolSize, k, frames: Math.ceil((k * 1.15 * MANIFEST_INTERVAL) / (MANIFEST_INTERVAL - 1)) };
}

/** Options for {@link PrismStream}. */
export interface PrismStreamOptions {
  /** Symbols per data frame (default 1). */
  symbolsPerFrame?: number;
  /** Frames between manifests (default {@link MANIFEST_INTERVAL}). */
  manifestInterval?: number;
}

/**
 * The sender's endless frame sequence for one transfer: a manifest first, then data frames with a
 * manifest slipped in every {@link MANIFEST_INTERVAL}th. The sequence is rateless, so a receiver
 * can join at any frame and any frame can be lost.
 */
export class PrismStream {
  public readonly manifest: PrismManifest;
  public readonly sessionId: Uint8Array;
  public readonly encoder: FountainEncoder;
  public readonly k: number;
  public readonly symbolsPerFrame: number;
  /** Short form of the session ID for the sender and receiver to compare. */
  public readonly fingerprint: string;
  private readonly manifestText: string;
  private readonly interval: number;

  constructor(message: Uint8Array, manifest: PrismManifest, options: PrismStreamOptions = {}) {
    this.manifest = manifest;
    this.symbolsPerFrame = Math.max(1, Math.floor(options.symbolsPerFrame ?? 1));
    this.interval = Math.max(2, Math.floor(options.manifestInterval ?? MANIFEST_INTERVAL));
    const manifestBytes = encodeManifest(manifest);
    this.sessionId = sessionIdOf(manifestBytes);
    this.fingerprint = describeManifest(manifest, bytesToHex(this.sessionId)).fingerprint;
    this.manifestText = encodeManifestFrame({ sessionId: this.sessionId, manifest: manifestBytes });
    const blocks = Math.max(1, Math.ceil(message.length / manifest.symbolSize));
    // Symbol IDs are 24 bits. The ceiling is a multiple of the frame's symbol count, so a frame never
    // straddles the point where the stream wraps back to repair symbols.
    const ceiling = Math.min(MAX_SYMBOL_ID, Math.max(16 * blocks, 9999));
    const maxSeq = Math.max(blocks + 1, ceiling - (ceiling % this.symbolsPerFrame));
    this.encoder = new FountainEncoder(message, { blockSize: manifest.symbolSize, maxSeq });
    this.k = this.encoder.k;
  }

  /**
   * The text of one frame of the sequence.
   * @param index - Zero-based position in the sequence.
   * @returns Base45 text for a QR code.
   */
  public frameText(index: number): string {
    if (index % this.interval === 0) return this.manifestText;
    const dataIndex = index - Math.floor(index / this.interval) - 1;
    const first = dataIndex * this.symbolsPerFrame;
    // The symbols of a frame have consecutive IDs, so one that would run past the ceiling starts earlier.
    const start = Math.min(this.encoder.seqForIndex(first), this.encoder.maxSeq - this.symbolsPerFrame + 1);
    const droplets = Array.from({ length: this.symbolsPerFrame }, (_, offset) => this.encoder.getDroplet(start + offset));
    return encodeDataFrame({ sessionId: this.sessionId, firstSymbol: droplets[0].seq, symbols: droplets.map((droplet) => droplet.data) });
  }
}

/** Inputs for {@link createPrismSession}. */
export interface PrismSessionOptions {
  fileName: string;
  mimeType: string;
  errorCorrectionLevel: StreamErrorCorrection;
  maxVersion: number;
  /** Cap on the symbol size, mostly for tests. */
  requestedSymbolSize?: number;
  /** Precomputed SHA-256 of `bytes`, to avoid hashing twice. */
  sha256?: string;
  symbolsPerFrame?: number;
}

/**
 * Builds a sender session: compresses the file, writes the manifest and returns the frame stream.
 * @param bytes - The original file bytes.
 * @param options - File metadata and density.
 * @returns The stream, its manifest and the chosen symbol size.
 */
export async function createPrismSession(
  bytes: Uint8Array,
  options: PrismSessionOptions
): Promise<{ stream: PrismStream; manifest: PrismManifest; symbolSize: number }> {
  const sha256 = options.sha256 ?? (await sha256Hex(bytes));
  const { data, compression } = await compressForTransfer(bytes, options.mimeType);
  const symbolsPerFrame = options.symbolsPerFrame ?? 1;
  const fitted = prismSymbolSize(options.errorCorrectionLevel, options.maxVersion, symbolsPerFrame);
  const symbolSize = Math.max(MIN_PRISM_SYMBOL_SIZE, Math.min(fitted, options.requestedSymbolSize ?? fitted));
  const mimeType = options.mimeType || 'application/octet-stream';
  const manifest: PrismManifest = {
    version: MANIFEST_VERSION,
    files: [
      {
        name: fitFileName(options.fileName || 'file'),
        size: bytes.length,
        mimeType: new TextEncoder().encode(mimeType).length > MAX_MANIFEST_MIME_BYTES ? 'application/octet-stream' : mimeType,
        sha256,
      },
    ],
    compression,
    transferLength: data.length,
    symbolSize,
    transferCrc32: crc32(data),
    salt: new Uint8Array(0),
    encryption: 0,
  };
  return { stream: new PrismStream(data, manifest, { symbolsPerFrame }), manifest, symbolSize };
}

/**
 * Opens a reconstructed transfer: decompresses it within the announced size and checks the size
 * and SHA-256 against the manifest.
 * @param message - The reassembled message.
 * @param manifest - The manifest the session was announced with.
 * @returns The verified file and its header.
 * @throws Error when decompression fails or the size or hash does not match.
 */
export async function openPrismSession(
  message: Uint8Array,
  manifest: PrismManifest
): Promise<{ data: Uint8Array; header: FountainSessionHeader }> {
  const [file] = manifest.files;
  if (file.size > MAX_RECEIVE_BYTES) {
    throw new Error(`File transfer rejected: the sender claims ${file.size} bytes, more than the ${formatLimit(MAX_RECEIVE_BYTES)} limit.`);
  }
  const data = await decompressTransferPayload(message, manifest.compression, file.size);
  if (data.length !== file.size) {
    throw new Error('Integrity validation failed! Reconstructed size does not match the manifest.');
  }
  const actual = await sha256Hex(data);
  if (actual !== file.sha256) {
    throw new Error(`Integrity validation failed! SHA-256 mismatch.\nExpected: ${file.sha256}\nActual: ${actual}`);
  }
  return {
    data,
    header: { fileName: file.name, mimeType: file.mimeType, fileSize: file.size, sha256: file.sha256, compression: manifest.compression },
  };
}
