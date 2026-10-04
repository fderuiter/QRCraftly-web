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

import type { AcquiredFrame } from './frame';
import { BAND_ROWS, type RgbaImage } from './layout';
import { sampleDataGrid, type SampledGrid } from './sample';

/** Most symbols a constellation has, which is also the palette size the shader reserves. */
export const KERNEL_MAX_SYMBOLS = 16;

/**
 * Everything the per-cell decode kernel reads besides the pixels. The reference kernel and the
 * GPU shader take exactly this, so they cannot be given different inputs.
 */
export interface KernelUniforms {
  /** Data cells across. */
  cols: number;
  /** Data cell rows. */
  dataRows: number;
  /** Frame row of the first data row. */
  rowOffset: number;
  /** Homography from cell coordinates to pixels, nine 32-bit floats. */
  homography: Float32Array;
  /** Calibration colours as integers, red, green and blue for each symbol. */
  palette: Int32Array;
}

/**
 * Packs what the decode kernel needs from an acquired frame. Finding the frame (fiducials,
 * homography, header, palette) stays on the CPU: it is a few hundred operations per frame, against
 * the nine samples for each of thousands of cells that the kernel does.
 * @param frame - The acquired frame.
 * @returns The kernel inputs.
 */
export function kernelUniforms(frame: AcquiredFrame): KernelUniforms {
  return { cols: frame.layout.cols, dataRows: frame.layout.dataRows, rowOffset: BAND_ROWS, homography: frame.homography, palette: frame.palette.symbols };
}

/**
 * The reference decode kernel: for every data cell, nine samples through the homography, the mean
 * colour, the nearest palette symbol and its confidence. The GPU kernel has to produce the same
 * bytes (see `gpu.ts`); this function defines what "the same" means.
 * @param image - The captured frame.
 * @param uniforms - What the kernel reads besides the pixels.
 * @returns A symbol, a confidence and a mean colour for each data cell.
 */
export function runReferenceKernel(image: RgbaImage, uniforms: KernelUniforms): SampledGrid {
  return sampleDataGrid(image, uniforms.homography, { cols: uniforms.cols, dataCells: uniforms.cols * uniforms.dataRows }, { symbols: uniforms.palette }, uniforms.rowOffset);
}

/** How two kernel results differ. All zero means bit for bit equal. */
export interface GridDifference {
  cells: number;
  /** Cells whose symbol differs. */
  symbolMismatches: number;
  /** Cells whose confidence differs. */
  confidenceMismatches: number;
  /** Cells whose mean colour differs in any channel. */
  meanMismatches: number;
}

/**
 * Counts where two kernels disagree.
 * @param a - One result.
 * @param b - The other.
 * @returns The disagreement counts.
 */
export function compareGrids(a: SampledGrid, b: SampledGrid): GridDifference {
  const cells = a.symbols.length;
  let symbolMismatches = Math.abs(b.symbols.length - cells);
  let confidenceMismatches = 0;
  let meanMismatches = 0;
  for (let i = 0; i < cells; i++) {
    if (a.symbols[i] !== b.symbols[i]) symbolMismatches++;
    if (a.confidence[i] !== b.confidence[i]) confidenceMismatches++;
    if (a.means[i * 3] !== b.means[i * 3] || a.means[i * 3 + 1] !== b.means[i * 3 + 1] || a.means[i * 3 + 2] !== b.means[i * 3 + 2]) meanMismatches++;
  }
  return { cells, symbolMismatches, confidenceMismatches, meanMismatches };
}
