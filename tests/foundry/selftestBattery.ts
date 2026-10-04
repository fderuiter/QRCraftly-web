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
 * A fixed workload for the self-test module whose output must be identical, byte for byte, in Node
 * and in every browser engine (#1182, ADR 0033). Vitest pins its SHA-256 and Playwright compares
 * each engine's hash with Node's.
 */

/** SHA-256 of {@link runSelftestBattery}'s output for the committed `src/wasm/selftest.wasm`. */
export const SELFTEST_BATTERY_SHA256 = '37140a31ba61ccec749dc8d47227f96de14c53bcd21e53141d812be691d7b3e2';

/**
 * Runs every self-test export on seeded inputs and returns all results as one byte string.
 *
 * Playwright copies this function's source into a worker, so it must stay self-contained: no
 * imports, helpers or values from outside its body.
 * @param exports - The raw exports of an instantiated `selftest.wasm`.
 * @returns The concatenated results.
 */
export function runSelftestBattery(exports: WebAssembly.Exports): Uint8Array {
  const call = (name: string, ...args: number[]): number => {
    const target = exports[name];
    if (typeof target !== 'function') throw new Error(`selftest.wasm has no ${name} export`);
    return Number(Reflect.apply(target, undefined, args));
  };
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('selftest.wasm does not export its memory');

  // The same mulberry32 generator as tests/utils/scannerCorpus.ts, inlined.
  let state = 0x1182;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randomBytes = (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(random() * 256);
    return bytes;
  };

  const out: number[] = [];
  const pushU32 = (value: number): void => {
    out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  };

  // CRC-32 over buffers from empty to 4 KB.
  for (let i = 0; i < 64; i++) {
    const data = randomBytes(i === 0 ? 0 : Math.floor(random() * 4096));
    const ptr = call('alloc', Math.max(1, data.length));
    new Uint8Array(memory.buffer, ptr, data.length).set(data);
    pushU32(call('selftest_crc32', ptr, data.length) >>> 0);
    call('free', ptr, Math.max(1, data.length));
  }

  // The whole GF(256) multiplication table.
  for (let a = 0; a < 256; a++) {
    for (let b = 0; b < 256; b++) out.push(call('selftest_gf_mul', a, b) & 0xff);
  }

  // Scaling buffers, including the rejected factors and a short output buffer.
  const factors = [0, 1, 2, 0x1d, 0x80, 255, 256];
  for (let i = 0; i < 16; i++) {
    const data = randomBytes(1 + Math.floor(random() * 512));
    const factor = i < factors.length ? factors[i] : 1 + Math.floor(random() * 255);
    const outLen = i === 15 ? data.length - 1 : data.length;
    const inPtr = call('alloc', data.length);
    const outPtr = call('alloc', Math.max(1, outLen));
    new Uint8Array(memory.buffer, inPtr, data.length).set(data);
    const status = call('selftest_scale', inPtr, data.length, factor, outPtr, outLen);
    pushU32(status >>> 0);
    if (status === 0) out.push(...new Uint8Array(memory.buffer, outPtr, outLen));
    call('free', outPtr, Math.max(1, outLen));
    call('free', inPtr, data.length);
  }

  pushU32(call('abi_version') >>> 0);
  return new Uint8Array(out);
}
