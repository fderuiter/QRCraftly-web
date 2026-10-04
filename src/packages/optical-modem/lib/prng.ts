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

/** A small seeded generator (mulberry32). Integer maths only, so it is identical everywhere. */
export interface Rng {
  /** Next unsigned 32-bit integer. */
  nextUint32(): number;
  /** Next number in [0, 1). */
  nextFloat(): number;
  /** Next approximately normal number (sum of twelve uniforms), mean 0, deviation 1. */
  nextGaussian(): number;
}

/**
 * Creates a seeded generator.
 * @param seed - Any integer.
 * @returns The generator.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  const nextFloat = (): number => nextUint32() / 4294967296;
  return {
    nextUint32,
    nextFloat,
    nextGaussian: () => {
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += nextFloat();
      return sum - 6;
    },
  };
}
