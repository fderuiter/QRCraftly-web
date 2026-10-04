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
import { FIDUCIAL_SIZE, HEADER_BITS, fiducialCellIsDark, type FiducialIndex, type FrameLayout, type RgbaImage } from './layout';

function paintCell(image: RgbaImage, cols: number, cell: number, pitch: number, colour: Rgb): void {
  const col = cell % cols;
  const row = (cell - col) / cols;
  const { data, width } = image;
  for (let y = row * pitch; y < (row + 1) * pitch; y++) {
    let at = (y * width + col * pitch) * 4;
    for (let x = 0; x < pitch; x++) {
      data[at++] = colour[0];
      data[at++] = colour[1];
      data[at++] = colour[2];
      data[at++] = 255;
    }
  }
}

/**
 * Draws one modem frame at a whole number of pixels per cell, on a white background.
 * @param layout - The frame layout.
 * @param symbols - The constellation colours, one per symbol.
 * @param headerCodeword - The metadata codeword (42 bytes), drawn twice in black and white cells.
 * @param data - One symbol per data cell, row by row.
 * @param pitch - Pixels per cell.
 * @returns The frame.
 */
export function renderFrame(layout: FrameLayout, symbols: readonly Rgb[], headerCodeword: Uint8Array, data: Uint8Array, pitch: number): RgbaImage {
  const { cols, rows } = layout;
  const image: RgbaImage = { width: cols * pitch, height: rows * pitch, data: new Uint8ClampedArray(cols * rows * pitch * pitch * 4).fill(255) };
  const black: Rgb = [0, 0, 0];
  const white: Rgb = [255, 255, 255];
  for (let f = 0; f < 4; f++) {
    const [col0, row0] = layout.fiducialOrigins[f];
    for (let dy = 1; dy < FIDUCIAL_SIZE - 1; dy++) {
      for (let dx = 1; dx < FIDUCIAL_SIZE - 1; dx++) {
        if (fiducialCellIsDark(f as FiducialIndex, dx, dy)) paintCell(image, cols, (row0 + dy) * cols + col0 + dx, pitch, black);
      }
    }
  }
  for (let p = 0; p < layout.patchTop.length; p++) {
    const colour = p === 0 ? black : p === 1 ? white : symbols[p - 2];
    for (const cell of layout.patchTop[p]) paintCell(image, cols, cell, pitch, colour);
    for (const cell of layout.patchBottom[p]) paintCell(image, cols, cell, pitch, colour);
  }
  for (const strip of [layout.headerTop, layout.headerBottom]) {
    for (let t = 0; t < strip.length; t++) {
      const bit = t % HEADER_BITS;
      paintCell(image, cols, strip[t], pitch, (headerCodeword[bit >> 3] >> (7 - (bit & 7))) & 1 ? white : black);
    }
  }
  const firstDataCell = FIDUCIAL_SIZE * cols;
  for (let i = 0; i < layout.dataCells; i++) paintCell(image, cols, firstDataCell + i, pitch, symbols[data[i]]);
  return image;
}
