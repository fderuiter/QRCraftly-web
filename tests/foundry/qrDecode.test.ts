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

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { QrEccLetter } from '@/packages/qr-matrix';
import { qrEncoder } from '../fixtures/qrEncoder';
import { createRandom } from '../utils/scannerCorpus';
import { committedModuleBytes, loadCommittedModule, runDifferential } from './differential';
import { QR_DECODE_BATTERY_SHA256, runQrDecodeBattery } from './qrDecodeBattery';
import { decodeRequest, prepareDecode, renderGrid } from './qrDecodeModule';

const LEVELS: readonly QrEccLetter[] = ['L', 'M', 'Q', 'H'];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $%*+-./:abcdefghijklmnopqrstuvwxyzé€😀';
const SCALE = 3;

interface Case {
  text: string;
  level: QrEccLetter;
}

function* cases(count: number): Generator<Case> {
  const random = createRandom(1178);
  for (let i = 0; i < count; i++) {
    const length = 1 + Math.floor(random() * 120);
    const text = Array.from({ length }, () => [...ALPHABET][Math.floor(random() * [...ALPHABET].length)]).join('');
    yield { text, level: LEVELS[i % LEVELS.length] };
  }
}

function toRgba(grey: Uint8Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(grey.length * 4);
  for (let i = 0; i < grey.length; i++) rgba.set([grey[i], grey[i], grey[i], 255], i * 4);
  return rgba;
}

function hex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('Rust QR decoder (#1178)', () => {
  it('reads back the encoded bytes from every rendered code', async () => {
    const module = await loadCommittedModule('qr-decode');
    const report = runDifferential({
      name: 'qr_decode vs the encoder',
      inputs: cases(60),
      candidate: ({ text, level }) => {
        const grid = qrEncoder.create(text, { errorCorrectionLevel: level }).modules;
        const side = (grid.size + 8) * SCALE;
        const codes = prepareDecode(module, decodeRequest(renderGrid(grid, SCALE), side, side, 1))();
        return codes.map((code) => hex(code.bytes)).join(',');
      },
      reference: ({ text }) => hex(new TextEncoder().encode(text)),
    });
    expect(report).toMatchObject({ checked: 60, mismatchCount: 0 });
  });

  it('reads RGBA and grey frames alike, and reports the symbol', async () => {
    const module = await loadCommittedModule('qr-decode');
    const symbol = qrEncoder.create('https://qrcraftly.com/', { errorCorrectionLevel: 'Q', maskPattern: 5 });
    const grey = renderGrid(symbol.modules, 4, 200, 160);
    const fromGrey = prepareDecode(module, decodeRequest(grey, 200, 160, 1))();
    const fromRgba = prepareDecode(module, decodeRequest(new Uint8Array(toRgba(grey).buffer), 200, 160, 4))();
    expect(fromRgba).toEqual(fromGrey);
    expect(fromGrey).toHaveLength(1);
    expect(fromGrey[0]).toMatchObject({ version: symbol.version, ecc: 2, mask: 5, flags: 0 });
    expect(new TextDecoder().decode(fromGrey[0].bytes)).toBe('https://qrcraftly.com/');
  });

  it('finds nothing in a blank frame and rejects a malformed request', async () => {
    const module = await loadCommittedModule('qr-decode');
    expect(prepareDecode(module, decodeRequest(new Uint8Array(320 * 240).fill(128), 320, 240, 1))()).toEqual([]);
    const request = decodeRequest(new Uint8Array(16), 4, 4, 1);
    expect(() => prepareDecode(module, request.subarray(0, request.length - 1))()).toThrow(/status/);
  });

  it('gives the battery output the browser engines are compared against', async () => {
    const { instance } = await WebAssembly.instantiate(committedModuleBytes('qr-decode'), {});
    const counts: number[] = [];
    const digest = createHash('sha256').update(runQrDecodeBattery(instance.exports, counts)).digest('hex');
    // One code per frame, none in the light-on-dark frame without the inverted pass, two in the
    // shared frame, none in the blank and random frames, and four refused requests.
    expect(counts).toEqual([1, 1, 1, 1, 1, 1, 0, 1, 1, 2, 0, 0, -1, -1, -1, -1]);
    // A change to the module that alters this hash changes its output. If that is intended,
    // update QR_DECODE_BATTERY_SHA256 in tests/foundry/qrDecodeBattery.ts.
    expect(digest).toBe(QR_DECODE_BATTERY_SHA256);
  });
});
