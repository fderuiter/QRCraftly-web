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

import { crc32 } from '../fountain/crc32';
import { cborDecode } from '../fountain/cbor';
import { decodeBytewordsMinimal } from '../fountain/bytewords';
import { MAX_RECEIVE_MESSAGE_BYTES } from '../limits';
import { FragmentChooser } from './schedule';
import { decodeUrPart, parseUr, type BcUrPart } from './uri';

/** Source block count above which a claimed stream is refused (bounds alias-table and mixing work). */
const MAX_FRAGMENTS = 1 << 16;
/** Mixed parts held while waiting for more data. */
const MAX_PENDING_PARTS = 4096;

/** What the main thread should do with a finished UR. */
export type BcUrContent =
  | { kind: 'file'; bytes: Uint8Array }
  | { kind: 'text'; text: string }
  | { kind: 'cbor'; bytes: Uint8Array };

/** A fully reassembled UR. */
export interface BcUrResult {
  /** The UR type, e.g. `bytes`. */
  type: string;
  /** The complete CBOR payload. */
  cbor: Uint8Array;
  /**
   * `file` for `ur:bytes` carrying a CBOR byte string, `text` when any type's
   * payload is a CBOR text string, otherwise the raw CBOR bytes.
   */
  content: BcUrContent;
}

/** Outcome of feeding one scanned string to the decoder. */
export type BcUrIngest =
  /** Not a valid, consistent part of this stream (bad syntax, CRC, other type or other message). */
  | { status: 'rejected' }
  | { status: 'progress'; type: string; received: number; total: number }
  | { status: 'complete'; result: BcUrResult }
  /** All fragments arrived but the message CRC-32 or CBOR failed. */
  | { status: 'failed'; reason: string };

interface Pending {
  indexes: number[];
  data: Uint8Array;
}

function xorInto(target: Uint8Array, source: Uint8Array): void {
  for (let i = 0; i < target.length; i++) target[i] ^= source[i];
}

function classify(type: string, cbor: Uint8Array): BcUrContent {
  try {
    const value = cborDecode(cbor);
    if (type === 'bytes' && value instanceof Uint8Array) return { kind: 'file', bytes: value };
    if (typeof value === 'string') return { kind: 'text', text: value };
  } catch {
    // Tags, maps and other items outside the supported subset stay raw.
  }
  return { kind: 'cbor', bytes: cbor };
}

/**
 * Reassembles a real BCR-2024-001 UR from single-part or multipart strings in
 * any order, with duplicates and lost parts tolerated.
 */
export class BcUrDecoder {
  private type = '';
  private seqLen = 0;
  private messageLen = 0;
  private checksum = 0;
  private fragmentLength = 0;
  private chooser: FragmentChooser | null = null;
  private simple = new Map<number, Uint8Array>();
  private pending: Pending[] = [];
  private done: BcUrResult | null = null;

  /**
   * Feeds one scanned string.
   * @param text Decoded QR text (any case).
   * @returns The updated progress, the finished result or a rejection.
   */
  public ingest(text: string): BcUrIngest {
    if (this.done) return { status: 'complete', result: this.done };
    const parsed = parseUr(text);
    if (!parsed) return { status: 'rejected' };
    if (this.type && parsed.type !== this.type) return { status: 'rejected' };

    if (!parsed.seq) {
      const cbor = decodeBytewordsMinimal(parsed.body);
      if (!cbor || cbor.length === 0 || cbor.length > MAX_RECEIVE_MESSAGE_BYTES) return { status: 'rejected' };
      this.type = parsed.type;
      return this.finish(cbor);
    }

    const part = decodeUrPart(parsed.body);
    if (!part || part.seqNum !== parsed.seq.seqNum || part.seqLen !== parsed.seq.seqLen) return { status: 'rejected' };
    if (!this.accepts(part)) return { status: 'rejected' };
    if (!this.chooser) this.begin(parsed.type, part);

    const indexes = (this.chooser as FragmentChooser).indexesFor(part.seqNum, part.checksum);
    this.absorb({ indexes, data: part.data.slice() });
    if (this.simple.size === this.seqLen) {
      const message = new Uint8Array(this.seqLen * this.fragmentLength);
      for (const [index, fragment] of this.simple) message.set(fragment, index * this.fragmentLength);
      return this.finish(message.subarray(0, this.messageLen).slice(), this.checksum);
    }
    return { status: 'progress', type: this.type, received: this.simple.size, total: this.seqLen };
  }

  /** Fraction of fragments recovered so far, 0 to 1. */
  public get progress(): number {
    if (this.done) return 1;
    return this.seqLen === 0 ? 0 : this.simple.size / this.seqLen;
  }

  /** Forgets the current stream so another can start. */
  public reset(): void {
    this.type = '';
    this.seqLen = 0;
    this.messageLen = 0;
    this.checksum = 0;
    this.fragmentLength = 0;
    this.chooser = null;
    this.simple = new Map();
    this.pending = [];
    this.done = null;
  }

  private accepts(part: BcUrPart): boolean {
    if (this.chooser) {
      return (
        part.seqLen === this.seqLen &&
        part.messageLen === this.messageLen &&
        part.checksum === this.checksum &&
        part.data.length === this.fragmentLength
      );
    }
    return (
      part.seqLen <= MAX_FRAGMENTS &&
      part.messageLen <= MAX_RECEIVE_MESSAGE_BYTES &&
      part.seqLen === Math.ceil(part.messageLen / part.data.length)
    );
  }

  private begin(type: string, part: BcUrPart): void {
    this.type = type;
    this.seqLen = part.seqLen;
    this.messageLen = part.messageLen;
    this.checksum = part.checksum;
    this.fragmentLength = part.data.length;
    this.chooser = new FragmentChooser(part.seqLen);
  }

  /** Peeling decoder: reduce by known fragments, promote singletons, reduce the rest by them. */
  private absorb(first: Pending): void {
    const queue: Pending[] = [first];
    while (queue.length > 0) {
      const part = queue.shift() as Pending;
      const reduced = this.reduce(part);
      if (reduced.indexes.length === 0) continue;
      if (reduced.indexes.length === 1) {
        const index = reduced.indexes[0];
        if (this.simple.has(index)) continue;
        this.simple.set(index, reduced.data);
        // Every stored mixed part gets re-examined against the new fragment.
        queue.push(...this.pending);
        this.pending = [];
      } else if (this.pending.length < MAX_PENDING_PARTS && !this.pending.some(p => sameIndexes(p.indexes, reduced.indexes))) {
        this.pending.push(reduced);
      }
    }
  }

  private reduce(part: Pending): Pending {
    const indexes: number[] = [];
    let data = part.data;
    let copied = false;
    for (const index of part.indexes) {
      const known = this.simple.get(index);
      if (!known) {
        indexes.push(index);
        continue;
      }
      if (!copied) {
        data = data.slice();
        copied = true;
      }
      xorInto(data, known);
    }
    // A mixed part that contains another stored mixed part loses its indexes.
    let result: Pending = { indexes, data };
    for (const other of this.pending) {
      if (other.indexes.length < result.indexes.length && other.indexes.every(i => result.indexes.includes(i))) {
        const merged = result.data.slice();
        xorInto(merged, other.data);
        result = { indexes: result.indexes.filter(i => !other.indexes.includes(i)), data: merged };
      }
    }
    return result;
  }

  private finish(cbor: Uint8Array, expectedChecksum?: number): BcUrIngest {
    if (expectedChecksum !== undefined && crc32(cbor) !== expectedChecksum) {
      this.reset();
      return { status: 'failed', reason: 'checksum mismatch' };
    }
    this.done = { type: this.type, cbor, content: classify(this.type, cbor) };
    return { status: 'complete', result: this.done };
  }
}

function sameIndexes(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every(i => b.includes(i));
}
