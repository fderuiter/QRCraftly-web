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

import { FountainDroplet, FountainEncoderOptions } from './contracts';
import { buildRobustSolitonCdf, getNeighborsForSeq } from './soliton';
import { crc32 } from './crc32';

/**
 * Returns the default highest sequence number for a stream of `k` source blocks.
 * @param k Source block count.
 * @returns Sequence ceiling before the stream wraps.
 */
export function defaultMaxSeq(k: number): number {
  return Math.max(16 * k, 9999);
}

/**
 * Rateless fountain block slicer and Luby Transform encoder over GF(2).
 * Emits an unbounded stream: sequence numbers 1..k are systematic, later ones
 * are Robust Soliton mixtures; after `maxSeq` the stream wraps to `k + 1`.
 */
export class FountainEncoder {
  public readonly messageLength: number;
  public readonly blockSize: number;
  public readonly k: number;
  public readonly checksum: number;
  public readonly maxSeq: number;

  private readonly blocks: Uint8Array[];
  private readonly cdf: Float64Array;
  private emitted = 0;

  constructor(message: Uint8Array, options: FountainEncoderOptions = {}) {
    this.messageLength = message.length;
    this.blockSize = Math.max(1, Math.floor(options.blockSize ?? 64));
    this.k = Math.max(1, Math.ceil(this.messageLength / this.blockSize));
    this.checksum = crc32(message);
    this.maxSeq = Math.max(this.k + 1, options.maxSeq ?? defaultMaxSeq(this.k));
    this.cdf = buildRobustSolitonCdf(this.k, options.c ?? 0.1, options.delta ?? 0.05);

    this.blocks = new Array<Uint8Array>(this.k);
    for (let i = 0; i < this.k; i++) {
      const block = new Uint8Array(this.blockSize);
      const start = i * this.blockSize;
      block.set(message.subarray(start, Math.min(this.messageLength, start + this.blockSize)), 0);
      this.blocks[i] = block;
    }
  }

  /**
   * Maps a zero-based emission index to its sequence number, wrapping after `maxSeq`.
   * @param index Zero-based frame index.
   * @returns 1-based sequence number.
   */
  public seqForIndex(index: number): number {
    if (index < this.maxSeq) return index + 1;
    const repairSpan = this.maxSeq - this.k;
    return this.k + 1 + ((index - this.maxSeq) % repairSpan);
  }

  /**
   * Generates the droplet for a sequence number.
   * @param seq Droplet sequence number (1-based integer).
   * @returns The droplet.
   */
  public getDroplet(seq: number): FountainDroplet {
    const { degree, indices } = getNeighborsForSeq(seq, this.k, this.cdf);
    const dropletData = new Uint8Array(this.blockSize);
    for (const idx of indices) {
      const sourceBlock = this.blocks[idx];
      for (let b = 0; b < this.blockSize; b++) {
        dropletData[b] ^= sourceBlock[b];
      }
    }
    return {
      seq,
      k: this.k,
      messageLength: this.messageLength,
      checksum: this.checksum,
      degree,
      indices,
      data: dropletData,
    };
  }

  /**
   * Emits the next droplet in the rateless stream.
   * @returns The droplet.
   */
  public nextDroplet(): FountainDroplet {
    const seq = this.seqForIndex(this.emitted);
    this.emitted += 1;
    return this.getDroplet(seq);
  }

  /**
   * Resets the emission sequence back to the first droplet.
   */
  public reset(): void {
    this.emitted = 0;
  }
}
