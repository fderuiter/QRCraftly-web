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

import { lumaOf } from './colour';
import { BAND_ROWS, type FrameLayout, type RgbaImage } from './layout';

/**
 * Where inside a cell the nine samples fall, as fractions of the cell. All are exact in binary, so
 * the sample positions are the same in 32-bit and 64-bit arithmetic.
 */
export const SAMPLE_OFFSETS: readonly number[] = [0.3125, 0.5, 0.6875];

/** Distance weights for the red, green and blue differences when matching a cell to a patch. */
export const CHANNEL_WEIGHTS: readonly [number, number, number] = [3, 4, 2];

const f32 = Math.fround;

/**
 * Averages the colour of one cell through a homography. Nine nearest-pixel samples are summed as
 * integers; the coordinates use 32-bit float steps in a fixed order, so a shader that does the
 * same multiplications, additions and one division per axis gets the same pixels.
 * @param image - The captured frame.
 * @param h - Homography as nine 32-bit floats (cell coordinates to pixels).
 * @param col - Cell column (may carry a fraction).
 * @param row - Cell row.
 * @param out - Receives the mean red, green and blue (integers, 0 to 255) at `out[at]`.
 * @param at - Offset in `out`.
 */
export function sampleCell(image: RgbaImage, h: Float32Array, col: number, row: number, out: Uint8Array | Int32Array | number[], at: number): void {
  const { width, height, data } = image;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const dv of SAMPLE_OFFSETS) {
    const v = row + dv;
    for (const du of SAMPLE_OFFSETS) {
      const u = col + du;
      const w = f32(f32(f32(h[6] * u) + f32(h[7] * v)) + 1);
      const x = f32(f32(f32(f32(h[0] * u) + f32(h[1] * v)) + h[2]) / w);
      const y = f32(f32(f32(f32(h[3] * u) + f32(h[4] * v)) + h[5]) / w);
      const px = Math.min(width - 1, Math.max(0, Math.floor(x)));
      const py = Math.min(height - 1, Math.max(0, Math.floor(y)));
      const i = (py * width + px) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
  }
  out[at] = Math.floor((r + 4) / 9);
  out[at + 1] = Math.floor((g + 4) / 9);
  out[at + 2] = Math.floor((b + 4) / 9);
}

/** Calibration colours read from the frame, as integers. */
export interface Palette {
  black: readonly [number, number, number];
  white: readonly [number, number, number];
  /** One colour per symbol, three numbers each. */
  symbols: Int32Array;
}

/**
 * Reads the black and white patches, which sit in the same place whatever the constellation.
 * @param image - The captured frame.
 * @param h - Homography.
 * @param layout - Frame layout.
 * @returns Black and white as seen through this camera.
 */
export function readReferencePatches(image: RgbaImage, h: Float32Array, layout: FrameLayout): { black: [number, number, number]; white: [number, number, number] } {
  const [black, white] = [0, 1].map((p) => readPatch(image, h, layout, p));
  return { black: [black[0], black[1], black[2]], white: [white[0], white[1], white[2]] };
}

function readPatch(image: RgbaImage, h: Float32Array, layout: FrameLayout, patch: number): Int32Array {
  const sum = new Int32Array(3);
  const cell = new Int32Array(3);
  let count = 0;
  for (const strip of [layout.patchTop[patch], layout.patchBottom[patch]]) {
    for (const index of strip) {
      const col = index % layout.cols;
      sampleCell(image, h, col, (index - col) / layout.cols, cell, 0);
      sum[0] += cell[0];
      sum[1] += cell[1];
      sum[2] += cell[2];
      count++;
    }
  }
  return Int32Array.from(sum, (s) => Math.floor((s + (count >> 1)) / count));
}

/**
 * Reads every calibration patch: what this display shows through this camera for each symbol.
 * @param image - The captured frame.
 * @param h - Homography.
 * @param layout - Frame layout.
 * @returns The palette.
 */
export function readPalette(image: RgbaImage, h: Float32Array, layout: FrameLayout): Palette {
  const symbols = new Int32Array(layout.symbolCount * 3);
  for (let s = 0; s < layout.symbolCount; s++) symbols.set(readPatch(image, h, layout, 2 + s), s * 3);
  const { black, white } = readReferencePatches(image, h, layout);
  return { black, white, symbols };
}

/**
 * The luma halfway between the black and white patches: the threshold for header cells.
 * @param patches - Black and white references.
 * @returns The midpoint luma.
 */
export function referenceMidpoint(patches: { black: readonly number[]; white: readonly number[] }): number {
  return (lumaOf(patches.black[0], patches.black[1], patches.black[2]) + lumaOf(patches.white[0], patches.white[1], patches.white[2])) >> 1;
}

/**
 * Matches one colour to the palette. The distance is a weighted sum of squared channel differences
 * in integers. The confidence is how far the best match is ahead of the runner-up, 0 to 255.
 * @param r - Red mean.
 * @param g - Green mean.
 * @param b - Blue mean.
 * @param symbols - Palette symbols, three numbers each.
 * @returns The best symbol and its confidence.
 */
export function classifyColour(r: number, g: number, b: number, symbols: Int32Array): { symbol: number; confidence: number } {
  let best = 0;
  let bestDistance = Infinity;
  let second = Infinity;
  for (let s = 0; s < symbols.length / 3; s++) {
    const dr = r - symbols[s * 3];
    const dg = g - symbols[s * 3 + 1];
    const db = b - symbols[s * 3 + 2];
    const d = CHANNEL_WEIGHTS[0] * dr * dr + CHANNEL_WEIGHTS[1] * dg * dg + CHANNEL_WEIGHTS[2] * db * db;
    if (d < bestDistance) {
      second = bestDistance;
      bestDistance = d;
      best = s;
    } else if (d < second) {
      second = d;
    }
  }
  return { symbol: best, confidence: Math.floor((255 * (second - bestDistance)) / (second + bestDistance + 1)) };
}

/** The data grid as the receiver reads it. */
export interface SampledGrid {
  /** Best symbol for each data cell, row by row. */
  symbols: Uint8Array;
  /** Confidence of each decision, 0 to 255. */
  confidence: Uint8Array;
  /** Mean colour of each cell, three bytes per cell. */
  means: Uint8Array;
}

/**
 * Samples and classifies every data cell.
 * @param image - The captured frame.
 * @param h - Homography.
 * @param layout - Frame layout.
 * @param palette - Live calibration colours.
 * @returns The symbol and confidence of every data cell.
 */
export function sampleDataGrid(image: RgbaImage, h: Float32Array, layout: FrameLayout, palette: Palette): SampledGrid {
  const symbols = new Uint8Array(layout.dataCells);
  const confidence = new Uint8Array(layout.dataCells);
  const means = new Uint8Array(layout.dataCells * 3);
  const cell = new Int32Array(3);
  for (let i = 0; i < layout.dataCells; i++) {
    const col = i % layout.cols;
    sampleCell(image, h, col, BAND_ROWS + (i - col) / layout.cols, cell, 0);
    const match = classifyColour(cell[0], cell[1], cell[2], palette.symbols);
    symbols[i] = match.symbol;
    confidence[i] = match.confidence;
    means[i * 3] = cell[0];
    means[i * 3 + 1] = cell[1];
    means[i * 3 + 2] = cell[2];
  }
  return { symbols, confidence, means };
}
