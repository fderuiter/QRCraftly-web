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

import { sha256 } from '@/utils/sha256';
import { cborDecode, cborEncode } from '../fountain/cbor';
import { bytesToHex, hexToBytes, type TransferCompression } from '../fountain/session';
import { MAX_BUNDLE_ENTRIES, MAX_INDEX_BYTES, MAX_RECEIVE_BYTES, MAX_RECEIVE_MESSAGE_BYTES } from '../limits';
import { SESSION_ID_BYTES } from './frame';
import { fingerprintWords } from './words';

/** One file a transfer announces. The hash and size are what the receiver verifies against. */
export interface PrismFileEntry {
  name: string;
  /** Size of the original file in bytes. */
  size: number;
  mimeType: string;
  /** Lowercase hex SHA-256 of the original file. */
  sha256: string;
}

/**
 * What a transfer is, sent as frame 1 and again every 16th frame so a receiver that joins late
 * still learns it. It is a CBOR array, not a map, so it stays small and its meaning is fixed by
 * position; a later version appends fields and bumps `version`.
 */
export interface PrismManifest {
  version: number;
  files: PrismFileEntry[];
  compression: TransferCompression;
  /** Length in bytes of the message the fountain code carries (the possibly compressed payload). */
  transferLength: number;
  /** Bytes per symbol. */
  symbolSize: number;
  /** CRC-32 of the transferred message, which binds every droplet to this session. */
  transferCrc32: number;
  /** Key-derivation salt of a private transfer; empty otherwise. */
  salt: Uint8Array;
  /** Encryption scheme: 0 is none, 1 is AES-256-GCM (a private transfer). */
  encryption: number;
  /**
   * How the message is laid out. 0: it is the single file described by `files`. 1: it begins with a
   * file index, so `files` is empty and the index is read after the message is rebuilt.
   */
  layout: number;
  /** Length of the unpacked message of a layout-1 transfer; bounds decompression. 0 for layout 0. */
  unpackedLength: number;
  /** SHA-256 of the unpacked message of a layout-1 transfer that is not private; empty otherwise. */
  unpackedSha256: Uint8Array;
  /** Files in a layout-1 transfer that is not private; 0 when unknown or private. */
  entryCount: number;
}

export const LAYOUT_SINGLE = 0;
export const LAYOUT_BUNDLE = 1;

export const MANIFEST_VERSION = 1;
/** Longest file name a manifest carries, in UTF-8 bytes. Longer names are shortened by the sender. */
export const MAX_MANIFEST_NAME_BYTES = 96;
export const MAX_MANIFEST_MIME_BYTES = 64;
/** Most files one manifest lists. */
export const MAX_MANIFEST_FILES = 16;
export const MIN_PRISM_SYMBOL_SIZE = 8;
export const MAX_PRISM_SYMBOL_SIZE = 2048;
/** Source blocks above which the receiver wants a manifest repeated before it builds decoder tables. */
const MAX_SOURCE_BLOCKS = 1 << 22;

const COMPRESSION_FLAGS: Record<TransferCompression, number> = { none: 0, 'deflate-raw': 1 };
const encoder = new TextEncoder();

function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Shortens a file name to a byte budget, keeping its extension, so a long name never makes the
 * manifest frame too large for a QR code.
 * @param name - The file name.
 * @param maxBytes - The UTF-8 byte budget.
 * @returns The name, shortened if it was over budget.
 */
export function fitFileName(name: string, maxBytes: number = MAX_MANIFEST_NAME_BYTES): string {
  if (utf8Length(name) <= maxBytes) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
  let stem = [...(extension ? name.slice(0, dot) : name)];
  while (stem.length > 1 && utf8Length(stem.join('') + '…' + extension) > maxBytes) stem = stem.slice(0, -1);
  return `${stem.join('')}…${extension}`;
}

/**
 * Encodes a manifest.
 * @param manifest - The manifest.
 * @returns Its CBOR bytes.
 */
export function encodeManifest(manifest: PrismManifest): Uint8Array {
  return cborEncode([
    manifest.version,
    manifest.files.map((file) => [file.name, file.size, file.mimeType, hexToBytes(file.sha256)]),
    COMPRESSION_FLAGS[manifest.compression],
    manifest.transferLength,
    manifest.symbolSize,
    manifest.transferCrc32,
    manifest.salt,
    manifest.encryption,
    manifest.layout,
    manifest.unpackedLength,
    manifest.unpackedSha256,
    manifest.entryCount,
  ]);
}

/**
 * The session ID of a manifest: the first 6 bytes of its SHA-256. Every frame of the transfer
 * carries it, so frames of two transfers can never be mixed and a swapped manifest is noticed.
 * @param manifestBytes - The encoded manifest.
 * @returns The 6 session ID bytes.
 */
export function sessionIdOf(manifestBytes: Uint8Array): Uint8Array {
  return sha256(manifestBytes).subarray(0, SESSION_ID_BYTES);
}

/** What a receiver may show once a manifest has been accepted. */
export interface PrismManifestInfo {
  /** The session ID as 12 hex characters. */
  sessionId: string;
  /** Short form of the session ID for the sender and receiver to compare, e.g. `A1B2-C3D4`. */
  fingerprint: string;
  files: PrismFileEntry[];
  /** Total size of the announced files. */
  totalSize: number;
  compression: TransferCompression;
  symbolSize: number;
  /** Number of source blocks. */
  k: number;
  transferLength: number;
  /** True for a private transfer: its file list is encrypted and a key code is needed. */
  encrypted: boolean;
  /** True when the files are listed inside the transfer, so only a count (if any) is known up front. */
  bundle: boolean;
  /** Files in a bundle, 0 when it is not announced. */
  entryCount: number;
}

function isUint(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

/** Why a manifest was not accepted. */
export type ManifestRejection = 'malformed' | 'too-large';

export type ManifestResult = { ok: true; manifest: PrismManifest } | { ok: false; reason: ManifestRejection };

const MALFORMED: ManifestResult = { ok: false, reason: 'malformed' };
const TOO_LARGE: ManifestResult = { ok: false, reason: 'too-large' };

/**
 * Reads and validates a manifest. Every size it claims is checked against the receive limits here,
 * before the receiver allocates anything for it.
 * @param bytes - The encoded manifest.
 * @returns The manifest, or why it was refused: malformed, or claiming more than the receiver takes.
 */
export function decodeManifest(bytes: Uint8Array): ManifestResult {
  let value;
  try {
    value = cborDecode(bytes);
  } catch {
    return MALFORMED;
  }
  if (!Array.isArray(value) || value.length < 12 || value[0] !== MANIFEST_VERSION) return MALFORMED;
  const [, files, compression, transferLength, symbolSize, transferCrc32, salt, encryption, layout, unpackedLength, unpackedSha256, entryCount] = value;
  if (layout !== LAYOUT_SINGLE && layout !== LAYOUT_BUNDLE) return MALFORMED;
  // A bundle lists its files inside the message, so the manifest lists none.
  if (!Array.isArray(files) || (layout === LAYOUT_SINGLE ? files.length < 1 || files.length > MAX_MANIFEST_FILES : files.length !== 0)) {
    return MALFORMED;
  }

  const entries: PrismFileEntry[] = [];
  let total = 0;
  for (const entry of files) {
    if (!Array.isArray(entry) || entry.length !== 4) return MALFORMED;
    const [name, size, mimeType, hash] = entry;
    if (
      typeof name !== 'string' ||
      name.length === 0 ||
      utf8Length(name) > MAX_MANIFEST_NAME_BYTES * 2 ||
      typeof mimeType !== 'string' ||
      utf8Length(mimeType) > MAX_MANIFEST_MIME_BYTES * 2 ||
      typeof size !== 'number' ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      !(hash instanceof Uint8Array) ||
      hash.length !== 32
    ) {
      return MALFORMED;
    }
    total += size;
    entries.push({ name, size, mimeType, sha256: bytesToHex(hash) });
  }
  if (
    (compression !== COMPRESSION_FLAGS.none && compression !== COMPRESSION_FLAGS['deflate-raw']) ||
    !isUint(transferLength, Number.MAX_SAFE_INTEGER) ||
    transferLength < 1 ||
    !isUint(symbolSize, MAX_PRISM_SYMBOL_SIZE) ||
    symbolSize < MIN_PRISM_SYMBOL_SIZE ||
    !isUint(transferCrc32, 0xffffffff) ||
    !(salt instanceof Uint8Array) ||
    salt.length > 32 ||
    !isUint(encryption, 255) ||
    !isUint(unpackedLength, Number.MAX_SAFE_INTEGER) ||
    !(unpackedSha256 instanceof Uint8Array) ||
    (unpackedSha256.length !== 0 && unpackedSha256.length !== 32) ||
    !isUint(entryCount, MAX_BUNDLE_ENTRIES) ||
    (layout === LAYOUT_BUNDLE && unpackedLength < 1) ||
    (layout === LAYOUT_SINGLE && (unpackedLength !== 0 || unpackedSha256.length !== 0 || entryCount !== 0))
  ) {
    return MALFORMED;
  }
  // A claim past the receive limit is refused here, before any buffer exists for it.
  if (
    total > MAX_RECEIVE_BYTES ||
    unpackedLength > MAX_RECEIVE_BYTES + MAX_INDEX_BYTES ||
    transferLength > MAX_RECEIVE_MESSAGE_BYTES ||
    Math.ceil(transferLength / symbolSize) > MAX_SOURCE_BLOCKS
  ) {
    return TOO_LARGE;
  }
  return {
    ok: true,
    manifest: {
      version: MANIFEST_VERSION,
      files: entries,
      compression: compression === COMPRESSION_FLAGS['deflate-raw'] ? 'deflate-raw' : 'none',
      transferLength,
      symbolSize,
      transferCrc32,
      salt,
      encryption,
      layout,
      unpackedLength,
      unpackedSha256,
      entryCount,
    },
  };
}

/**
 * Summarises a manifest for the receiver's screen.
 * @param manifest - A validated manifest.
 * @param sessionId - Its session ID as hex.
 * @returns The display facts.
 */
export function describeManifest(manifest: PrismManifest, sessionId: string): PrismManifestInfo {
  return {
    sessionId,
    fingerprint: fingerprintWords(hexToBytes(sessionId)),
    files: manifest.files,
    totalSize: manifest.layout === LAYOUT_BUNDLE ? manifest.unpackedLength : manifest.files.reduce((sum, file) => sum + file.size, 0),
    compression: manifest.compression,
    symbolSize: manifest.symbolSize,
    k: Math.ceil(manifest.transferLength / manifest.symbolSize),
    transferLength: manifest.transferLength,
    encrypted: manifest.encryption !== 0,
    bundle: manifest.layout === LAYOUT_BUNDLE,
    entryCount: manifest.entryCount,
  };
}
