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

import { crc32 } from '@/packages/optical-transfer/checksum';

/** One file to store in a ZIP archive. */
export interface ZipEntry {
  /** Path inside the archive, `/`-separated. Stored as UTF-8. */
  name: string;
  /** File contents. Strings are encoded as UTF-8. */
  data: Uint8Array | string;
}

/** Options for {@link createZip}. */
export interface CreateZipOptions {
  /** Modification time written for every entry. Defaults to now. */
  date?: Date;
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;
/** ZIP 2.0: the lowest version that readers accept for stored entries with folders. */
const VERSION = 20;
/** General purpose bit 11: file name and comment are UTF-8. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const MAX_ENTRIES = 0xffff;
const MAX_UINT32 = 0xffffffff;
/** The name length field is 16 bits. */
const MAX_NAME_BYTES = 0xffff;

/** Packs a date into MS-DOS time and date words (2-second resolution, 1980 to 2107). */
function toDosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function assertSafeName(name: string): void {
  if (name.length === 0) throw new Error('ZIP entry names must not be empty.');
  const parts = name.split('/');
  // A trailing `/` marks a folder entry, so only the last segment may be empty.
  const emptyInside = parts.slice(0, -1).some((part) => part === '');
  if (
    name.startsWith('/') ||
    name.includes('\\') ||
    /^[a-z]:/i.test(name) ||
    emptyInside ||
    parts.some((part) => part === '..' || part === '.')
  ) {
    throw new Error(`Unsafe ZIP entry name: ${name}`);
  }
}

/**
 * Builds a ZIP archive with every entry stored uncompressed (method 0), a CRC-32
 * per entry, a central directory and an end-of-central-directory record. Names are
 * flagged as UTF-8 (general purpose bit 11). ZIP64 is not supported: the archive
 * must stay under 4 GiB and 65,535 entries.
 * @throws {Error} on duplicate or unsafe names, or when the ZIP64 limits are exceeded.
 */
export function createZip(entries: readonly ZipEntry[], options: CreateZipOptions = {}): Uint8Array {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`A ZIP archive without ZIP64 holds at most ${MAX_ENTRIES} entries.`);
  }
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const dos = toDosDateTime(options.date ?? new Date());
  const seen = new Set<string>();

  const prepared = entries.map((entry) => {
    assertSafeName(entry.name);
    const nameBytes = encoder.encode(entry.name);
    if (nameBytes.length > MAX_NAME_BYTES) {
      throw new Error(`ZIP entry names are limited to ${MAX_NAME_BYTES} UTF-8 bytes.`);
    }
    // Compare what is written: a lone surrogate encodes as U+FFFD, so two different strings
    // can end up as the same name in the archive.
    const key = decoder.decode(nameBytes);
    if (seen.has(key)) throw new Error(`Duplicate ZIP entry name: ${entry.name}`);
    seen.add(key);
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    return { nameBytes, data, crc: crc32(data) };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const p of prepared) {
    localSize += LOCAL_HEADER_SIZE + p.nameBytes.length + p.data.length;
    centralSize += CENTRAL_HEADER_SIZE + p.nameBytes.length;
  }
  if (localSize + centralSize + END_RECORD_SIZE > MAX_UINT32) {
    throw new Error('The ZIP archive would exceed 4 GiB, which needs ZIP64.');
  }

  const out = new Uint8Array(localSize + centralSize + END_RECORD_SIZE);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let pos = 0;

  for (const p of prepared) {
    offsets.push(pos);
    view.setUint32(pos, LOCAL_FILE_HEADER_SIGNATURE, true);
    view.setUint16(pos + 4, VERSION, true);
    view.setUint16(pos + 6, FLAG_UTF8, true);
    view.setUint16(pos + 8, METHOD_STORE, true);
    view.setUint16(pos + 10, dos.time, true);
    view.setUint16(pos + 12, dos.date, true);
    view.setUint32(pos + 14, p.crc, true);
    view.setUint32(pos + 18, p.data.length, true);
    view.setUint32(pos + 22, p.data.length, true);
    view.setUint16(pos + 26, p.nameBytes.length, true);
    view.setUint16(pos + 28, 0, true);
    out.set(p.nameBytes, pos + LOCAL_HEADER_SIZE);
    out.set(p.data, pos + LOCAL_HEADER_SIZE + p.nameBytes.length);
    pos += LOCAL_HEADER_SIZE + p.nameBytes.length + p.data.length;
  }

  const centralOffset = pos;
  prepared.forEach((p, index) => {
    view.setUint32(pos, CENTRAL_DIRECTORY_SIGNATURE, true);
    view.setUint16(pos + 4, VERSION, true);
    view.setUint16(pos + 6, VERSION, true);
    view.setUint16(pos + 8, FLAG_UTF8, true);
    view.setUint16(pos + 10, METHOD_STORE, true);
    view.setUint16(pos + 12, dos.time, true);
    view.setUint16(pos + 14, dos.date, true);
    view.setUint32(pos + 16, p.crc, true);
    view.setUint32(pos + 20, p.data.length, true);
    view.setUint32(pos + 24, p.data.length, true);
    view.setUint16(pos + 28, p.nameBytes.length, true);
    // Extra field, comment, disk number, internal and external attributes stay 0.
    view.setUint32(pos + 42, offsets[index], true);
    out.set(p.nameBytes, pos + CENTRAL_HEADER_SIZE);
    pos += CENTRAL_HEADER_SIZE + p.nameBytes.length;
  });

  view.setUint32(pos, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(pos + 8, prepared.length, true);
  view.setUint16(pos + 10, prepared.length, true);
  view.setUint32(pos + 12, pos - centralOffset, true);
  view.setUint32(pos + 16, centralOffset, true);
  return out;
}
