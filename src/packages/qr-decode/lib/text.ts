/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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
 * Turns a decoded symbol's segments into text. Numeric and alphanumeric data is
 * ASCII, kanji is Shift JIS and hanzi GB 2312. Byte data follows the ECI in
 * force; without one it is UTF-8 when it is valid UTF-8 (what phones and every
 * generator write today) and Latin-1 otherwise (the standard's default).
 */

export type QrReadMode = 'numeric' | 'alphanumeric' | 'byte' | 'kanji' | 'hanzi';

/** One data segment of a read code. */
export interface QrReadSegment {
  mode: QrReadMode;
  /** The ECI assignment in force, or null. */
  eci: number | null;
  bytes: Uint8Array;
}

/** A segment record as the module writes it. */
export interface SegmentRecord {
  mode: number;
  eci: number | null;
  start: number;
  length: number;
}

const MODES: Record<number, QrReadMode> = { 1: 'numeric', 2: 'alphanumeric', 4: 'byte', 8: 'kanji', 13: 'hanzi' };

/** ECI assignments with a WHATWG encoding (AIM ECI specification). */
const ECI_ENCODINGS: Record<number, string> = {
  0: 'ibm437',
  1: 'iso-8859-1',
  2: 'ibm437',
  3: 'iso-8859-1',
  4: 'iso-8859-2',
  5: 'iso-8859-3',
  6: 'iso-8859-4',
  7: 'iso-8859-5',
  8: 'iso-8859-6',
  9: 'iso-8859-7',
  10: 'iso-8859-8',
  11: 'windows-874',
  13: 'iso-8859-11',
  15: 'iso-8859-13',
  16: 'iso-8859-14',
  17: 'iso-8859-15',
  18: 'iso-8859-16',
  20: 'shift_jis',
  21: 'windows-1250',
  22: 'windows-1251',
  23: 'windows-1252',
  24: 'windows-1256',
  25: 'utf-16be',
  26: 'utf-8',
  27: 'utf-8',
  28: 'big5',
  29: 'gbk',
  30: 'euc-kr',
  32: 'gb18030',
};

const decoders = new Map<string, TextDecoder | null>();

function decoderFor(label: string, fatal = false): TextDecoder | null {
  const key = `${label}${fatal ? ':fatal' : ''}`;
  if (!decoders.has(key)) {
    let decoder: TextDecoder | null = null;
    try {
      decoder = new TextDecoder(label, { fatal });
    } catch {
      // An engine without this encoding: the caller falls back to Latin-1.
    }
    decoders.set(key, decoder);
  }
  return decoders.get(key) ?? null;
}

function latin1(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

function decodeBytes(bytes: Uint8Array, label: string | null): string {
  if (label) {
    const decoder = decoderFor(label);
    if (decoder) return decoder.decode(bytes);
    return latin1(bytes);
  }
  try {
    return decoderFor('utf-8', true)?.decode(bytes) ?? latin1(bytes);
  } catch {
    return latin1(bytes);
  }
}

function labelFor(segment: QrReadSegment): string | null {
  switch (segment.mode) {
    case 'numeric':
    case 'alphanumeric':
      return 'iso-8859-1';
    case 'kanji':
      return 'shift_jis';
    case 'hanzi':
      return 'gb18030';
    default:
      return segment.eci === null ? null : (ECI_ENCODINGS[segment.eci] ?? null);
  }
}

/**
 * Splits a code's bytes into its segments and decodes them. Neighbouring byte
 * segments without an ECI are decoded together, so a UTF-8 character split
 * across two segments still reads.
 */
export function decodeSegments(bytes: Uint8Array, records: readonly SegmentRecord[]): { text: string; segments: QrReadSegment[] } {
  const segments: QrReadSegment[] = [];
  for (const record of records) {
    const mode = MODES[record.mode];
    if (!mode) continue;
    segments.push({ mode, eci: record.eci, bytes: bytes.subarray(record.start, record.start + record.length) });
  }
  let text = '';
  let pending: Uint8Array[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    const joined = new Uint8Array(pending.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of pending) {
      joined.set(b, at);
      at += b.length;
    }
    text += decodeBytes(joined, null);
    pending = [];
  };
  for (const segment of segments) {
    const label = labelFor(segment);
    if (label === null) {
      pending.push(segment.bytes);
      continue;
    }
    flush();
    text += decodeBytes(segment.bytes, label);
  }
  flush();
  return { text, segments };
}
