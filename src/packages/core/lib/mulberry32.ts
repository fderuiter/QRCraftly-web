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

/**
 * A seeded Mulberry32 pseudo-random number generator function.
 * Calling the generator directly produces uniform 32-bit floating point numbers in [0, 1).
 */
export interface Mulberry32Generator {
  /** Next uniform floating point number in [0, 1). */
  (): number;
  /** Next uniform floating point number in [0, 1). */
  next(): number;
  /** Next unsigned 32-bit integer. */
  nextUint32(): number;
}

/**
 * Mulberry32 is a simple, deterministic 32-bit generator with a 2^32 period.
 * Produces uniform 32-bit floating point numbers in [0, 1).
 *
 * @param seed - 32-bit integer seed.
 * @returns A callable generator function with `.next()` and `.nextUint32()` methods.
 */
export function createMulberry32(seed: number): Mulberry32Generator {
  let state = seed >>> 0;
  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  const nextFloat = (): number => nextUint32() / 4294967296;

  return Object.assign(nextFloat, {
    next: nextFloat,
    nextUint32,
  });
}

/**
 * Factory for a generator producing unsigned 32-bit integers directly.
 *
 * @param seed - 32-bit integer seed.
 * @returns A function returning the next unsigned 32-bit integer.
 */
export function createMulberry32Uint32(seed: number): () => number {
  return createMulberry32(seed).nextUint32;
}

/**
 * 32-bit FNV-1a non-cryptographic string hash.
 * Maps arbitrary strings to a 32-bit unsigned integer suitable as a PRNG seed.
 *
 * @param str - Input string.
 * @returns Unsigned 32-bit integer hash.
 */
export function fnv1a(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
