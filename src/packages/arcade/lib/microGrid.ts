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

import type { TargetMatrix } from './matrix';

/** Micro-cells per macro module side: each module is split into a 4x4 grid. */
export const MICRO_SUBDIVISION = 4;

/** Share of a dark module's micro-cells that must be blasted before the module counts as damaged. */
export const MACRO_DAMAGE_THRESHOLD = 0.5;

/** A micro-cell coordinate. */
export interface MicroCell {
  /** Micro row. */
  row: number;
  /** Micro column. */
  col: number;
}

/**
 * Micro-cell damage grid for the blaster. Every macro module is subdivided into
 * {@link MICRO_SUBDIVISION}² micro-cells so impacts chip modules partially. Only dark
 * micro-cells can be blasted; light cells are empty space.
 *
 * Coordinates are in micro-cell units: cell (r, c) covers [c, c + 1) × [r, r + 1).
 */
export class MicroGrid {
  /** Macro modules along one side. */
  readonly macroSize: number;
  /** Micro-cells per macro side. */
  readonly subdivision: number;
  /** Micro-cells along one side. */
  readonly size: number;
  /** Dark micro-cells before any damage. */
  readonly originalDark: number;
  private readonly original: Uint8Array;
  private readonly cells: Uint8Array;
  private readonly macroDestroyed: Uint16Array;
  private intact: number;

  /**
   * Builds a pristine grid from a target matrix.
   * @param matrix - The target matrix.
   * @param subdivision - Micro-cells per macro side.
   */
  constructor(matrix: TargetMatrix, subdivision: number = MICRO_SUBDIVISION) {
    this.macroSize = matrix.size;
    this.subdivision = subdivision;
    this.size = matrix.size * subdivision;
    this.original = new Uint8Array(this.size * this.size);
    let dark = 0;
    for (let mr = 0; mr < this.size; mr++) {
      const r = Math.floor(mr / subdivision);
      for (let mc = 0; mc < this.size; mc++) {
        const isDark = matrix.modules[r * matrix.size + Math.floor(mc / subdivision)];
        this.original[mr * this.size + mc] = isDark;
        dark += isDark;
      }
    }
    this.originalDark = dark;
    this.intact = dark;
    this.cells = this.original.slice();
    this.macroDestroyed = new Uint16Array(matrix.size * matrix.size);
  }

  /** @returns Dark micro-cells still intact. */
  get intactDark(): number {
    return this.intact;
  }

  /** @returns Dark micro-cells blasted away. */
  get destroyed(): number {
    return this.originalDark - this.intact;
  }

  /** @returns Share of dark micro-cells still intact, 0-100 (rounded). */
  get durabilityPercent(): number {
    return this.originalDark > 0 ? Math.round((this.intact / this.originalDark) * 100) : 0;
  }

  /**
   * Whether a micro-cell is currently dark (intact).
   * @param row - Micro row.
   * @param col - Micro column.
   * @returns True when the cell is dark and intact.
   */
  isIntact(row: number, col: number): boolean {
    if (row < 0 || col < 0 || row >= this.size || col >= this.size) return false;
    return this.cells[row * this.size + col] === 1;
  }

  /**
   * Whether a micro-cell was dark before any damage.
   * @param row - Micro row.
   * @param col - Micro column.
   * @returns True when the cell was originally dark.
   */
  wasDark(row: number, col: number): boolean {
    if (row < 0 || col < 0 || row >= this.size || col >= this.size) return false;
    return this.original[row * this.size + col] === 1;
  }

  private destroy(row: number, col: number): boolean {
    const index = row * this.size + col;
    if (this.cells[index] !== 1) return false;
    this.cells[index] = 0;
    this.intact--;
    this.macroDestroyed[Math.floor(row / this.subdivision) * this.macroSize + Math.floor(col / this.subdivision)]++;
    return true;
  }

  private cellRange(centre: number, radius: number): [number, number] {
    return [Math.max(0, Math.floor(centre - radius)), Math.min(this.size - 1, Math.floor(centre + radius))];
  }

  /**
   * Finds the first intact dark cell a circle overlaps (circle-rectangle intersection).
   * Used for projectile collision.
   * @param x - Circle centre x in micro units.
   * @param y - Circle centre y in micro units.
   * @param radius - Circle radius in micro units.
   * @returns The first overlapped cell in row-major order, or null.
   */
  firstHit(x: number, y: number, radius: number): MicroCell | null {
    const [minRow, maxRow] = this.cellRange(y, radius);
    const [minCol, maxCol] = this.cellRange(x, radius);
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (!this.isIntact(row, col)) continue;
        const dx = x - Math.max(col, Math.min(x, col + 1));
        const dy = y - Math.max(row, Math.min(y, row + 1));
        if (dx * dx + dy * dy < radius * radius) return { row, col };
      }
    }
    return null;
  }

  /**
   * Blasts every intact dark cell whose centre lies inside a circle.
   * @param x - Circle centre x in micro units.
   * @param y - Circle centre y in micro units.
   * @param radius - Circle radius in micro units.
   * @returns The cells destroyed by this blast.
   */
  blastCircle(x: number, y: number, radius: number): MicroCell[] {
    const destroyed: MicroCell[] = [];
    const [minRow, maxRow] = this.cellRange(y, radius);
    const [minCol, maxCol] = this.cellRange(x, radius);
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const dx = x - (col + 0.5);
        const dy = y - (row + 0.5);
        if (dx * dx + dy * dy <= radius * radius && this.destroy(row, col)) destroyed.push({ row, col });
      }
    }
    return destroyed;
  }

  /**
   * Blasted micro-cells inside one macro module (0 means the module is pristine).
   * @param row - Macro row.
   * @param col - Macro column.
   * @returns The count.
   */
  destroyedInModule(row: number, col: number): number {
    if (row < 0 || col < 0 || row >= this.macroSize || col >= this.macroSize) return 0;
    return this.macroDestroyed[row * this.macroSize + col];
  }

  /** Restores every blasted cell. */
  heal(): void {
    this.cells.set(this.original);
    this.macroDestroyed.fill(0);
    this.intact = this.originalDark;
  }

  /**
   * Macro modules that count as damaged for the analytical layer: dark modules with at least
   * {@link MACRO_DAMAGE_THRESHOLD} of their micro-cells blasted.
   * @returns Damaged macro module indices (row-major).
   */
  macroDamage(): number[] {
    const minDestroyed = Math.ceil(this.subdivision * this.subdivision * MACRO_DAMAGE_THRESHOLD);
    const damaged: number[] = [];
    this.macroDestroyed.forEach((count, index) => {
      if (count >= minDestroyed) damaged.push(index);
    });
    return damaged;
  }
}
