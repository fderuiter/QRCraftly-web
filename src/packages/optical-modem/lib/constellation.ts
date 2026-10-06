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

import type { Rgb } from './colour';
import { modemKernels } from './kernels';

/** How the symbols of a constellation are spaced: in raw RGB, or in the perceptual OKLab space. */
export type ConstellationSpace = 'rgb' | 'oklab';

/** What the id byte of a constellation says, without its colours. */
export interface ConstellationShape {
  /** One byte: bits 0-2 are log2 of the symbol count, bit 3 is set for the OKLab design. */
  id: number;
  size: number;
  bitsPerCell: number;
  space: ConstellationSpace;
}

/** A set of cell colours, one per symbol. */
export interface Constellation extends ConstellationShape {
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

/**
 * Reads a constellation id: symbol count, bits per cell and design space. Needs no module, so the
 * link status and the frame capacity work before the kernels load.
 * @param id - A value from {@link constellationId}.
 * @returns The shape.
 * @throws Error when the id names no constellation.
 */
export function constellationShape(id: number): ConstellationShape {
  const bits = id & 7;
  if (bits < 1 || bits > 4 || id >> 4 !== 0) throw new Error(`Unknown constellation ${id}`);
  return { id, size: 1 << bits, bitsPerCell: bits, space: id & OKLAB_FLAG ? 'oklab' : 'rgb' };
}

/**
 * The constellation for an id: two levels (black and white), or 4, 8 or 16 colours whose smallest
 * mutual distance is as large as the search in the modem module finds, in RGB or in OKLab.
 * @param id - A value from {@link constellationId}.
 * @returns The constellation.
 * @throws Error when the id names no constellation.
 */
export function getConstellation(id: number): Constellation {
  const cached = cache.get(id);
  if (cached) return cached;
  const shape = constellationShape(id);
  const designed = modemKernels().constellation(id);
  if (!designed) throw new Error(`Unknown constellation ${id}`);
  const constellation: Constellation = { ...shape, symbols: designed.symbols, minDistance: designed.minDistance };
  cache.set(id, constellation);
  return constellation;
}
