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
  fillModules(ctx, matrix, left + origin, top + origin, modulePx);
}

/** Fills the dark modules of a matrix whose top-left module is at (left, top). */
function fillModules(ctx: CanvasRenderingContext2D, matrix: TileMatrix, left: number, top: number, modulePx: number): void {
  for (let row = 0; row < matrix.size; row++) {
    const y = top + row * modulePx;
    let run = -1;
    // One rectangle per run of dark modules keeps a v25 tile to a few thousand fills.
    for (let column = 0; column <= matrix.size; column++) {
      const dark = column < matrix.size && matrix.data[row * matrix.size + column] === 1;
      if (dark && run < 0) run = column;
      if (!dark && run >= 0) {
        ctx.fillRect(left + run * modulePx, y, (column - run) * modulePx, modulePx);
        run = -1;
      }
    }
  }
}

/**
 * Empties one tile's cell, quiet zone included.
 * @param ctx - The canvas context.
 * @param layout - The layout.
 * @param modulePx - Canvas pixels per module.
 * @param tile - Tile number, row by row.
 */
export function clearTile(ctx: CanvasRenderingContext2D, layout: TileLayout, modulePx: number, tile: number): void {
  paintTile(ctx, layout, modulePx, tile, { size: 0, data: new Uint8Array(0) });
}

/**
 * Paints a beacon (#1143): one code as large as the canvas allows, centred, with its quiet zone,
 * over the whole grid. The canvas keeps its size, so the tiles return in the same places.
 * @param canvas - The transfer canvas, sized for the tiles.
 * @param matrix - The beacon's module matrix.
 */
export function paintBeacon(canvas: HTMLCanvasElement, matrix: TileMatrix): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = TILE_LIGHT;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const side = matrix.size + 2 * TILE_QUIET_MODULES;
  const modulePx = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / side));
  const left = Math.floor((canvas.width - side * modulePx) / 2) + TILE_QUIET_MODULES * modulePx;
  const top = Math.floor((canvas.height - side * modulePx) / 2) + TILE_QUIET_MODULES * modulePx;
  ctx.fillStyle = TILE_DARK;
  fillModules(ctx, matrix, left, top, modulePx);
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
