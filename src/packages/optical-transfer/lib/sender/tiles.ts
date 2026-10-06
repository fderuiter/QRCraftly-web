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
 * Painting a multi-code frame (#1142): the tiles of a layout side by side on one canvas, each a
 * plain dark-on-light code with its own quiet zone, so every tile reads on its own.
 */
import { TILE_QUIET_MODULES, layoutFootprint, type TileLayout } from '../multicode/layout';

/** Light and dark of a tile. Fixed: a transfer frame carries no styling that could cost a read. */
const TILE_LIGHT = '#ffffff';
const TILE_DARK = '#000000';

/** Share of the window height the transfer canvas may take while it shows tiles. */
const TILE_CANVAS_VIEWPORT_SHARE = 0.85;

/** One QR module matrix, row by row, 1 for dark. */
export interface TileMatrix {
  size: number;
  data: Uint8Array;
}

/**
 * Sizes the canvas for a layout and paints it light, ready for the tiles.
 * @param canvas - The transfer canvas.
 * @param layout - The layout.
 * @param modulePx - Canvas pixels per module.
 */
export function prepareTileCanvas(canvas: HTMLCanvasElement, layout: TileLayout, modulePx: number): void {
  const { width, height } = layoutFootprint(layout);
  canvas.width = width * modulePx;
  canvas.height = height * modulePx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = TILE_LIGHT;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Paints one tile's code into its cell, quiet zone included, over whatever the cell showed.
 * @param ctx - The canvas context.
 * @param layout - The layout.
 * @param modulePx - Canvas pixels per module.
 * @param tile - Tile number, row by row.
 * @param matrix - The tile's module matrix; it must have the layout's module count.
 */
export function paintTile(ctx: CanvasRenderingContext2D, layout: TileLayout, modulePx: number, tile: number, matrix: TileMatrix): void {
  const pitch = (layout.modules + 2 * TILE_QUIET_MODULES) * modulePx;
  const left = (tile % layout.columns) * pitch;
  const top = Math.floor(tile / layout.columns) * pitch;
  ctx.fillStyle = TILE_LIGHT;
  ctx.fillRect(left, top, pitch, pitch);
  if (matrix.size !== layout.modules) return;
  ctx.fillStyle = TILE_DARK;
  const origin = TILE_QUIET_MODULES * modulePx;
  for (let row = 0; row < matrix.size; row++) {
    const y = top + origin + row * modulePx;
    let run = -1;
    // One rectangle per run of dark modules keeps a v25 tile to a few thousand fills.
    for (let column = 0; column <= matrix.size; column++) {
      const dark = column < matrix.size && matrix.data[row * matrix.size + column] === 1;
      if (dark && run < 0) run = column;
      if (!dark && run >= 0) {
        ctx.fillRect(left + origin + run * modulePx, y, (column - run) * modulePx, modulePx);
        run = -1;
      }
    }
  }
}

/**
 * The square the transfer canvas can fill while it shows tiles, in CSS pixels: as wide as its
 * container and at most {@link TILE_CANVAS_VIEWPORT_SHARE} of the window height.
 * @param canvas - The transfer canvas.
 * @returns Width and height in CSS pixels.
 */
export function tileScreenOf(canvas: HTMLCanvasElement): { width: number; height: number } {
  const available = canvas.parentElement?.clientWidth || canvas.clientWidth;
  const side = Math.floor(Math.min(available, window.innerHeight * TILE_CANVAS_VIEWPORT_SHARE));
  return { width: side, height: side };
}
