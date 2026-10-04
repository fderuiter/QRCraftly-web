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

/**
 * Pixels of a Colour frame (#1147). A tile puts one QR code on each of the red, green and blue
 * channels: a module is dark in a channel where that channel's code has a dark module, so each
 * channel thresholded alone is a valid QR code. A beacon is one ordinary black and white code with
 * the calibration patch under it, so any scanner reads it.
 *
 * The module grids come from the caller (the QR encoder stays out of this package). Dark and light
 * are not 0 and 255: a screen at full contrast clips and bleeds, and the same levels are used for the
 * patch, so what the receiver fits is what it will see.
 */
import { TILE_QUIET_MODULES } from '../multicode/layout';
import { CALIBRATION_SWATCHES, type RgbaImage } from './crosstalk';
import { PATCH_GAP_MODULES, PATCH_HEIGHT_MODULES } from './geometry';

/** The part of a QR encoder's result the compositor reads (`qrcode`'s `BitMatrix` fits it). */
export interface ModuleGrid {
  readonly size: number;
  /** Whether the module at a row and column is dark. */
  get(row: number, column: number): boolean | number;
}

/** Levels a screen emits for an off and an on channel. */
export const EMIT_DARK = 28;
export const EMIT_LIGHT = 232;

export interface ComposeOptions {
  /** Pixels per module, a whole number. */
  modulePx: number;
  /** Quiet zone in modules (default 4). */
  quietModules?: number;
}

/**
 * Draws one tile: three QR codes of the same version, one per colour channel, with a white quiet zone.
 * @param grids - The red, green and blue codes, all the same size.
 * @param options - Module size and quiet zone.
 * @returns The tile, `(size + 2 · quiet) · modulePx` pixels square.
 */
export function composeColourTile(grids: readonly [ModuleGrid, ModuleGrid, ModuleGrid], options: ComposeOptions): RgbaImage {
  const quiet = options.quietModules ?? TILE_QUIET_MODULES;
  const { size } = grids[0];
  if (grids.some((grid) => grid.size !== size)) throw new RangeError('The three codes of a tile must be the same version.');
  const px = options.modulePx;
  const side = (size + 2 * quiet) * px;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let at = 0; at < data.length; at += 4) {
    data[at] = EMIT_LIGHT;
    data[at + 1] = EMIT_LIGHT;
    data[at + 2] = EMIT_LIGHT;
    data[at + 3] = 255;
  }
  for (let channel = 0; channel < 3; channel++) {
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        if (!grids[channel].get(row, column)) continue;
        for (let dy = 0; dy < px; dy++) {
          let at = (((row + quiet) * px + dy) * side + (column + quiet) * px) * 4 + channel;
          for (let dx = 0; dx < px; dx++, at += 4) data[at] = EMIT_DARK;
        }
      }
    }
  }
  return { data, width: side, height: side };
}

/**
 * Draws a beacon: one black and white code with its quiet zone, and under it the calibration patch.
 * The code sits `quiet` modules in from the top left, which is where a sender places it.
 * @param grid - The beacon's code.
 * @param options - Module size and quiet zone.
 * @returns The beacon, with the patch included.
 */
export function composeBeacon(grid: ModuleGrid, options: ComposeOptions): RgbaImage {
  const quiet = options.quietModules ?? TILE_QUIET_MODULES;
  const px = options.modulePx;
  const width = (grid.size + 2 * quiet) * px;
  const height = (quiet + grid.size + PATCH_GAP_MODULES + PATCH_HEIGHT_MODULES + 1) * px;
  const data = new Uint8ClampedArray(width * height * 4).fill(EMIT_LIGHT);
  const paint = (x: number, y: number, w: number, h: number, rgb: readonly [number, number, number]): void => {
    for (let row = y; row < y + h; row++) {
      for (let column = x; column < x + w; column++) {
        const at = (row * width + column) * 4;
        data[at] = rgb[0];
        data[at + 1] = rgb[1];
        data[at + 2] = rgb[2];
      }
    }
  };
  for (let at = 3; at < data.length; at += 4) data[at] = 255;
  for (let row = 0; row < grid.size; row++) {
    for (let column = 0; column < grid.size; column++) {
      if (grid.get(row, column)) paint((column + quiet) * px, (row + quiet) * px, px, px, [EMIT_DARK, EMIT_DARK, EMIT_DARK]);
    }
  }
  const swatchWidth = (grid.size * px) / CALIBRATION_SWATCHES.length;
  const top = (quiet + grid.size + PATCH_GAP_MODULES) * px;
  CALIBRATION_SWATCHES.forEach((emitted, index) => {
    const x0 = Math.round(quiet * px + index * swatchWidth);
    const x1 = Math.round(quiet * px + (index + 1) * swatchWidth);
    paint(x0, top, x1 - x0, PATCH_HEIGHT_MODULES * px, [emitted[0] ? EMIT_LIGHT : EMIT_DARK, emitted[1] ? EMIT_LIGHT : EMIT_DARK, emitted[2] ? EMIT_LIGHT : EMIT_DARK]);
  });
  return { data, width, height };
}
