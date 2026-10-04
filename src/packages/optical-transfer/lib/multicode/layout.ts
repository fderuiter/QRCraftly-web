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
 * Multi-code layouts (#1142): how many QR codes ("tiles") one sender frame shows, at which QR
 * version, so that every module is at least {@link MIN_MODULE_CSS_PX} CSS pixels on the sender's
 * screen. Error correction is L throughout; the fountain code absorbs lost frames.
 */
import { FRAME_OVERHEAD } from '../prism/frame';
import { base45Length } from '../prism/base45';
import { MAX_PRISM_SYMBOL_SIZE } from '../prism/manifest';

/** Smallest module size, in CSS pixels, a layout may use. */
export const MIN_MODULE_CSS_PX = 3;
/** Quiet zone around every tile, in modules (the QR standard asks for 4). */
export const TILE_QUIET_MODULES = 4;

/** Data codewords of a QR code at error correction L, versions 1 to 40 (ISO/IEC 18004 Table 7). */
const DATA_CODEWORDS_L: readonly number[] = [
  19, 34, 55, 80, 108, 136, 156, 194, 232, 274, 324, 370, 428, 461, 523, 589, 647, 721, 795, 861, 932, 1006, 1094, 1174, 1276, 1370, 1468,
  1531, 1631, 1735, 1843, 1955, 2071, 2191, 2306, 2434, 2566, 2702, 2812, 2956,
];

/**
 * Alphanumeric characters a QR code of this version holds at error correction L.
 * @param version - QR version, 1 to 40.
 * @returns The character capacity.
 */
export function alphanumericCapacityL(version: number): number {
  const v = Math.min(40, Math.max(1, Math.floor(version)));
  const countBits = v <= 9 ? 9 : v <= 26 ? 11 : 13;
  const bits = DATA_CODEWORDS_L[v - 1] * 8 - 4 - countBits;
  const pairs = Math.floor(bits / 11);
  return pairs * 2 + (bits - pairs * 11 >= 6 ? 1 : 0);
}

/**
 * Modules on one side of a QR code.
 * @param version - QR version, 1 to 40.
 * @returns The module count.
 */
export function qrModuleCount(version: number): number {
  return 17 + 4 * version;
}

/**
 * Bytes of Prism frame (header and CRC included) that one tile of this version carries as Base45.
 * @param version - QR version, 1 to 40.
 * @returns The frame capacity in bytes.
 */
export function tileFrameCapacity(version: number): number {
  const characters = alphanumericCapacityL(version);
  let bytes = Math.floor((characters * 2) / 3);
  while (base45Length(bytes) > characters) bytes -= 1;
  while (base45Length(bytes + 1) <= characters) bytes += 1;
  return bytes;
}

/** How a tile's frame is filled with fountain symbols. */
export interface TileSymbolPlan {
  /** Symbols in each frame; large versions pack several because a symbol is capped at 2048 bytes. */
  symbolsPerFrame: number;
  /** Bytes per symbol. */
  symbolSize: number;
}

/**
 * The symbols a tile of this version carries so that its frame fills the code.
 * @param version - QR version, 1 to 40.
 * @returns Symbols per frame and the symbol size.
 */
export function tileSymbolPlan(version: number): TileSymbolPlan {
  const room = tileFrameCapacity(version) - FRAME_OVERHEAD;
  const symbolsPerFrame = Math.max(1, Math.ceil(room / MAX_PRISM_SYMBOL_SIZE));
  return { symbolsPerFrame, symbolSize: Math.floor(room / symbolsPerFrame) };
}

export type TileLayoutId = '1xv40' | '1xv30' | '2x2-v25' | '2x2-v22' | '2x2-v20' | '3x2-v20';

/** One way to arrange tiles on the sender's screen. */
export interface TileLayout {
  id: TileLayoutId;
  columns: number;
  rows: number;
  /** Number of tiles, columns times rows. */
  tiles: number;
  version: number;
  /** Modules on one side of a tile's QR code. */
  modules: number;
  symbolsPerFrame: number;
  symbolSize: number;
  /** File bytes one display refresh can carry when every tile is fresh. */
  payloadPerFrame: number;
}

function makeLayout(id: TileLayoutId, columns: number, rows: number, version: number): TileLayout {
  const plan = tileSymbolPlan(version);
  return {
    id,
    columns,
    rows,
    tiles: columns * rows,
    version,
    modules: qrModuleCount(version),
    ...plan,
    payloadPerFrame: columns * rows * plan.symbolsPerFrame * plan.symbolSize,
  };
}

export const TILE_LAYOUTS: Readonly<Record<TileLayoutId, TileLayout>> = {
  '1xv40': /* @__PURE__ */ makeLayout('1xv40', 1, 1, 40),
  '1xv30': /* @__PURE__ */ makeLayout('1xv30', 1, 1, 30),
  '2x2-v25': /* @__PURE__ */ makeLayout('2x2-v25', 2, 2, 25),
  '2x2-v22': /* @__PURE__ */ makeLayout('2x2-v22', 2, 2, 22),
  '2x2-v20': /* @__PURE__ */ makeLayout('2x2-v20', 2, 2, 20),
  '3x2-v20': /* @__PURE__ */ makeLayout('3x2-v20', 3, 2, 20),
};

/**
 * Size of a layout in modules, quiet zones included.
 * @param layout - The layout.
 * @returns Width and height in modules.
 */
export function layoutFootprint(layout: TileLayout): { width: number; height: number } {
  const pitch = layout.modules + 2 * TILE_QUIET_MODULES;
  return { width: layout.columns * pitch, height: layout.rows * pitch };
}

/** The sender's screen in CSS pixels. */
export interface ScreenSize {
  width: number;
  height: number;
}

/** What {@link selectLayout} may pick from. */
export interface LayoutOptions {
  /** Smallest module size in CSS pixels (default {@link MIN_MODULE_CSS_PX}). */
  minModulePx?: number;
  /** "dense" (default) prefers several tiles; "single" prefers one large code for a distant camera. */
  prefer?: 'dense' | 'single';
}

/** A layout and the whole-pixel module size it gets on a screen. */
export interface LayoutChoice {
  layout: TileLayout;
  /** CSS pixels per module (whole, so the code stays crisp). */
  modulePx: number;
}

/** A 3x2 grid is only worth it on a wide, large screen where modules stay at least this big. */
const WIDE_LAYOUT_MIN_MODULE_PX = 4;
const WIDE_LAYOUT_MIN_ASPECT = 1.4;
const WIDE_LAYOUT_MIN_WIDTH = 1600;

const DENSE_ORDER: readonly TileLayoutId[] = ['3x2-v20', '2x2-v25', '2x2-v22', '2x2-v20', '1xv40', '1xv30'];
const SINGLE_ORDER: readonly TileLayoutId[] = ['1xv40', '1xv30', '2x2-v25', '2x2-v22', '2x2-v20'];

/**
 * Whole CSS pixels per module a layout gets on a screen.
 * @param layout - The layout.
 * @param screen - Screen size in CSS pixels.
 * @returns The module size, 0 when it does not fit.
 */
export function modulePxFor(layout: TileLayout, screen: ScreenSize): number {
  const { width, height } = layoutFootprint(layout);
  return Math.floor(Math.min(screen.width / width, screen.height / height));
}

/**
 * Picks the layout for a sender screen: the first in the preference order whose modules are at
 * least the minimum size.
 * @param screen - Sender screen in CSS pixels.
 * @param options - Minimum module size and preference.
 * @returns The layout and its module size, or null when even the smallest code is too small
 * (the caller then keeps the single-code stream it has today).
 */
export function selectLayout(screen: ScreenSize, options: LayoutOptions = {}): LayoutChoice | null {
  const min = Math.max(1, options.minModulePx ?? MIN_MODULE_CSS_PX);
  const order = options.prefer === 'single' ? SINGLE_ORDER : DENSE_ORDER;
  for (const id of order) {
    const layout = TILE_LAYOUTS[id];
    const modulePx = modulePxFor(layout, screen);
    if (modulePx < min) continue;
    if (id === '3x2-v20') {
      const wide = screen.width / screen.height >= WIDE_LAYOUT_MIN_ASPECT && screen.width >= WIDE_LAYOUT_MIN_WIDTH;
      if (!wide || modulePx < WIDE_LAYOUT_MIN_MODULE_PX) continue;
    }
    return { layout, modulePx };
  }
  return null;
}
