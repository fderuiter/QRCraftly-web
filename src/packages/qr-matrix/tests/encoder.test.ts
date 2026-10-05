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

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { instantiateWasmSync } from '@/packages/wasm-runtime';
import { QRErrorCorrectionLevel } from '@/types';
import { QR_ENCODE_WASM_URL, QrEncodeError, createQrEncoder, loadQrEncoder, type QrSymbol } from '../encoder';

const wasm = fs.readFileSync(new URL('../../../wasm/qr-encode.wasm', import.meta.url));
const instance = instantiateWasmSync(new WebAssembly.Module(wasm));
const encoder = createQrEncoder(instance);

const decode = (symbol: QrSymbol) => symbol.segments.map((s) => [s.mode, new TextDecoder().decode(s.bytes)]);

function expectError(run: () => unknown, kind: QrEncodeError['kind'], message?: RegExp): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(QrEncodeError);
    if (error instanceof QrEncodeError) {
      expect(error.kind).toBe(kind);
      if (message) expect(error.message).toMatch(message);
    }
    return;
  }
  throw new Error('expected a QrEncodeError');
}

describe('QR encoder (Rust module)', () => {
  it('loads once from src/wasm/ under Node', async () => {
    expect(QR_ENCODE_WASM_URL.pathname).toMatch(/qr-encode\.wasm$/);
    const first = await loadQrEncoder();
    expect(await loadQrEncoder()).toBe(first);
    expect(first.create('hello').version).toBe(1);
  });

  it('returns the symbol, its modules and its segments', () => {
    const symbol = encoder.create('HELLO 12345678901234 world', { errorCorrectionLevel: QRErrorCorrectionLevel.M });
    expect(symbol.version).toBe(2);
    expect(symbol.errorCorrectionLevel).toBe('M');
    expect(symbol.maskPattern).toBeGreaterThanOrEqual(0);
    expect(symbol.maskPattern).toBeLessThan(8);
    const { size, data } = symbol.modules;
    expect(size).toBe(25);
    expect(data).toHaveLength(size * size);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) expect(symbol.modules.get(r, c)).toBe(data[r * size + c] === 1);
    }
    // Finder corners and the dark module.
    expect(symbol.modules.get(0, 0)).toBe(true);
    expect(symbol.modules.get(size - 8, 8)).toBe(true);
    expect(decode(symbol)).toEqual([
      ['alphanumeric', 'HELLO '],
      ['numeric', '12345678901234'],
      ['byte', ' world'],
    ]);
    expect(symbol.dataBits).toBe(4 + 9 + 33 + 4 + 10 + 47 + 4 + 8 + 48);
  });

  it('defaults to level M and accepts the level letters', () => {
    expect(encoder.create('x').errorCorrectionLevel).toBe('M');
    expect(encoder.create('x', { errorCorrectionLevel: 'H' }).errorCorrectionLevel).toBe('H');
  });

  it('honours a fixed version and mask, and raises the level when asked', () => {
    const fixed = encoder.create('fixed', { errorCorrectionLevel: 'L', version: 5, maskPattern: 6 });
    expect([fixed.version, fixed.maskPattern, fixed.modules.size]).toEqual([5, 6, 37]);
    expect(encoder.create('HI', { errorCorrectionLevel: 'L', boostErrorCorrection: true }).errorCorrectionLevel).toBe('H');
  });

  it('adds ECI and structured append headers', () => {
    const plain = encoder.create('ü');
    const eci = encoder.create('ü', { eci: 26 });
    expect(eci.segments[0]).toMatchObject({ mode: 'eci', chars: 26 });
    expect(eci.dataBits).toBe(plain.dataBits + 12);
    const part = encoder.create('ü', { structuredAppend: { index: 0, total: 2, parity: 0x12 } });
    expect(part.dataBits).toBe(plain.dataBits + 20);
  });

  it('encodes caller segments, kanji included', () => {
    const symbol = encoder.create(
      [
        { mode: 'alphanumeric', data: 'PRISM:' },
        { mode: 'byte', data: new Uint8Array([0, 255]) },
        { mode: 'kanji', data: new Uint8Array([0x93, 0x5f]) },
      ],
      { errorCorrectionLevel: 'L' }
    );
    expect(symbol.segments.map((s) => [s.mode, s.chars])).toEqual([
      ['alphanumeric', 6],
      ['byte', 2],
      ['kanji', 1],
    ]);
    expect(Array.from(symbol.segments[1].bytes)).toEqual([0, 255]);
    expectError(() => encoder.create([{ mode: 'numeric', data: '12a' }]), 'invalid');
  });

  it('refuses empty, oversized and malformed input with typed errors', () => {
    expectError(() => encoder.create(''), 'empty', /No input text/);
    expectError(() => encoder.create('x'.repeat(2954), { errorCorrectionLevel: 'L' }), 'too-long', /too big/);
    expectError(() => encoder.create('too long for one', { errorCorrectionLevel: 'H', version: 1 }), 'too-long', /version \(1\)/);
    expectError(() => encoder.create('x', { version: 41 }), 'invalid');
    expectError(() => encoder.create('x', { maskPattern: 8 }), 'invalid');
    expectError(() => encoder.create('x', { eci: -1 }), 'invalid');
    expectError(() => encoder.create('x', { structuredAppend: { index: 0, total: 1, parity: 0 } }), 'invalid');
    expectError(() => encoder.create('x', { errorCorrectionLevel: 'X' as 'L' }), 'invalid');
    expectError(() => encoder.create(undefined as unknown as string), 'invalid');
  });

  it('reuses module memory from one encode to the next', () => {
    const text = 'z'.repeat(2900);
    encoder.create(text, { errorCorrectionLevel: 'L' });
    const after = instance.memory.buffer.byteLength;
    for (let i = 0; i < 50; i++) encoder.create(text, { errorCorrectionLevel: 'L' });
    expect(instance.memory.buffer.byteLength).toBe(after);
  });
});
