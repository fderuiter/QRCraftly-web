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

import { FecEncoder } from '../fec/codec';
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
  hexToBytes,
  type FountainSessionHeader,
  type StreamErrorCorrection,
  type TransferDensity,
} from '../fountain/session';
import { MAX_FEC_SOURCE_SYMBOLS, MAX_FEC_SYMBOL_BYTES, MAX_RECEIVE_BYTES, formatLimit } from '../limits';
import { tileFrameCapacity } from '../multicode/layout';
import { base45Length } from './base45';
import { unpackBundle, packBundle, type BundleFile, type BundleSource } from './bundle';
import {
  ENCRYPTION_AES_GCM,
  ENCRYPTION_OVERHEAD,
  decryptBlock,
  deriveKeys,
  encryptBlock,
  generateSalt,
  generateSecret,
  privateSessionId,
  type PrivateKeys,
} from './crypto';
import { formatKeyCode } from './words';
import { FLAG_BEACON, FLAG_ENCRYPTED, FLAG_OUTER_CODE, FRAME_OVERHEAD, MAX_SYMBOL_ID, encodeDataFrame, encodeManifestFrame } from './frame';
import {
  LAYOUT_BUNDLE,
  LAYOUT_SINGLE,
  MANIFEST_VERSION,
  MANIFEST_VERSION_FEC,
  MAX_FEC_BLOCKS,
  MAX_MANIFEST_MIME_BYTES,
  MAX_PRISM_SYMBOL_SIZE,
  MIN_PRISM_SYMBOL_SIZE,
  describeManifest,
  encodeManifest,
  fecLayoutOf,
  fitFileName,
  sessionIdOf,
  usesOuterCode,
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
 * compression ({@link neededSymbols} symbols), given that one frame in {@link MANIFEST_INTERVAL} is
 * a manifest.
 * @param fileSize - File size in bytes.
 * @param density - Transfer density.
 * @param outerCode - The code the stream is sent with.
 * @returns Symbol size, source block count and the estimated frame count.
 */
export function estimateTransferFrames(
  fileSize: number,
  density: TransferDensity = DEFAULT_TRANSFER_DENSITY,
  outerCode: OuterCode = 'lt'
): { symbolSize: number; k: number; frames: number } {
  const profile = TRANSFER_DENSITY_PROFILES[density];
  const fitted = prismSymbolSize(profile.errorCorrectionLevel, profile.maxVersion);
  const fecSize = Math.floor(Math.min(fitted, MAX_FEC_SYMBOL_BYTES) / 8) * 8;
  // A file too large for the outer code's blocks goes out with the LT code.
  const code = outerCode === 'fec' && Math.ceil(Math.max(1, fileSize) / fecSize) <= MAX_FEC_BLOCKS * MAX_FEC_SOURCE_SYMBOLS ? 'fec' : 'lt';
  const symbolSize = code === 'fec' ? fecSize : fitted;
  const k = Math.max(1, Math.ceil(Math.max(1, fileSize) / symbolSize));
  const symbols = neededSymbols(k, code);
  return { symbolSize, k, frames: Math.ceil((symbols * MANIFEST_INTERVAL) / (MANIFEST_INTERVAL - 1)) };
}

/**
 * Symbols a receiver typically needs to rebuild K source symbols: about 15% more with the LT code,
 * and with the outer code K plus a few, its p99 overhead being under 10 symbols per block (ADR 0037).
 * @param k - Source symbols.
 * @param outerCode - The code the stream is sent with.
 * @returns The symbol count to plan for.
 */
export function neededSymbols(k: number, outerCode: OuterCode = 'lt'): number {
  return outerCode === 'fec' ? k + 8 * Math.ceil(k / MAX_FEC_SOURCE_SYMBOLS) : Math.ceil(k * 1.15);
}

/** Options for {@link PrismStream}. */
export interface PrismStreamOptions {
  /** Keys of a private transfer: the session ID is then an HMAC only their holder can make. */
  keys?: PrivateKeys;
  /** Symbols per data frame (default 1). */
  symbolsPerFrame?: number;
  /** Frames between manifests (default {@link MANIFEST_INTERVAL}). */
  manifestInterval?: number;
  /** The compiled outer-code module (`loadFecModule`); required when the manifest is version 2. */
  fecModule?: WebAssembly.Module;
  /** Mark every frame as a beacon of a multi-rate stream (`FLAG_BEACON`, #1143). */
  beacon?: boolean;
}

/** Which code carries a stream's symbols: the LT fountain code or the outer code (ADR 0037). */
export type OuterCode = 'lt' | 'fec';

/**
 * The sender's endless frame sequence for one transfer: a manifest first, then data frames with a
 * manifest slipped in every {@link MANIFEST_INTERVAL}th. The sequence is rateless, so a receiver
 * can join at any frame and any frame can be lost.
 *
 * A version-1 manifest sends the symbols of the LT fountain code; a version-2 manifest sends the
 * outer code's, round-robin over its blocks, with symbol ID `i + 1` for stream symbol `i`.
 */
export class PrismStream {
  public readonly manifest: PrismManifest;
  public readonly sessionId: Uint8Array;
  /** Source symbols, K. */
  public readonly k: number;
  public readonly outerCode: OuterCode;
  public readonly symbolsPerFrame: number;
  /** Short form of the session ID for the sender and receiver to compare. */
  public readonly fingerprint: string;
  private readonly manifestText: string;
  private readonly flags: number;
  private readonly interval: number;
  private readonly code: { kind: 'lt'; encoder: FountainEncoder } | { kind: 'fec'; encoder: FecEncoder };
  /** Stream symbols before the outer code's symbol IDs wrap; a multiple of the frame's symbol count. */
  private readonly fecCeiling: number;

  constructor(message: Uint8Array, manifest: PrismManifest, options: PrismStreamOptions = {}) {
    this.manifest = manifest;
    this.symbolsPerFrame = Math.max(1, Math.floor(options.symbolsPerFrame ?? 1));
    this.interval = Math.max(2, Math.floor(options.manifestInterval ?? MANIFEST_INTERVAL));
    const manifestBytes = encodeManifest(manifest);
    this.sessionId = options.keys ? privateSessionId(options.keys, manifestBytes) : sessionIdOf(manifestBytes);
    this.fingerprint = describeManifest(manifest, bytesToHex(this.sessionId)).fingerprint;
    this.outerCode = usesOuterCode(manifest) ? 'fec' : 'lt';
    this.flags =
      (manifest.encryption !== 0 ? FLAG_ENCRYPTED : 0) | (this.outerCode === 'fec' ? FLAG_OUTER_CODE : 0) | (options.beacon ? FLAG_BEACON : 0);
    this.manifestText = encodeManifestFrame({ sessionId: this.sessionId, manifest: manifestBytes, flags: this.flags });
    this.fecCeiling = MAX_SYMBOL_ID - (MAX_SYMBOL_ID % this.symbolsPerFrame);
    if (this.outerCode === 'fec') {
      if (!options.fecModule) throw new Error('A version 2 manifest needs the outer-code module.');
      const layout = fecLayoutOf(manifest);
      const encoder = new FecEncoder(options.fecModule, message, {
        symbolSize: layout.symbolSize,
        seed: layout.seed,
        maxBlockSymbols: manifest.blockSymbols,
      });
      this.code = { kind: 'fec', encoder };
      this.k = layout.blocks.reduce((sum, k) => sum + k, 0);
      return;
    }
    const blocks = Math.max(1, Math.ceil(message.length / manifest.symbolSize));
    // Symbol IDs are 24 bits. The ceiling is a multiple of the frame's symbol count, so a frame never
    // straddles the point where the stream wraps back to repair symbols.
    const ceiling = Math.min(MAX_SYMBOL_ID, Math.max(16 * blocks, 9999));
    const maxSeq = Math.max(blocks + 1, ceiling - (ceiling % this.symbolsPerFrame));
    const encoder = new FountainEncoder(message, { blockSize: manifest.symbolSize, maxSeq });
    this.code = { kind: 'lt', encoder };
    this.k = encoder.k;
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
    if (this.code.kind === 'fec') {
      const fec = this.code.encoder;
      const start = first % this.fecCeiling;
      return encodeDataFrame({
        sessionId: this.sessionId,
        firstSymbol: start + 1,
        symbols: Array.from({ length: this.symbolsPerFrame }, (_, offset) => fec.symbol(start + offset).data),
        flags: this.flags,
      });
    }
    const lt = this.code.encoder;
    // The symbols of a frame have consecutive IDs, so one that would run past the ceiling starts earlier.
    const start = Math.min(lt.seqForIndex(first), lt.maxSeq - this.symbolsPerFrame + 1);
    const droplets = Array.from({ length: this.symbolsPerFrame }, (_, offset) => lt.getDroplet(start + offset));
    return encodeDataFrame({
      sessionId: this.sessionId,
      firstSymbol: droplets[0].seq,
      symbols: droplets.map((droplet) => droplet.data),
      flags: this.flags,
    });
  }
}

/** Inputs for {@link createPrismSession} and {@link createPrismBundleSession}. */
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
  /** Encrypt the transfer under a new key code. The file list is then encrypted too. */
  private?: boolean;
  /**
   * Send with the outer code (ADR 0037) using this compiled module (`loadFecModule`). A message
   * that needs more than {@link MAX_FEC_BLOCKS} blocks is sent with the LT code instead.
   */
  fecModule?: WebAssembly.Module;
  /** Most source symbols per outer-code block, mostly for tests (default and cap 8192). */
  fecBlockSymbols?: number;
  /**
   * Fill the frames of a multi-code tile (#1142) instead of the density's QR version: this many
   * symbols of this size per frame. `maxVersion` and `symbolsPerFrame` are then ignored.
   */
  tile?: { symbolSize: number; symbolsPerFrame: number };
  /**
   * Also build the beacon stream of a multi-rate transfer (#1143): frames of the same session and
   * symbol size that fill a code of this QR version. Only with `tile`.
   */
  beaconVersion?: number;
}

/** What a sender session hands back. */
export interface PrismSession {
  stream: PrismStream;
  manifest: PrismManifest;
  symbolSize: number;
  /** The words of a private transfer's key code, shown to the sender; absent for a plain transfer. */
  keyCode?: string;
  /** The code the stream was sent with. */
  outerCode: OuterCode;
  /** The beacon stream, when `beaconVersion` was given. */
  beacon?: PrismStream;
}

/** Beacons between manifests in a beacon stream. */
export const BEACON_MANIFEST_INTERVAL = 4;

/**
 * Symbols one beacon carries: as many as fill a code of its version.
 * @param version - The beacon's QR version.
 * @param symbolSize - Bytes per symbol, shared with the dense tiles.
 * @returns Symbols per beacon frame, 1 to 255.
 */
export function beaconSymbolsFor(version: number, symbolSize: number): number {
  return Math.min(255, Math.max(1, Math.floor((tileFrameCapacity(version) - FRAME_OVERHEAD) / symbolSize)));
}

/**
 * Where the beacons start in their own stream: past the source symbols, so a receiver that already
 * read the dense tiles (which send the source symbols first) gets mostly new symbols from them.
 * @param k - Source symbols.
 * @param beaconSymbols - Symbols per beacon.
 * @returns The index of beacon 0 in the beacon stream.
 */
export function beaconStreamStart(k: number, beaconSymbols: number): number {
  return Math.ceil((k / beaconSymbols) * 1.1) + 2;
}

/** Fields a plain single-file manifest has no use for. */
const NO_BUNDLE = { layout: LAYOUT_SINGLE, unpackedLength: 0, unpackedSha256: new Uint8Array(0), entryCount: 0 } as const;

function clampMime(mimeType: string): string {
  const mime = mimeType || 'application/octet-stream';
  return new TextEncoder().encode(mime).length > MAX_MANIFEST_MIME_BYTES ? 'application/octet-stream' : mime;
}

type StreamOptions = Pick<
  PrismSessionOptions,
  'errorCorrectionLevel' | 'maxVersion' | 'requestedSymbolSize' | 'symbolsPerFrame' | 'fecModule' | 'fecBlockSymbols' | 'tile' | 'beaconVersion'
>;

/**
 * The outer code's symbol size and block cap for a message, or null when the message would need
 * more than {@link MAX_FEC_BLOCKS} blocks and goes out with the LT code.
 */
function fecPlan(length: number, symbolSize: number, options: StreamOptions): { symbolSize: number; blockSymbols: number } | null {
  // The outer code takes whole 8-byte words, up to its own limit.
  const size = Math.max(MIN_PRISM_SYMBOL_SIZE, Math.floor(Math.min(symbolSize, MAX_FEC_SYMBOL_BYTES) / 8) * 8);
  const blockSymbols = Math.max(1, Math.min(MAX_FEC_SOURCE_SYMBOLS, Math.floor(options.fecBlockSymbols ?? MAX_FEC_SOURCE_SYMBOLS)));
  // The block count `planBlocks` would give, worked out without building the list.
  const blocks = Math.ceil(Math.max(1, Math.ceil(length / size)) / blockSymbols);
  return blocks <= MAX_FEC_BLOCKS ? { symbolSize: size, blockSymbols } : null;
}

/** Chooses the code and symbol size and builds the stream for a finished message. */
function buildStream(
  message: Uint8Array,
  options: StreamOptions,
  fields: Omit<PrismManifest, 'transferLength' | 'symbolSize' | 'transferCrc32'>,
  keys?: PrivateKeys
): { stream: PrismStream; manifest: PrismManifest; symbolSize: number; outerCode: OuterCode; beacon?: PrismStream } {
  const symbolsPerFrame = options.tile?.symbolsPerFrame ?? options.symbolsPerFrame ?? 1;
  const fitted = options.tile?.symbolSize ?? prismSymbolSize(options.errorCorrectionLevel, options.maxVersion, symbolsPerFrame);
  const ltSymbolSize = Math.max(MIN_PRISM_SYMBOL_SIZE, Math.min(fitted, options.requestedSymbolSize ?? fitted));
  const fec = options.fecModule ? fecPlan(message.length, ltSymbolSize, options) : null;
  const symbolSize = fec?.symbolSize ?? ltSymbolSize;
  const manifest: PrismManifest = {
    ...fields,
    ...(fec ? { version: MANIFEST_VERSION_FEC, blockSymbols: fec.blockSymbols } : {}),
    transferLength: message.length,
    symbolSize,
    transferCrc32: crc32(message),
  };
  const stream = new PrismStream(message, manifest, { symbolsPerFrame, keys, fecModule: options.fecModule });
  if (!options.tile || options.beaconVersion === undefined) return { stream, manifest, symbolSize, outerCode: stream.outerCode };
  // A beacon-only camera needs the manifest before it can use a symbol, so every 4th beacon is one.
  const beacon = new PrismStream(message, manifest, {
    symbolsPerFrame: beaconSymbolsFor(options.beaconVersion, symbolSize),
    manifestInterval: BEACON_MANIFEST_INTERVAL,
    keys,
    fecModule: options.fecModule,
    beacon: true,
  });
  return { stream, manifest, symbolSize, outerCode: stream.outerCode, beacon };
}

/**
 * Builds a sender session for one file: compresses it, writes the manifest and returns the frame
 * stream. A private session carries the file as a one-file bundle so its name stays inside the
 * encrypted part.
 * @param bytes - The original file bytes.
 * @param options - File metadata and density.
 * @returns The stream, its manifest and the chosen symbol size; the key code when private.
 */
export async function createPrismSession(bytes: Uint8Array, options: PrismSessionOptions): Promise<PrismSession> {
  if (options.private) {
    return createPrismBundleSession([{ path: options.fileName || 'file', mimeType: options.mimeType, data: bytes }], options);
  }
  const sha256 = options.sha256 ?? (await sha256Hex(bytes));
  const { data, compression } = await compressForTransfer(bytes, options.mimeType);
  const built = buildStream(data, options, {
    version: MANIFEST_VERSION,
    files: [{ name: fitFileName(options.fileName || 'file'), size: bytes.length, mimeType: clampMime(options.mimeType), sha256 }],
    compression,
    salt: new Uint8Array(0),
    encryption: 0,
    ...NO_BUNDLE,
  });
  return built;
}

/**
 * Builds a sender session for several files, or for one file that is sent privately. The files
 * and their index are laid out as one message, compressed once and, when private, encrypted.
 * @param sources - The files.
 * @param options - Density and whether to encrypt; `fileName`, `mimeType` and `sha256` are ignored.
 * @returns The stream, its manifest and the chosen symbol size; the key code when private.
 * @throws RangeError when there are too many files or bytes.
 */
export async function createPrismBundleSession(sources: readonly BundleSource[], options: PrismSessionOptions): Promise<PrismSession> {
  const { message: unpacked } = await packBundle(sources);
  const { data: compressed, compression } = await compressForTransfer(unpacked);
  const fields = {
    version: MANIFEST_VERSION,
    files: [],
    compression,
    layout: LAYOUT_BUNDLE,
    unpackedLength: unpacked.length,
  };
  if (!options.private) {
    return buildStream(compressed, options, {
      ...fields,
      salt: new Uint8Array(0),
      encryption: 0,
      unpackedSha256: hexToBytes(await sha256Hex(unpacked)),
      entryCount: sources.length,
    });
  }
  const secret = generateSecret();
  const salt = generateSalt();
  const keys = deriveKeys(secret, salt);
  const sealed = await encryptBlock(keys, compressed);
  const built = buildStream(
    sealed,
    options,
    // Nothing about the plaintext is announced: no hash, no count, no names.
    { ...fields, salt, encryption: ENCRYPTION_AES_GCM, unpackedSha256: new Uint8Array(0), entryCount: 0 },
    keys
  );
  return { ...built, keyCode: formatKeyCode(secret) };
}

/** A transfer that has been rebuilt, decrypted, decompressed and checked. */
export interface OpenedTransfer {
  files: Array<{ data: Uint8Array; header: FountainSessionHeader }>;
}

function headerOf(file: { name: string; mimeType: string; size: number; sha256: string }, compression: PrismManifest['compression']): FountainSessionHeader {
  return { fileName: file.name, mimeType: file.mimeType, fileSize: file.size, sha256: file.sha256, compression };
}

/**
 * Opens a reconstructed transfer: decrypts it when it is private, decompresses it within the
 * announced size and checks every size and SHA-256 against what was announced.
 * @param message - The reassembled message.
 * @param manifest - The manifest the session was announced with.
 * @param keys - The transfer's keys when it is private.
 * @returns The verified files.
 * @throws Error when a key is missing or wrong, decompression fails, or a size or hash does not match.
 */
export async function openPrismSession(message: Uint8Array, manifest: PrismManifest, keys?: PrivateKeys): Promise<OpenedTransfer> {
  let body = message;
  if (manifest.encryption !== 0) {
    if (manifest.encryption !== ENCRYPTION_AES_GCM || !keys) throw new Error('This transfer is private. Enter its key code to open it.');
    if (message.length < ENCRYPTION_OVERHEAD) throw new Error('This private transfer is damaged.');
    body = await decryptBlock(keys, message);
  }

  if (manifest.layout === LAYOUT_BUNDLE) {
    const unpacked = await decompressTransferPayload(body, manifest.compression, manifest.unpackedLength);
    if (unpacked.length !== manifest.unpackedLength) throw new Error('Integrity validation failed! Reconstructed size does not match the manifest.');
    if (manifest.unpackedSha256.length === 32 && (await sha256Hex(unpacked)) !== bytesToHex(manifest.unpackedSha256)) {
      throw new Error('Integrity validation failed! SHA-256 mismatch.');
    }
    const files: BundleFile[] = await unpackBundle(unpacked);
    return { files: files.map((file) => ({ data: file.data, header: headerOf({ ...file, name: file.path }, manifest.compression) })) };
  }

  const [file] = manifest.files;
  if (file.size > MAX_RECEIVE_BYTES) {
    throw new Error(`File transfer rejected: the sender claims ${file.size} bytes, more than the ${formatLimit(MAX_RECEIVE_BYTES)} limit.`);
  }
  const data = await decompressTransferPayload(body, manifest.compression, file.size);
  if (data.length !== file.size) {
    throw new Error('Integrity validation failed! Reconstructed size does not match the manifest.');
  }
  const actual = await sha256Hex(data);
  if (actual !== file.sha256) {
    throw new Error(`Integrity validation failed! SHA-256 mismatch.\nExpected: ${file.sha256}\nActual: ${actual}`);
  }
  return { files: [{ data, header: headerOf(file, manifest.compression) }] };
}
