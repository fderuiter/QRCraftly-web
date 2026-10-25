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
 * Sizes of the shaped module styles, by role (#1606). `module` draws the module itself; `halo`
 * draws the clearance mask the maze pass erases around each module (maze.ts). Each halo is larger
 * than its module, so the maze paths stop short of the module instead of touching it.
 *
 * Circular styles give the scale passed to drawCircularModule. Polygon styles give divisors of the
 * cell size (radius = cellSize / divisor), kept as divisors so the drawn geometry stays identical.
 */
export const SHAPE_SIZES = {
  /** Dots that overlap their neighbours slightly; the halo clears 0.1 cell more. */
  swiss: { module: 1.05, halo: 1.15 },
  /** Dots that overlap more, so neighbours merge; the halo clears 0.12 cell more. */
  fluid: { module: 1.1, halo: 1.22 },
  /** Hexagon circumradius divisor. */
  hive: { module: 1.55, halo: 1.4 },
  /** Five-point star outer and inner radius divisors. */
  starburst: { module: { outer: 1.5, inner: 2.2 }, halo: { outer: 1.35, inner: 2.0 } },
} as const;
