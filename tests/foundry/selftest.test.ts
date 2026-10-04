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
import { crc32 } from '@/packages/optical-transfer';
import { committedModuleBytes, loadCommittedModule, runDifferential, seededBytes } from './differential';
import { SELFTEST_BATTERY_SHA256, runSelftestBattery } from './selftestBattery';

/** GF(256) over 0x11d by shift-and-add, the textbook definition. */
function gfMulReference(a: number, b: number): number {
  let product = 0;
  let x = a & 0xff;
  let y = b & 0xff;
  while (y > 0) {
    if (y & 1) product ^= x;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
    y >>= 1;
  }
  return product;
}

describe('Foundry differential harness (#1182)', () => {
  it('matches the self-test CRC-32 against the JavaScript one it could replace', async () => {
    const module = await loadCommittedModule('selftest');
    const crc = module.fn('selftest_crc32');
    const report = runDifferential({
      name: 'crc32',
      inputs: seededBytes(1182, 400, 4096),
      candidate: (bytes) => (bytes.length === 0 ? crc(0, 0) : module.withBytes(bytes, (ptr, len) => crc(ptr, len))) >>> 0,
      reference: (bytes) => crc32(bytes),
    });
    expect(report).toMatchObject({ checked: 400, mismatchCount: 0 });
  });

  it('matches GF(256) multiplication and scaling against shift-and-add', async () => {
    const module = await loadCommittedModule('selftest');
    const mul = module.fn('selftest_gf_mul');
    const pairs = Array.from({ length: 65536 }, (_, i) => [i >> 8, i & 0xff] as const);
    expect(runDifferential({ name: 'gf_mul', inputs: pairs, candidate: ([a, b]) => mul(a, b), reference: ([a, b]) => gfMulReference(a, b) }).mismatchCount).toBe(0);

    const scale = module.fn('selftest_scale');
    const report = runDifferential({
      name: 'scale',
      inputs: Array.from(seededBytes(7, 50, 600), (bytes, i) => ({ bytes, factor: (i * 37) % 256 })),
      candidate: ({ bytes, factor }) =>
        module.withBytes(bytes, (ptr, len) => {
          let status = 0;
          const out = module.withOutput(Math.max(1, len), (outPtr) => {
            status = scale(ptr, len, factor, outPtr, len);
          });
          if (status !== 0) throw new Error(`status ${status}`);
          return out.subarray(0, len);
        }),
      reference: ({ bytes, factor }) => {
        if (factor === 0) throw new Error('factor 0 is rejected');
        return bytes.map((byte) => gfMulReference(byte, factor));
      },
    });
    expect(report).toMatchObject({ checked: 50, mismatchCount: 0 });
  });

  it('lists the inputs where the two sides disagree', () => {
    const report = runDifferential({
      name: 'off by one',
      inputs: [0, 1, 2, 3],
      candidate: (n: number) => n,
      reference: (n: number) => {
        if (n === 3) throw new Error('no');
        return n === 2 ? 5 : n;
      },
    });
    expect(report.mismatchCount).toBe(2);
    expect(report.mismatches).toEqual([
      { input: '2', candidate: '2', reference: '5' },
      { input: '3', candidate: '3', reference: 'throws no' },
    ]);
  });

  it('caps the listed mismatches but counts them all', () => {
    const report = runDifferential({ name: 'all wrong', inputs: seededBytes(1, 25, 8), candidate: (b) => b.length, reference: () => -1 });
    expect(report.mismatchCount).toBe(25);
    expect(report.mismatches).toHaveLength(10);
  });
});

describe('the self-test battery (#1182)', () => {
  it('gives the pinned output in Node, the reference every browser engine is compared with', async () => {
    const instance = await WebAssembly.instantiate(committedModuleBytes('selftest'), {});
    const digest = createHash('sha256').update(runSelftestBattery(instance.instance.exports)).digest('hex');
    // A change to the module that alters this hash changes its behaviour. If that is intended,
    // update SELFTEST_BATTERY_SHA256 in tests/foundry/selftestBattery.ts.
    expect(digest).toBe(SELFTEST_BATTERY_SHA256);
  });
});
