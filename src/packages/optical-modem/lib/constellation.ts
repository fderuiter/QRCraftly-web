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

import { labDistance, rgbToOklab, type Lab, type Rgb } from './colour';

/** How the symbols of a constellation are spaced: in raw RGB, or in the perceptual OKLab space. */
export type ConstellationSpace = 'rgb' | 'oklab';

/** A set of cell colours, one per symbol. */
export interface Constellation {
  /** One byte: bits 0-2 are log2 of the symbol count, bit 3 is set for the OKLab design. */
  id: number;
  size: number;
  bitsPerCell: number;
  space: ConstellationSpace;
  symbols: readonly Rgb[];
  /** Smallest OKLab distance between two symbols. */
  minDistance: number;
}

const OKLAB_FLAG = 8;
const cache = new Map<number, Constellation>();

/**
 * The id byte of a constellation.
 * @param size - Symbol count: 2, 4, 8 or 16.
 * @param space - Design space.
 * @returns The id.
 */
export function constellationId(size: 2 | 4 | 8 | 16, space: ConstellationSpace): number {
  const bits = size === 2 ? 1 : size === 4 ? 2 : size === 8 ? 3 : 4;
  return bits | (space === 'oklab' ? OKLAB_FLAG : 0);
}

function latticeOf(levels: number): Rgb[] {
  const steps = Array.from({ length: levels }, (_, i) => Math.round((255 * i) / (levels - 1)));
  const pool: Rgb[] = [];
  for (const r of steps) for (const g of steps) for (const b of steps) pool.push([r, g, b]);
  return pool;
}

function rgbDistance(a: Rgb, b: Rgb): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Picks `size` colours from a lattice with the largest smallest-gap: farthest-point sampling,
 * then single swaps while they widen the smallest gap. Everything is deterministic: ties go to the
 * lowest lattice index.
 * @param size - Symbol count.
 * @param space - The space the gap is measured in.
 * @returns The chosen colours in lattice order.
 */
function design(size: number, space: ConstellationSpace): Rgb[] {
  const pool = latticeOf(space === 'oklab' ? 7 : 5);
  const labs: Lab[] = space === 'oklab' ? pool.map(rgbToOklab) : [];
  const gap = (i: number, j: number): number =>
    space === 'oklab' ? labDistance(labs[i], labs[j]) : rgbDistance(pool[i], pool[j]);
  const chosen = [0];
  while (chosen.length < size) {
    let best = -1;
    let bestGap = -1;
    for (let i = 0; i < pool.length; i++) {
      if (chosen.includes(i)) continue;
      let nearest = Infinity;
      for (const c of chosen) nearest = Math.min(nearest, gap(i, c));
      if (nearest > bestGap) {
        bestGap = nearest;
        best = i;
      }
    }
    chosen.push(best);
  }
  const smallestGap = (set: number[]): number => {
    let smallest = Infinity;
    for (let a = 0; a < set.length; a++) for (let b = a + 1; b < set.length; b++) smallest = Math.min(smallest, gap(set[a], set[b]));
    return smallest;
  };
  let current = smallestGap(chosen);
  for (let pass = 0; pass < 40; pass++) {
    let improved = false;
    for (let slot = 0; slot < chosen.length; slot++) {
      for (let candidate = 0; candidate < pool.length; candidate++) {
        if (chosen.includes(candidate)) continue;
        const trial = chosen.slice();
        trial[slot] = candidate;
        const score = smallestGap(trial);
        if (score > current + 1e-9) {
          chosen[slot] = candidate;
          current = score;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return chosen.sort((a, b) => a - b).map((i) => pool[i]);
}

const CUBE_CORNERS: readonly Rgb[] = [
  [0, 0, 0],
  [0, 0, 255],
  [0, 255, 0],
  [0, 255, 255],
  [255, 0, 0],
  [255, 0, 255],
  [255, 255, 0],
  [255, 255, 255],
];

/** The known optimum where one exists: black and white, the corners of the RGB cube, and the cube's most spread four corners. */
function fixedSymbols(size: number, space: ConstellationSpace): Rgb[] | null {
  if (size === 2) return [CUBE_CORNERS[0], CUBE_CORNERS[7]];
  if (space !== 'rgb') return null;
  if (size === 8) return CUBE_CORNERS.slice();
  if (size === 4) return [CUBE_CORNERS[0], CUBE_CORNERS[3], CUBE_CORNERS[5], CUBE_CORNERS[6]];
  return null;
}

/**
 * The constellation for an id: two levels (black and white), or 4, 8 or 16 colours whose smallest
 * mutual distance is as large as the search finds, in RGB or in OKLab.
 * @param id - A value from {@link constellationId}.
 * @returns The constellation.
 * @throws Error when the id names no constellation.
 */
export function getConstellation(id: number): Constellation {
  const cached = cache.get(id);
  if (cached) return cached;
  const bits = id & 7;
  const space: ConstellationSpace = id & OKLAB_FLAG ? 'oklab' : 'rgb';
  if (bits < 1 || bits > 4 || id >> 4 !== 0) throw new Error(`Unknown constellation ${id}`);
  const size = 1 << bits;
  const symbols = fixedSymbols(size, space) ?? design(size, space);
  const labs = symbols.map(rgbToOklab);
  let minDistance = Infinity;
  for (let a = 0; a < size; a++) for (let b = a + 1; b < size; b++) minDistance = Math.min(minDistance, labDistance(labs[a], labs[b]));
  const constellation: Constellation = { id, size, bitsPerCell: bits, space, symbols, minDistance };
  cache.set(id, constellation);
  return constellation;
}
