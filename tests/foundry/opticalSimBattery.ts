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
 * A fixed workload for the optical print simulation module (#1556) whose output must be identical,
 * byte for byte, in Node and in every browser engine: the simulation is floating point, so this is
 * what shows every engine rounds it the same way. Vitest pins its SHA-256 and Playwright compares
 * each engine's hash with Node's.
 */

/** SHA-256 of {@link runOpticalSimBattery}'s output for the committed `src/wasm/optical-sim.wasm`. */
export const OPTICAL_SIM_BATTERY_SHA256 = '468b6945ae271e8a952155c0aa4e7ecb62fd87187eabf6f6ceba83f4dafaeeb0';

/**
 * Simulates seeded random frames at seeded corners (inside, across and outside the frame), every
 * taps count and versions 1 to 6, plus the refused inputs, and returns all results as one byte string.
 *
 * Playwright copies this function's source into a worker, so it must stay self-contained: no
 * imports, helpers or values from outside its body.
 * @param exports - The raw exports of an instantiated `optical-sim.wasm`.
 * @returns The concatenated results.
 */
export function runOpticalSimBattery(exports: WebAssembly.Exports): Uint8Array {
  const call = (name: string, ...args: number[]): number => {
    const target = exports[name];
    if (typeof target !== 'function') throw new Error(`optical-sim.wasm has no ${name} export`);
    return Number(Reflect.apply(target, undefined, args));
  };
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('optical-sim.wasm does not export its memory');

  // The same mulberry32 generator as tests/utils/scannerCorpus.ts, inlined.
  let state = 0x1556;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const out: number[] = [];
  const pushU32 = (value: number): void => {
    out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  };

  for (let i = 0; i < 24; i++) {
    const width = 4 + Math.floor(random() * 92);
    const height = 4 + Math.floor(random() * 92);
    const rgba = new Uint8Array(width * height * 4);
    for (let j = 0; j < rgba.length; j++) rgba[j] = Math.floor(random() * 256);
    const corners: number[] = [];
    for (let c = 0; c < 4; c++) corners.push(random() * width * 1.6 - width * 0.3, random() * height * 1.6 - height * 0.3);
    // Versions 1 to 6, then 0 and 41 (refused); taps 1 to 3, then 4 (refused); the last case gets a short output.
    const version = i === 20 ? 0 : i === 21 ? 41 : 1 + (i % 6);
    const taps = i === 22 ? 4 : 1 + (i % 3);
    const side = call('optical_sim_side', version) >>> 0;
    pushU32(side);
    const outLen = i === 23 ? side * side - 1 : Math.max(1, side * side);
    const inPtr = call('alloc', rgba.length);
    const outPtr = call('alloc', outLen);
    new Uint8Array(memory.buffer, inPtr, rgba.length).set(rgba);
    const status = call('optical_sim_print', inPtr, rgba.length, width, height, version, taps, ...corners, outPtr, outLen);
    pushU32(status >>> 0);
    if (status === 0) {
      // A loop, not a spread: a frame is up to 87,000 bytes, more arguments than a call takes.
      const grey = new Uint8Array(memory.buffer, outPtr, side * side);
      for (let j = 0; j < grey.length; j++) out.push(grey[j]);
    }
    call('free', outPtr, outLen);
    call('free', inPtr, rgba.length);
  }

  pushU32(call('abi_version') >>> 0);
  return new Uint8Array(out);
}
