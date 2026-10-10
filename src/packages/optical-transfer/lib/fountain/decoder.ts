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

import type { DropletMetadata } from './contracts';
import { buildRobustSolitonCdf, getNeighborsForSeq } from './soliton';
import { crc32 } from './crc32';
import { solveGF2 } from './gf2';

interface PendingEquation {
  neighbors: Set<number>;
  data: Uint8Array;
  /** True once Gaussian elimination proved this row independent of the rest. */
  independent: boolean;
}

function firstOf(set: Set<number>): number {
  for (const value of set) return value;
  return -1;
}

/** Elimination is skipped above this many unknowns to bound worst-case CPU time. */
const MAX_ELIMINATION_UNKNOWNS = 4096;

/**
 * Rateless fountain decoder over GF(2).
 *
 * Droplets are first resolved by belief-propagation peeling (O(degree) per
 * droplet). When peeling stalls on a stopping set and there are at least as
 * many pending equations as unknown blocks, the decoder falls back to
 * Gauss-Jordan elimination ({@link solveGF2}) and feeds any recovered blocks
 * back into the peeling ripple. Any droplet can be the first one, which
 * enables stateless stream entry.
 */
export class FountainDecoder {
  public k: number | null = null;
  public messageLength: number | null = null;
  public checksum: number | null = null;
  public blockSize: number | null = null;

  private cdf: Float64Array | null = null;
  private solvedBlocks: Array<Uint8Array | null> = [];
  private solvedCount = 0;
  private pending: PendingEquation[] = [];
  private receivedSeqNumbers = new Set<number>();
  private droplets = 0;
  private equationsSinceElimination = 0;
  private eliminationRuns = 0;

  /**
   * Returns current decoding progress percentage (0 - 100) based on solved blocks.
   * @returns Percentage of solved source blocks.
   */
  public get progress(): number {
    if (!this.k) return 0;
    return Math.round((this.solvedCount / this.k) * 100);
  }

  /**
   * True once all K source blocks have been resolved.
   * @returns Whether decoding is complete.
   */
  public get isComplete(): boolean {
    return this.k !== null && this.solvedCount >= this.k;
  }

  /**
   * Number of source blocks resolved so far.
   * @returns Solved block count.
   */
  public get resolvedBlockCount(): number {
    return this.solvedCount;
  }

  /**
   * Number of unique droplets accepted for the current session.
   * @returns Accepted droplet count.
   */
  public get dropletsReceived(): number {
    return this.droplets;
  }

  /**
   * Known rank of the received equation system: solved blocks plus pending rows
   * proven independent by the last elimination pass. It is a lower bound between
   * elimination passes and equals K on completion.
   * @returns Rank lower bound.
   */
  public get rank(): number {
    let independent = 0;
    for (const eq of this.pending) if (eq.independent) independent++;
    return Math.min(this.k ?? 0, this.solvedCount + independent);
  }

  /**
   * Number of Gaussian elimination passes run for this session.
   * @returns Elimination pass count.
   */
  public get eliminationPasses(): number {
    return this.eliminationRuns;
  }

  private init(meta: DropletMetadata, blockSize: number): void {
    this.k = meta.k;
    this.messageLength = meta.messageLength;
    this.checksum = meta.checksum;
    this.blockSize = blockSize;
    this.cdf = buildRobustSolitonCdf(meta.k);
    this.solvedBlocks = new Array<Uint8Array | null>(meta.k).fill(null);
  }

  /**
   * Returns true if the metadata belongs to the session this decoder is locked to.
   * @param meta Droplet metadata.
   * @param blockSize Fragment length.
   * @returns Whether the droplet is compatible.
   */
  public matchesSession(meta: DropletMetadata, blockSize: number): boolean {
    return (
      this.k === null ||
      (this.k === meta.k &&
        this.messageLength === meta.messageLength &&
        this.checksum === meta.checksum &&
        this.blockSize === blockSize)
    );
  }

  /**
   * Ingests a parsed droplet.
   * @param meta Droplet metadata.
   * @param data Fragment bytes.
   * @returns True if the droplet advanced decoding.
   */
  public ingest(meta: DropletMetadata, data: Uint8Array): boolean {
    if (this.isComplete) return false;
    if (!this.matchesSession(meta, data.length)) return false;
    if (this.receivedSeqNumbers.has(meta.seq)) return false;
    if (this.k === null) this.init(meta, data.length);

    this.receivedSeqNumbers.add(meta.seq);
    this.droplets += 1;
    const { indices } = getNeighborsForSeq(meta.seq, meta.k, this.cdf ?? undefined);
    return this.ingestEquation(indices, data);
  }

  /**
   * Adds one XOR equation (the XOR of `indices` equals `data`) to the system.
   * Exposed so callers and tests can drive the solver with explicit neighbour sets.
   * @param indices Source block indices combined in the equation.
   * @param data Equation payload (one block).
   * @returns True if at least one new block was resolved.
   */
  public ingestEquation(indices: number[], data: Uint8Array): boolean {
    if (this.k === null || this.blockSize === null || this.isComplete) return false;
    const blockSize = this.blockSize;
    const payload = new Uint8Array(blockSize);
    payload.set(data.subarray(0, blockSize));

    const remaining = new Set<number>();
    for (const idx of indices) {
      if (idx < 0 || idx >= this.k) return false;
      const solved = this.solvedBlocks[idx];
      if (solved) {
        for (let b = 0; b < blockSize; b++) payload[b] ^= solved[b];
      } else if (remaining.has(idx)) {
        remaining.delete(idx);
      } else {
        remaining.add(idx);
      }
    }
    if (remaining.size === 0) return false;

    const before = this.solvedCount;
    if (remaining.size === 1) {
      this.ripple([[firstOf(remaining), payload]]);
    } else {
      this.pending.push({ neighbors: remaining, data: payload, independent: false });
      this.equationsSinceElimination += 1;
    }

    if (!this.isComplete) this.maybeEliminate();
    return this.solvedCount > before;
  }

  /**
   * Belief-propagation ripple: records solved blocks and substitutes them
   * into pending equations, cascading any that drop to degree one.
   */
  private ripple(queue: Array<[number, Uint8Array]>): void {
    const blockSize = this.blockSize ?? 0;
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      const [index, blockData] = next;
      if (this.solvedBlocks[index] !== null) continue;
      this.solvedBlocks[index] = blockData;
      this.solvedCount += 1;

      const stillPending: PendingEquation[] = [];
      for (const eq of this.pending) {
        if (!eq.neighbors.has(index)) {
          stillPending.push(eq);
          continue;
        }
        for (let b = 0; b < blockSize; b++) eq.data[b] ^= blockData[b];
        eq.neighbors.delete(index);
        if (eq.neighbors.size === 1) {
          queue.push([firstOf(eq.neighbors), eq.data]);
        } else if (eq.neighbors.size > 1) {
          stillPending.push(eq);
        }
      }
      this.pending = stillPending;
    }
  }

  /**
   * Runs Gaussian elimination when peeling has stalled and the pending system
   * could be full rank. Re-runs are throttled to every ~1/16th of the unknowns.
   */
  private maybeEliminate(): void {
    if (this.k === null || this.blockSize === null) return;
    const unknownCount = this.k - this.solvedCount;
    if (unknownCount > MAX_ELIMINATION_UNKNOWNS) return;
    if (this.pending.length < unknownCount) return;
    if (this.equationsSinceElimination < Math.max(1, Math.ceil(unknownCount / 16))) return;

    this.equationsSinceElimination = 0;
    this.eliminationRuns += 1;

    const unknowns: number[] = [];
    for (let i = 0; i < this.k; i++) if (this.solvedBlocks[i] === null) unknowns.push(i);

    const { solved, residual } = solveGF2(
      this.pending.map(eq => ({ columns: Array.from(eq.neighbors), data: eq.data })),
      unknowns,
      this.blockSize
    );

    this.pending = residual.map(eq => ({ neighbors: new Set(eq.columns), data: eq.data, independent: true }));
    this.ripple(Array.from(solved.entries()));
  }

  /**
   * Reconstructs the message once all K blocks are solved.
   * @returns The message bytes, or null while incomplete.
   * @throws Error when the reassembled message fails the CRC-32 check.
   */
  public finalize(): Uint8Array | null {
    if (!this.isComplete || this.k === null || this.blockSize === null || this.messageLength === null) {
      return null;
    }
    const full = new Uint8Array(this.k * this.blockSize);
    for (let i = 0; i < this.k; i++) {
      const block = this.solvedBlocks[i];
      if (!block) return null;
      full.set(block, i * this.blockSize);
    }
    const result = full.slice(0, this.messageLength);
    const actual = crc32(result);
    if (actual !== this.checksum) {
      throw new Error(
        `Fountain integrity error: checksum mismatch (expected ${(this.checksum ?? 0).toString(16)}, got ${actual.toString(16)})`
      );
    }
    return result;
  }

  /**
   * Resets the decoder to accept a new stream session.
   */
  public reset(): void {
    this.k = null;
    this.messageLength = null;
    this.checksum = null;
    this.blockSize = null;
    this.cdf = null;
    this.solvedBlocks = [];
    this.solvedCount = 0;
    this.pending = [];
    this.receivedSeqNumbers.clear();
    this.droplets = 0;
    this.equationsSinceElimination = 0;
    this.eliminationRuns = 0;
  }
}
