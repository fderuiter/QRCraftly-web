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


import { analyseReceivedFile, sanitizeFileName } from '@/utils/fileNames';
import { cborDecode, cborEncode } from '../fountain/cbor';
import { sha256Hex } from '../fountain/session';
import { bytesToHex, hexToBytes } from '../fountain/session';
import { MAX_BUNDLE_ENTRIES, MAX_INDEX_BYTES, MAX_RECEIVE_BYTES } from '../limits';
import { MAX_MANIFEST_MIME_BYTES, fitFileName, type PrismFileEntry } from './manifest';

/** Longest path the sender announces for one file, in UTF-8 bytes. */
const MAX_PATH_BYTES = 512;
/** Deepest folder nesting kept on receive. */
const MAX_PATH_SEGMENTS = 12;
const INDEX_LENGTH_BYTES = 4;
const encoder = new TextEncoder();

/** A file to send: its path or name, type and bytes. */
export interface BundleSource {
  /** Relative path (`photos/a.jpg`) or a bare name. */
  path: string;
  mimeType: string;
  data: Uint8Array;
}

/** A file after it was unpacked and checked. */
export interface BundleFile {
  /** The path the file will be saved under, cleaned: no `..`, no root, no hidden characters. */
  path: string;
  mimeType: string;
  size: number;
  sha256: string;
  data: Uint8Array;
}

/**
 * Cleans a path a stranger announced, one segment at a time. A segment of dots, a drive letter, a
 * leading slash or a hidden direction mark can never lead outside the folder the files are saved to.
 * @param raw - The announced path.
 * @returns A relative path using `/`, never empty. Parts that cannot be kept become `_`.
 */
export function sanitizeRelativePath(raw: string): string {
  const segments = raw.split(/[\\/]+/).filter((segment) => segment.length > 0);
  const kept = segments.slice(-MAX_PATH_SEGMENTS).map((segment, index, all) => {
    // A name keeps its extension; a folder name is a plain stem.
    return sanitizeFileName(segment, { fallback: '_', maxLength: 120, stem: index < all.length - 1 });
  });
  return kept.length > 0 ? kept.join('/') : 'file';
}

/**
 * Lays files out as one message: a 4-byte index length, a CBOR index (path, size, type, SHA-256 of
 * each file) and then the files' bytes one after another. The sender compresses the whole message once.
 * @param sources - The files, in order.
 * @returns The message and the index entries.
 * @throws RangeError when there are too many files or too many bytes.
 */
export async function packBundle(sources: readonly BundleSource[]): Promise<{ message: Uint8Array; entries: PrismFileEntry[] }> {
  if (sources.length < 1 || sources.length > MAX_BUNDLE_ENTRIES) {
    throw new RangeError(`A transfer carries 1 to ${MAX_BUNDLE_ENTRIES} files.`);
  }
  const total = sources.reduce((sum, source) => sum + source.data.length, 0);
  if (total > MAX_RECEIVE_BYTES) throw new RangeError('The files are larger than a transfer can carry.');

  const entries: PrismFileEntry[] = [];
  for (const source of sources) {
    const mime = source.mimeType || 'application/octet-stream';
    entries.push({
      name: fitFileName(source.path || 'file', MAX_PATH_BYTES),
      size: source.data.length,
      mimeType: encoder.encode(mime).length > MAX_MANIFEST_MIME_BYTES ? 'application/octet-stream' : mime,
      sha256: await sha256Hex(source.data),
    });
  }
  const index = cborEncode(entries.map((entry) => [entry.name, entry.size, entry.mimeType, hexToBytes(entry.sha256)]));
  const message = new Uint8Array(INDEX_LENGTH_BYTES + index.length + total);
  new DataView(message.buffer).setUint32(0, index.length);
  message.set(index, INDEX_LENGTH_BYTES);
  let offset = INDEX_LENGTH_BYTES + index.length;
  for (const source of sources) {
    message.set(source.data, offset);
    offset += source.data.length;
  }
  return { message, entries };
}

/**
 * Reads a bundle message and checks every file against its hash. One bad file fails the whole bundle.
 * @param message - The unpacked message from {@link packBundle}.
 * @returns The files, with cleaned paths that are unique within the bundle.
 * @throws Error when the index is malformed, claims more than the limits allow, or a file does not match its hash.
 */
export async function unpackBundle(message: Uint8Array): Promise<BundleFile[]> {
  const bad = (reason: string) => new Error(`The file list of this transfer is damaged (${reason}).`);
  if (message.length < INDEX_LENGTH_BYTES) throw bad('too short');
  const indexLength = new DataView(message.buffer, message.byteOffset, message.byteLength).getUint32(0);
  if (indexLength > MAX_INDEX_BYTES || INDEX_LENGTH_BYTES + indexLength > message.length) throw bad('index length');
  let index;
  try {
    index = cborDecode(message.subarray(INDEX_LENGTH_BYTES, INDEX_LENGTH_BYTES + indexLength));
  } catch {
    throw bad('unreadable index');
  }
  if (!Array.isArray(index) || index.length < 1 || index.length > MAX_BUNDLE_ENTRIES) throw bad('file count');

  const files: BundleFile[] = [];
  const taken = new Set<string>();
  let offset = INDEX_LENGTH_BYTES + indexLength;
  let total = 0;
  for (const item of index) {
    if (!Array.isArray(item) || item.length !== 4) throw bad('entry');
    const [path, size, mimeType, hash] = item;
    if (
      typeof path !== 'string' ||
      encoder.encode(path).length > MAX_PATH_BYTES * 2 ||
      typeof mimeType !== 'string' ||
      encoder.encode(mimeType).length > MAX_MANIFEST_MIME_BYTES * 2 ||
      typeof size !== 'number' ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      !(hash instanceof Uint8Array) ||
      hash.length !== 32
    ) {
      throw bad('entry');
    }
    total += size;
    if (total > MAX_RECEIVE_BYTES || offset + size > message.length) throw bad('sizes');
    const data = message.subarray(offset, offset + size);
    offset += size;
    const actual = await sha256Hex(data);
    const expected = bytesToHex(hash);
    if (actual !== expected) throw new Error(`Integrity validation failed! ${analyseReceivedFile(path, mimeType).safeName} does not match its SHA-256.`);
    files.push({ path: uniquePath(sanitizeRelativePath(path), taken), mimeType, size, sha256: actual, data });
  }
  if (offset !== message.length) throw bad('trailing bytes');
  return files;
}

/** Appends ` (2)`, ` (3)` ... before the extension until the path is new. */
function uniquePath(path: string, taken: Set<string>): string {
  let candidate = path;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    candidate = dot > slash + 1 ? `${path.slice(0, dot)} (${n})${path.slice(dot)}` : `${path} (${n})`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}
