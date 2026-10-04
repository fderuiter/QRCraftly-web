/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { sha256 } from '../../../../utils/sha256';

const MASK = (1n << 64n) - 1n;
const TWO_POW_64 = 18446744073709551616;

function rotl(x: bigint, k: bigint): bigint {
  return ((x << k) | (x >> (64n - k))) & MASK;
}

/**
 * Xoshiro256** as specified by BCR-2024-001: the 32-byte SHA-256 of the seed
 * is read as four big-endian 64-bit words, and doubles are `next / 2^64`.
 */
export class Xoshiro256 {
  private readonly s: bigint[] = [0n, 0n, 0n, 0n];

  constructor(seed: Uint8Array) {
    const view = new DataView(sha256(seed).buffer);
    for (let i = 0; i < 4; i++) this.s[i] = view.getBigUint64(i * 8, false);
  }

  /** @returns The next unsigned 64-bit output. */
  public next(): bigint {
    const s = this.s;
    const result = (rotl((s[1] * 5n) & MASK, 7n) * 9n) & MASK;
    const t = (s[1] << 17n) & MASK;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 45n);
    return result;
  }

  /** @returns A double in [0, 1). */
  public nextDouble(): number {
    return Number(this.next()) / TWO_POW_64;
  }

  /**
   * @param low Inclusive lower bound.
   * @param high Inclusive upper bound.
   * @returns An integer in [low, high].
   */
  public nextInt(low: number, high: number): number {
    return Math.floor(this.nextDouble() * (high - low + 1) + low);
  }
}
