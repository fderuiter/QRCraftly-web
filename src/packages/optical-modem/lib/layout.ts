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

/** RGBA pixels, laid out like a canvas `ImageData`. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

/** Cells across and down, fiducials and bands included. */
export interface GridGeometry {
  cols: number;
  rows: number;
}

/** Side of the square block each corner fiducial occupies, in cells. */
export const FIDUCIAL_SIZE = 9;
/** Rows in the top band and in the bottom band. */
export const BAND_ROWS = 9;
/** Fewest columns a frame can have: the header strip needs them. */
export const MIN_COLS = 104;
/** Fewest rows a frame can have. */
export const MIN_ROWS = 40;
/** Bits of the metadata codeword. */
export const HEADER_BITS = 336;

/** The four fiducials in a fixed order: top-left, top-right, bottom-left, bottom-right. */
export type FiducialIndex = 0 | 1 | 2 | 3;

/** Where everything sits in one frame, in cells. A cell index is `row * cols + col`. */
export interface FrameLayout {
  cols: number;
  rows: number;
  /** Symbols in the constellation. The calibration strip holds black, white and each symbol. */
  symbolCount: number;
  dataRows: number;
  /** Cells in the data grid. Data cell `i` is at column `i % cols`, row `BAND_ROWS + floor(i / cols)`. */
  dataCells: number;
  /** Top-left cell of each fiducial block. */
  fiducialOrigins: readonly (readonly [number, number])[];
  /** Cells of calibration patch `p` in the top strip: 0 is black, 1 white, 2 + s is symbol `s`. */
  patchTop: readonly Uint32Array[];
  /** The same patches in the bottom strip. */
  patchBottom: readonly Uint32Array[];
  /** Header cells in the top band, in order; cell `t` carries bit `t % HEADER_BITS`. */
  headerTop: Uint32Array;
  /** The second copy of the header in the bottom band. */
  headerBottom: Uint32Array;
}

const cache = new Map<string, FrameLayout>();

/**
 * Lays out a frame.
 * @param cols - Cells across.
 * @param rows - Cells down.
 * @param symbolCount - Symbols in the constellation (2 to 16).
 * @returns The layout.
 * @throws Error when the grid is too small.
 */
export function createLayout(cols: number, rows: number, symbolCount: number): FrameLayout {
  const key = `${cols}x${rows}x${symbolCount}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < MIN_COLS || rows < MIN_ROWS) {
    throw new Error(`A frame needs at least ${MIN_COLS} x ${MIN_ROWS} cells`);
  }
  const patchCount = symbolCount + 2;
  const patchTop: Uint32Array[] = [];
  const patchBottom: Uint32Array[] = [];
  for (let p = 0; p < patchCount; p++) {
    const top = new Uint32Array(8);
    const bottom = new Uint32Array(8);
    for (let i = 0; i < 8; i++) {
      const col = FIDUCIAL_SIZE + 2 * p + (i & 1);
      top[i] = (1 + (i >> 1)) * cols + col;
      bottom[i] = (rows - 8 + (i >> 1)) * cols + col;
    }
    patchTop.push(top);
    patchBottom.push(bottom);
  }
  const stripCells = (cols - 2 * FIDUCIAL_SIZE) * 4;
  const headerTop = new Uint32Array(stripCells);
  const headerBottom = new Uint32Array(stripCells);
  for (let t = 0; t < stripCells; t++) {
    const col = FIDUCIAL_SIZE + (t >> 2);
    headerTop[t] = (5 + (t & 3)) * cols + col;
    headerBottom[t] = (rows - 4 + (t & 3)) * cols + col;
  }
  const dataRows = rows - 2 * BAND_ROWS;
  const layout: FrameLayout = {
    cols,
    rows,
    symbolCount,
    dataRows,
    dataCells: cols * dataRows,
    fiducialOrigins: [
      [0, 0],
      [cols - FIDUCIAL_SIZE, 0],
      [0, rows - FIDUCIAL_SIZE],
      [cols - FIDUCIAL_SIZE, rows - FIDUCIAL_SIZE],
    ],
    patchTop,
    patchBottom,
    headerTop,
    headerBottom,
  };
  cache.set(key, layout);
  return layout;
}

/**
 * Whether a cell of a fiducial block is dark. A fiducial is a 7 x 7 dark ring, a light ring and a
 * 3 x 3 dark core. The core loses cells fiducial by fiducial (9, 7, 5 and 3 dark cells), which is
 * the orientation mark: the receiver ranks the four cores by area.
 * @param index - Which fiducial.
 * @param dx - Column inside the 9 x 9 block.
 * @param dy - Row inside the 9 x 9 block.
 * @returns True for a dark cell.
 */
export function fiducialCellIsDark(index: FiducialIndex, dx: number, dy: number): boolean {
  if (dx < 1 || dx > 7 || dy < 1 || dy > 7) return false;
  if (dx === 1 || dx === 7 || dy === 1 || dy === 7) return true;
  if (dx < 3 || dx > 5 || dy < 3 || dy > 5) return false;
  const corner = (dx === 3 || dx === 5) && (dy === 3 || dy === 5);
  const edgeMiddleVertical = dx === 4 && (dy === 3 || dy === 5);
  if (index === 0) return true;
  if (index === 1) return !(corner && dx === dy);
  if (index === 2) return !corner;
  return !corner && !edgeMiddleVertical;
}
