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
 * Golden test for the Rust QR encoder (#1177) against `qrcode` 1.5.4, which it replaced.
 *
 * `tests/fixtures/qr-encode-golden.json.gz` holds 6,072 cases recorded once from
 * `qrcode` before it was removed: every payload template, Unicode, emoji, kanji,
 * control characters, numeric, alphanumeric and mixed text, all four levels, the
 * capacity of every version in each mode (and one character over), forced versions
 * and masks, and kanji mode through `qrcode`'s Shift JIS helper. Each case keeps the
 * version, mask, segments and a hash of the matrix `qrcode` produced.
 *
 * - Given the same segments, version and mask, our matrix is the same bit for bit.
 * - Left to choose, our version is never larger, and with the same segments the
 *   mask and matrix are the same. Where our segmentation differs it never uses more bits.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QrEncodeError, type QrEccLetter, type QrSegmentInput, type QrSegmentMode, type QrSymbol } from '@/packages/qr-matrix';
import { qrEncoder } from '../fixtures/qrEncoder';
import { committedModuleBytes } from './differential';
import { QR_ENCODE_BATTERY_SHA256, runQrEncodeBattery } from './qrEncodeBattery';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/qr-encode-golden.json.gz');

const PATTERNS = { n: '0123456789', a: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $%*+-./:', b: 'abcdefghijklmnopqrstuvwxyz' } as const;
type PatternKey = keyof typeof PATTERNS;
type SegmentRecord = [mode: 'N' | 'A' | 'B' | 'K', length: number, sjisHex?: string];

interface GoldenCase {
  tag: string;
  t: string | [PatternKey, number];
  e: QrEccLetter;
  v?: number;
  m?: number;
  k?: 1;
  V?: number;
  M?: number;
  B?: number;
  S?: SegmentRecord[];
  H?: string;
  X?: string;
}

const MODES: Record<SegmentRecord[0], QrSegmentMode> = { N: 'numeric', A: 'alphanumeric', B: 'byte', K: 'kanji' };

const fixture = JSON.parse(zlib.gunzipSync(fs.readFileSync(FIXTURE)).toString('utf8')) as { cases: GoldenCase[] };
const cases = fixture.cases;

function textOf(c: GoldenCase): string {
  if (typeof c.t === 'string') return c.t;
  const [key, length] = c.t;
  return PATTERNS[key].repeat(Math.ceil(length / PATTERNS[key].length)).slice(0, length);
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

function segmentsOf(c: GoldenCase, text: string): QrSegmentInput[] {
  let at = 0;
  return (c.S ?? []).map(([mode, length, sjis]) => {
    const data = text.slice(at, at + length);
    at += length;
    return { mode: MODES[mode], data: sjis === undefined ? data : hexBytes(sjis) };
  });
}

function matrixHash(symbol: QrSymbol): string {
  return crypto.createHash('sha256').update(symbol.modules.data).digest('hex').slice(0, 12);
}

/** Our segments as [mode, UTF-16 length], to compare with the recorded ones. */
function segmentShape(symbol: QrSymbol): string {
  const decoder = new TextDecoder();
  return JSON.stringify(symbol.segments.map((s) => [s.mode, decoder.decode(s.bytes).length]));
}

function recordedShape(c: GoldenCase): string {
  return JSON.stringify((c.S ?? []).map(([mode, length]) => [MODES[mode], length]));
}

describe('QR encoder golden corpus (qrcode 1.5.4)', () => {
  it('holds at least 5,000 cases across every category', () => {
    expect(cases.length).toBeGreaterThanOrEqual(5000);
    const tags = new Set(cases.map((c) => c.tag.split(':')[0]));
    expect([...tags].sort()).toEqual(['boundary', 'forced', 'kanji', 'template', 'text']);
    for (const level of ['L', 'M', 'Q', 'H']) expect(cases.some((c) => c.e === level)).toBe(true);
  });

  it('matches qrcode bit for bit given the same segments, version and mask', () => {
    const mismatches: string[] = [];
    for (const [i, c] of cases.entries()) {
      if (c.X) continue;
      const text = textOf(c);
      const symbol = qrEncoder.create(segmentsOf(c, text), { errorCorrectionLevel: c.e, version: c.V, maskPattern: c.M });
      if (matrixHash(symbol) !== c.H) mismatches.push(`#${i} ${c.tag}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('never needs a larger version than qrcode, and matches it where the segments agree', () => {
    const problems: string[] = [];
    let differentSegments = 0;
    for (const [i, c] of cases.entries()) {
      if (c.k) continue; // qrcode used kanji mode here; we never pick it ourselves.
      const text = textOf(c);
      const options = { errorCorrectionLevel: c.e, version: c.v, maskPattern: c.m };
      if (c.X) {
        try {
          qrEncoder.create(text, options);
          problems.push(`#${i} ${c.tag}: encoded what qrcode refused`);
        } catch (error) {
          if (!(error instanceof QrEncodeError) || error.kind !== 'too-long') problems.push(`#${i} ${c.tag}: ${String(error)}`);
        }
        continue;
      }
      const symbol = qrEncoder.create(text, options);
      const recordedVersion = c.V ?? 0;
      if (symbol.version > recordedVersion) {
        problems.push(`#${i} ${c.tag}: version ${symbol.version} > ${recordedVersion}`);
        continue;
      }
      if (segmentShape(symbol) === recordedShape(c)) {
        if (symbol.maskPattern !== c.M || matrixHash(symbol) !== c.H) problems.push(`#${i} ${c.tag}: same segments, different matrix`);
      } else {
        differentSegments++;
        if (symbol.version === recordedVersion && symbol.dataBits > (c.B ?? 0)) {
          problems.push(`#${i} ${c.tag}: ${symbol.dataBits} bits > ${c.B}`);
        }
      }
    }
    expect(problems).toEqual([]);
    // Our segmentation is optimal per character; qrcode's splits only at whole runs. When recorded
    // (#1177), 152 of 5,860 automatic encodings split differently: 42 in fewer bits, 110 in as many.
    expect(differentSegments).toBeLessThanOrEqual(152);
  });

  it('refuses what no version can hold with a typed error', () => {
    const over = cases.filter((c) => c.X === 'too-long');
    expect(over.length).toBeGreaterThan(0);
    for (const c of over) expect(() => qrEncoder.create(textOf(c), { errorCorrectionLevel: c.e })).toThrow(QrEncodeError);
  });
});

describe('QR encoder cross-engine battery', () => {
  it('pins the battery output that every browser engine must reproduce', async () => {
    const { instance } = await WebAssembly.instantiate(committedModuleBytes('qr-encode'), {});
    const digest = crypto.createHash('sha256').update(runQrEncodeBattery(instance.exports)).digest('hex');
    // A change to the module that alters this hash changes its output. If that is intended,
    // update QR_ENCODE_BATTERY_SHA256 in tests/foundry/qrEncodeBattery.ts.
    expect(digest).toBe(QR_ENCODE_BATTERY_SHA256);
  });
});
