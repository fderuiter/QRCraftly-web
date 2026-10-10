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

import { Xoshiro256 } from './xoshiro';

/** Walker/Vose alias table over weights 1/1 .. 1/count (BC-UR's degree chooser). */
function buildAliasTable(count: number): { probs: Float64Array; aliases: Uint32Array } {
  const weights = new Float64Array(count);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    weights[i] = 1 / (i + 1);
    sum += weights[i];
  }
  for (let i = 0; i < count; i++) weights[i] = (weights[i] * count) / sum;
  const small: number[] = [];
  const large: number[] = [];
  for (let i = count - 1; i >= 0; i--) (weights[i] < 1 ? small : large).push(i);
  const probs = new Float64Array(count);
  const aliases = new Uint32Array(count);
  while (small.length > 0 && large.length > 0) {
    const less = small.pop() as number;
    const more = large.pop() as number;
    probs[less] = weights[less];
    aliases[less] = more;
    weights[more] = weights[more] + weights[less] - 1;
    (weights[more] < 1 ? small : large).push(more);
  }
  for (const i of large) probs[i] = 1;
  for (const i of small) probs[i] = 1;
  return { probs, aliases };
}

function seedFor(seqNum: number, checksum: number): Uint8Array {
  const seed = new Uint8Array(8);
  const view = new DataView(seed.buffer);
  view.setUint32(0, seqNum >>> 0, false);
  view.setUint32(4, checksum >>> 0, false);
  return seed;
}

/**
 * Chooses which source fragments are mixed into each part of a message with a
 * fixed fragment count. Parts 1..count are the pure fragments; later parts use
 * a degree and a shuffle drawn from Xoshiro256** seeded by (seqNum, checksum).
 */
export class FragmentChooser {
  private readonly table: { probs: Float64Array; aliases: Uint32Array };

  private readonly count: number;

  constructor(count: number) {
    this.count = count;
    this.table = buildAliasTable(count);
  }

  /**
   * @param seqNum One-based part number.
   * @param checksum CRC-32 of the whole message.
   * @returns Zero-based fragment indexes mixed into the part, in BC-UR order.
   */
  public indexesFor(seqNum: number, checksum: number): number[] {
    if (seqNum <= this.count) return [seqNum - 1];
    const rng = new Xoshiro256(seedFor(seqNum, checksum));
    const slot = Math.floor(rng.nextDouble() * this.count);
    const degree = (rng.nextDouble() < this.table.probs[slot] ? slot : this.table.aliases[slot]) + 1;
    const remaining = Array.from({ length: this.count }, (_, i) => i);
    const chosen: number[] = [];
    while (chosen.length < degree) {
      chosen.push(remaining.splice(rng.nextInt(0, remaining.length - 1), 1)[0]);
    }
    return chosen;
  }
}
