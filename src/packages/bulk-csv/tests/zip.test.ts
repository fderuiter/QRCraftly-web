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

import { describe, it, expect } from 'vitest';
import { crc32 as nodeCrc32 } from 'node:zlib';
import { createZip, allocateFileName, sanitizeFileStem } from '../index';

interface ParsedEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  dosTime: number;
  dosDate: number;
  data: Uint8Array;
}

/**
 * Independent reader for the archive layout in APPNOTE.TXT: walks the end record,
 * then the central directory, then each local header, cross-checking every field
 * the two headers share.
 */
function readZip(bytes: Uint8Array): ParsedEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 4, true)).toBe(0); // this disk
  expect(view.getUint16(end + 6, true)).toBe(0); // central directory disk
  const count = view.getUint16(end + 8, true);
  expect(view.getUint16(end + 10, true)).toBe(count);
  const cdSize = view.getUint32(end + 12, true);
  const cdOffset = view.getUint32(end + 16, true);
  expect(view.getUint16(end + 20, true)).toBe(0); // comment length
  expect(cdOffset + cdSize).toBe(end);

  const entries: ParsedEntry[] = [];
  let pos = cdOffset;
  let expectedLocal = 0;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(pos, true)).toBe(0x02014b50);
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const dosTime = view.getUint16(pos + 12, true);
    const dosDate = view.getUint16(pos + 14, true);
    const crc = view.getUint32(pos + 16, true);
    const compressed = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    expect(compressed).toBe(size);
    expect(localOffset).toBe(expectedLocal);

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(view.getUint16(localOffset + 6, true)).toBe(flags);
    expect(view.getUint16(localOffset + 8, true)).toBe(method);
    expect(view.getUint16(localOffset + 10, true)).toBe(dosTime);
    expect(view.getUint16(localOffset + 12, true)).toBe(dosDate);
    expect(view.getUint32(localOffset + 14, true)).toBe(crc);
    expect(view.getUint32(localOffset + 18, true)).toBe(size);
    expect(view.getUint32(localOffset + 22, true)).toBe(size);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    expect(localNameLen).toBe(nameLen);
    expect(decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLen))).toBe(name);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(dataStart, dataStart + size);
    expectedLocal = dataStart + size;

    entries.push({ name, flags, method, crc, dosTime, dosDate, data });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  expect(expectedLocal).toBe(cdOffset);
  return entries;
}

const FIXED_DATE = new Date(2026, 9, 2, 13, 45, 31);

describe('createZip', () => {
  it('round-trips stored entries with matching CRC-32 values', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255, 128]);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    const zip = createZip(
      [
        { name: 'codes/first.png', data: png },
        { name: 'second.svg', data: svg },
        { name: 'empty.txt', data: new Uint8Array(0) },
      ],
      { date: FIXED_DATE }
    );

    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['codes/first.png', 'second.svg', 'empty.txt']);
    expect(Array.from(entries[0].data)).toEqual(Array.from(png));
    expect(new TextDecoder().decode(entries[1].data)).toBe(svg);
    expect(entries[2].data).toHaveLength(0);
    for (const entry of entries) {
      expect(entry.method).toBe(0);
      expect(entry.crc).toBe(nodeCrc32(entry.data));
    }
    expect(entries[2].crc).toBe(0);
  });

  it('flags names as UTF-8 (general purpose bit 11) and stores them as UTF-8', () => {
    const [entry] = readZip(createZip([{ name: 'Zoë-東京.png', data: 'x' }], { date: FIXED_DATE }));
    expect(entry.flags & 0x0800).toBe(0x0800);
    expect(entry.name).toBe('Zoë-東京.png');
  });

  it('encodes the modification time as MS-DOS date and time', () => {
    const [entry] = readZip(createZip([{ name: 'a.txt', data: 'a' }], { date: FIXED_DATE }));
    expect(entry.dosDate).toBe(((2026 - 1980) << 9) | (10 << 5) | 2);
    expect(entry.dosTime).toBe((13 << 11) | (45 << 5) | 15);
  });

  it('clamps dates before 1980 to the DOS epoch', () => {
    const [entry] = readZip(createZip([{ name: 'a.txt', data: 'a' }], { date: new Date(1970, 0, 1) }));
    expect(entry.dosDate >> 9).toBe(0);
  });

  it('writes a valid empty archive', () => {
    const zip = createZip([], { date: FIXED_DATE });
    expect(zip).toHaveLength(22);
    expect(readZip(zip)).toEqual([]);
  });

  it('matches a known CRC-32 check value', () => {
    const [entry] = readZip(createZip([{ name: 'check.txt', data: '123456789' }], { date: FIXED_DATE }));
    expect(entry.crc).toBe(0xcbf43926);
  });

  it('rejects duplicate and unsafe entry names', () => {
    expect(() => createZip([{ name: 'a.png', data: '' }, { name: 'a.png', data: '' }])).toThrow(/Duplicate/);
    expect(() => createZip([{ name: '', data: '' }])).toThrow(/empty/);
    expect(() => createZip([{ name: '/etc/passwd', data: '' }])).toThrow(/Unsafe/);
    expect(() => createZip([{ name: '../evil.png', data: '' }])).toThrow(/Unsafe/);
    expect(() => createZip([{ name: 'a\\b.png', data: '' }])).toThrow(/Unsafe/);
  });

  it('rejects drive letters, `.` and empty segments, and over-long names (#1288)', () => {
    // Built from parts: a drive letter is exactly what this ZIP writer must refuse.
    expect(() => createZip([{ name: ['C:', 'x.png'].join('/'), data: '' }])).toThrow(/Unsafe/);
    expect(() => createZip([{ name: 'a/./b.png', data: '' }])).toThrow(/Unsafe/);
    expect(() => createZip([{ name: 'dir//x.png', data: '' }])).toThrow(/Unsafe/);
    expect(() => createZip([{ name: `${'a'.repeat(70000)}.txt`, data: 'hello' }])).toThrow(/65535 UTF-8 bytes/);
    expect(() => createZip([{ name: 'folder/', data: '' }])).not.toThrow();
  });

  it('treats names that encode to the same bytes as duplicates (#1288)', () => {
    // Two different lone surrogates both become U+FFFD when written as UTF-8.
    expect(() => createZip([{ name: 'x\uD83C.png', data: '' }, { name: 'x\uD83D.png', data: '' }])).toThrow(/Duplicate/);
  });
});

describe('file name helpers', () => {
  it('replaces reserved and control characters and drops leading dots', () => {
    expect(sanitizeFileStem('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(sanitizeFileStem('tab\there')).toBe('tab_here');
    expect(sanitizeFileStem('..hidden')).toBe('hidden');
    expect(sanitizeFileStem('  Café menu  ')).toBe('Café menu');
  });

  it('falls back when nothing usable is left and caps the length', () => {
    expect(sanitizeFileStem('   ')).toBe('qr_code');
    expect(sanitizeFileStem('...', 'row_3')).toBe('row_3');
    expect(sanitizeFileStem('x'.repeat(300))).toHaveLength(100);
  });

  it('keeps every entry name within 255 UTF-8 bytes (#1288)', () => {
    const name = allocateFileName(sanitizeFileStem('日'.repeat(300)), 'png', new Set());
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
    const many = new Set<string>();
    const stem = sanitizeFileStem('🎉'.repeat(300));
    for (let i = 0; i < 500; i++) allocateFileName(stem, 'png', many);
    for (const used of many) expect(new TextEncoder().encode(used).length).toBeLessThanOrEqual(255);
  });

  it('never cuts a character in half, so rows cannot collide in the archive (#1288)', () => {
    const a = sanitizeFileStem(`x${'🎉'.repeat(50)}`);
    const b = sanitizeFileStem(`x${'🎉'.repeat(49)}😀`);
    const isLoneSurrogate = (ch: string) => ch.length === 1 && /[\uD800-\uDFFF]/.test(ch);
    expect(Array.from(a).some(isLoneSurrogate)).toBe(false);
    expect(Array.from(b).some(isLoneSurrogate)).toBe(false);
    const used = new Set<string>();
    const names = [allocateFileName(a, 'png', used), allocateFileName(b, 'png', used)];
    expect(() => createZip(names.map((name) => ({ name, data: '' })))).not.toThrow();
  });

  it('prefixes Windows device names written with superscript digits (#1288)', () => {
    expect(sanitizeFileStem('COM¹')).toBe('_COM¹');
    expect(sanitizeFileStem('lpt³')).toBe('_lpt³');
    expect(sanitizeFileStem('CONIN$')).toBe('_CONIN$');
  });

  it('treats NFC and NFD spellings of a name as the same file', () => {
    const used = new Set<string>();
    expect(allocateFileName('Caf\u00e9', 'png', used)).toBe('Caf\u00e9.png');
    expect(allocateFileName('Cafe\u0301', 'png', used)).toBe('Cafe\u0301_2.png');
  });

  it('allocates unique names case-insensitively', () => {
    const used = new Set<string>();
    expect(allocateFileName('Code', 'png', used)).toBe('Code.png');
    expect(allocateFileName('code', 'png', used)).toBe('code_2.png');
    expect(allocateFileName('Code', 'png', used)).toBe('Code_3.png');
    expect(allocateFileName('Code', 'svg', used)).toBe('Code.svg');
  });
});
