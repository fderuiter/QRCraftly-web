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

import { beforeAll, describe, expect, it } from 'vitest';
import { FecDecoder, FecEncoder, MAX_FEC_SOURCE_SYMBOLS, isValidFecLayout, loadFecModule, planBlocks, type FecLayout } from '../index';

let module: WebAssembly.Module;

beforeAll(async () => {
  module = await loadFecModule();
});

function message(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let s = seed;
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    bytes[i] = s >>> 24;
  }
  return bytes;
}

describe('planBlocks', () => {
  it('splits evenly with the larger blocks first', () => {
    expect(planBlocks(1)).toEqual([1]);
    expect(planBlocks(8192)).toEqual([8192]);
    expect(planBlocks(8193)).toEqual([4097, 4096]);
    expect(planBlocks(2049, 2048)).toEqual([1025, 1024]);
    expect(planBlocks(10, 4)).toEqual([4, 3, 3]);
    expect(planBlocks(100_000, 1 << 20).every((k) => k <= MAX_FEC_SOURCE_SYMBOLS)).toBe(true);
  });
});

describe('isValidFecLayout', () => {
  const good: FecLayout = { messageLength: 1000, symbolSize: 64, seed: 7, blocks: [16] };
  it('accepts a consistent layout and refuses anything out of range', () => {
    expect(isValidFecLayout(good)).toBe(true);
    expect(isValidFecLayout({ ...good, symbolSize: 12 })).toBe(false);
    expect(isValidFecLayout({ ...good, symbolSize: 2048 })).toBe(false);
    expect(isValidFecLayout({ ...good, blocks: [15] })).toBe(false);
    expect(isValidFecLayout({ ...good, blocks: [] })).toBe(false);
    expect(isValidFecLayout({ ...good, blocks: [8, 8.5] })).toBe(false);
    expect(isValidFecLayout({ ...good, seed: -1 })).toBe(false);
    expect(isValidFecLayout({ messageLength: 64 * 9000, symbolSize: 64, seed: 1, blocks: [9000] })).toBe(false);
    expect(() => new FecDecoder(module, { ...good, blocks: [15] })).toThrow(RangeError);
  });
});

describe('FecEncoder and FecDecoder', () => {
  it('round-trip a multi-block message after a join, with loss and duplicates', () => {
    const data = message(20_000, 1);
    const encoder = new FecEncoder(module, data, { maxBlockSymbols: 100 });
    expect(encoder.layout.blocks).toEqual([79, 78, 78, 78]);
    const decoder = new FecDecoder(module, encoder.layout);
    let index = 5_000;
    let drop = 0;
    while (!decoder.isComplete && index < 7_000) {
      const symbol = encoder.symbol(index++);
      drop = (drop + 7) % 10;
      if (drop < 3) continue;
      decoder.add(symbol);
      if (drop === 9) expect(decoder.add(symbol)).toBe(false);
    }
    expect(decoder.isComplete).toBe(true);
    expect(decoder.progress).toBe(1);
    expect(decoder.finalize()).toEqual(data);
    // A few symbols beyond the 313 source symbols, plus the duplicates.
    expect(decoder.symbolsReceived).toBeLessThan(313 + 40 + 60);
  });

  it('reports progress as rank of what is needed', () => {
    const data = message(640, 2);
    const encoder = new FecEncoder(module, data, { symbolSize: 64, seed: 9 });
    const decoder = new FecDecoder(module, encoder.layout);
    expect(decoder.progress).toBe(0);
    expect(decoder.add(encoder.symbol(0))).toBe(true);
    expect(decoder.rank).toBe(1);
    expect(decoder.progress).toBeCloseTo(1 / 10);
    expect(decoder.finalize()).toBeNull();
  });

  it('round-trips empty and single-byte messages', () => {
    for (const data of [new Uint8Array(0), new Uint8Array([42])]) {
      const encoder = new FecEncoder(module, data);
      const decoder = new FecDecoder(module, encoder.layout);
      for (let i = 0; !decoder.isComplete && i < 50; i++) decoder.add(encoder.symbol(i));
      expect(decoder.finalize()).toEqual(data);
    }
  });

  it('ignores symbols for blocks that do not exist or have the wrong size', () => {
    const data = message(300, 3);
    const encoder = new FecEncoder(module, data);
    const decoder = new FecDecoder(module, encoder.layout);
    expect(decoder.add({ block: 1, esi: 0, data: new Uint8Array(64) })).toBe(false);
    expect(decoder.add({ block: 0, esi: 0, data: new Uint8Array(8) })).toBe(false);
    expect(decoder.rank).toBe(0);
  });

  it('gives the same symbols for the same message and seed', () => {
    const data = message(5_000, 4);
    const a = new FecEncoder(module, data, { seed: 1 });
    const b = new FecEncoder(module, data, { seed: 1 });
    const c = new FecEncoder(module, data, { seed: 2 });
    expect(a.symbol(17).data).toEqual(b.symbol(17).data);
    expect(a.symbol(17).data).not.toEqual(c.symbol(17).data);
  });
});
