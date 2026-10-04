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
 * Where things sit on a Colour sender's screen (#1147), so that the receiver can find them from one
 * decoded beacon. The rules the sender follows:
 *
 * - The beacon code and the tile grid share a centre and a module size.
 * - The calibration patch is one row of eight swatches (the order of `CALIBRATION_SWATCHES`) as wide
 *   as the beacon code, {@link PATCH_GAP_MODULES} modules below it, so the code's quiet zone stays white.
 *
 * A beacon is therefore enough to place the patch and every tile: no second search is needed.
 */
import { TILE_QUIET_MODULES, qrModuleCount, type TileLayout } from '../multicode/layout';
import type { Rect } from '../multicode/tracker';
import { CALIBRATION_SWATCHES, type Rgb, type RgbaImage } from './crosstalk';

/** Modules between the bottom of the beacon code and the top of the patch (the quiet zone plus one). */
export const PATCH_GAP_MODULES = TILE_QUIET_MODULES + 1;
/** Height of the patch, in modules. */
export const PATCH_HEIGHT_MODULES = 4;

/**
 * The boxes of the eight swatches under a beacon code.
 * @param code - Box of the beacon's code (modules only, no quiet zone), in pixels.
 * @param modules - Modules on one side of the beacon code.
 * @returns One box per swatch, left to right.
 */
export function beaconPatchRects(code: Rect, modules: number): Rect[] {
  const module = code.width / modules;
  const width = code.width / CALIBRATION_SWATCHES.length;
  return CALIBRATION_SWATCHES.map((_, index) => ({
    x: code.x + index * width,
    y: code.y + code.height + PATCH_GAP_MODULES * module,
    width,
    height: PATCH_HEIGHT_MODULES * module,
  }));
}

/**
 * The mean colour of a box, rounded to whole levels.
 * @param image - The camera frame.
 * @param box - The box, in pixels (fractions are rounded inwards).
 * @param inset - Share of each side to leave out (0 to 0.49), to keep clear of edges.
 * @returns The mean, or null when the box is empty or leaves the frame.
 */
export function meanColour(image: RgbaImage, box: Rect, inset = 0): Rgb | null {
  const x0 = Math.ceil(box.x + box.width * inset);
  const x1 = Math.floor(box.x + box.width * (1 - inset));
  const y0 = Math.ceil(box.y + box.height * inset);
  const y1 = Math.floor(box.y + box.height * (1 - inset));
  if (x1 <= x0 || y1 <= y0 || x0 < 0 || y0 < 0 || x1 > image.width || y1 > image.height) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let y = y0; y < y1; y++) {
    let at = (y * image.width + x0) * 4;
    for (let x = x0; x < x1; x++, at += 4) {
      r += image.data[at];
      g += image.data[at + 1];
      b += image.data[at + 2];
    }
  }
  const count = (x1 - x0) * (y1 - y0);
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

/**
 * Reads the calibration patch under a beacon.
 * @param image - The camera frame.
 * @param code - Box of the beacon's code in the frame.
 * @param modules - Modules on one side of the beacon code.
 * @returns The eight swatch colours, or null when any of them is outside the frame.
 */
export function samplePatch(image: RgbaImage, code: Rect, modules: number): Rgb[] | null {
  const swatches: Rgb[] = [];
  for (const box of beaconPatchRects(code, modules)) {
    // The middle of a swatch only: the edges blur into their neighbours.
    const colour = meanColour(image, box, 0.25);
    if (!colour) return null;
    swatches.push(colour);
  }
  return swatches;
}

/**
 * Places the tiles from a beacon, using the shared centre and module size.
 * @param code - Box of the beacon's code in the frame.
 * @param beaconVersion - The beacon's QR version.
 * @param layout - The dense layout.
 * @returns The box of each tile's code (quiet zone excluded), row by row.
 */
export function tileRectsFromBeacon(code: Rect, beaconVersion: number, layout: TileLayout): Rect[] {
  const module = code.width / qrModuleCount(beaconVersion);
  const pitch = (layout.modules + 2 * TILE_QUIET_MODULES) * module;
  const centreX = code.x + code.width / 2;
  const centreY = code.y + code.height / 2;
  const originX = centreX - (layout.columns * pitch) / 2 + TILE_QUIET_MODULES * module;
  const originY = centreY - (layout.rows * pitch) / 2 + TILE_QUIET_MODULES * module;
  const rects: Rect[] = [];
  for (let row = 0; row < layout.rows; row++) {
    for (let column = 0; column < layout.columns; column++) {
      rects.push({ x: originX + column * pitch, y: originY + row * pitch, width: layout.modules * module, height: layout.modules * module });
    }
  }
  return rects;
}
