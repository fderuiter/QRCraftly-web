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
 * Staggered tile refresh (#1142). The tiles form a checkerboard of two diagonal groups. Each tile
 * keeps its content for `hold` display refreshes, and the second group changes half a hold later.
 * A camera exposure that straddles one refresh then always sees the other group's tiles unchanged,
 * so at least half the tiles are intact. A hold of 1 cannot stagger (every tile changes every
 * refresh).
 */
import type { TileLayout } from './layout';

/** The checkerboard group of a tile, 0 or 1. Tiles are numbered row by row. */
export function tileGroup(layout: TileLayout, tile: number): 0 | 1 {
  const row = Math.floor(tile / layout.columns);
  const column = tile % layout.columns;
  return ((row + column) % 2) as 0 | 1;
}

/**
 * Refreshes by which a tile's changes are delayed.
 * @param layout - The layout.
 * @param tile - Tile number.
 * @param hold - Display refreshes each frame is held for.
 * @returns 0 for the first group (and for any layout that cannot stagger), half a hold for the second.
 */
export function tileOffset(layout: TileLayout, tile: number, hold: number): number {
  if (layout.tiles < 2 || hold < 2) return 0;
  return tileGroup(layout, tile) * Math.floor(hold / 2);
}

/**
 * Which content a tile shows at a display refresh.
 * @param layout - The layout.
 * @param tile - Tile number.
 * @param refresh - Display refresh number, from 0.
 * @param hold - Display refreshes each frame is held for.
 * @returns The tile's slot: 0 until its first change, then one more for every `hold` refreshes.
 */
export function tileSlot(layout: TileLayout, tile: number, refresh: number, hold: number): number {
  return Math.max(0, Math.floor((refresh - tileOffset(layout, tile, hold)) / Math.max(1, hold)));
}

/**
 * Index into a {@link PrismStream} for a tile's slot. Tiles interleave, so every tile and slot gets
 * its own frame and no two tiles ever show the same symbols at once.
 * @param layout - The layout.
 * @param tile - Tile number.
 * @param slot - Slot from {@link tileSlot}.
 * @returns The frame index.
 */
export function tileFrameIndex(layout: TileLayout, tile: number, slot: number): number {
  return slot * layout.tiles + tile;
}

/**
 * The tiles whose content differs from the previous refresh.
 * @param layout - The layout.
 * @param refresh - Display refresh number; refresh 0 paints every tile.
 * @param hold - Display refreshes each frame is held for.
 * @returns Tile numbers, ascending.
 */
export function tilesChangingAt(layout: TileLayout, refresh: number, hold: number): number[] {
  const changing: number[] = [];
  for (let tile = 0; tile < layout.tiles; tile++) {
    if (refresh <= 0 || tileSlot(layout, tile, refresh, hold) > tileSlot(layout, tile, refresh - 1, hold)) changing.push(tile);
  }
  return changing;
}

/**
 * The tiles an exposure that straddles the boundary into this refresh sees intact: the ones that
 * did not change.
 * @param layout - The layout.
 * @param refresh - Display refresh number the exposure runs into.
 * @param hold - Display refreshes each frame is held for.
 * @returns Tile numbers, ascending.
 */
export function tilesIntactAcross(layout: TileLayout, refresh: number, hold: number): number[] {
  const changing = new Set(tilesChangingAt(layout, refresh, hold));
  return Array.from({ length: layout.tiles }, (_, tile) => tile).filter((tile) => !changing.has(tile));
}

/**
 * The smallest share of tiles that survives one straddled refresh, over a full cycle of the schedule.
 * @param layout - The layout.
 * @param hold - Display refreshes each frame is held for.
 * @returns A fraction from 0 to 1.
 */
export function worstIntactFraction(layout: TileLayout, hold: number): number {
  let worst = 1;
  // Every second hold is a full cycle; skip refresh 0, which paints everything.
  for (let refresh = 1; refresh <= 2 * Math.max(1, hold); refresh++) {
    worst = Math.min(worst, tilesIntactAcross(layout, refresh, hold).length / layout.tiles);
  }
  return worst;
}
