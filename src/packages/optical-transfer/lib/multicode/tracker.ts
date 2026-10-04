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
 * Tile tracking (#1142). One full multi-code search over a camera frame finds where the tiles are.
 * The frames after it decode only small crops at those positions, which is far cheaper and runs in
 * parallel across workers. When tracking is lost (nothing decodes for a few frames, or a tile keeps
 * failing) the tracker asks for a full search again.
 *
 * The tracker only plans: it never touches pixels. A caller runs the crops with any decoder and
 * reports what came back. Positions are axis-aligned boxes; a tilted camera is covered by the crop
 * padding and, past that, by the fallback to a full search.
 */
import { decodeFrame } from '../prism/frame';
import { TILE_QUIET_MODULES, type TileLayout } from './layout';

/** A box in camera frame pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One crop a worker should decode. */
export interface TileCrop {
  tile: number;
  /** Crop box in frame pixels, whole numbers, inside the frame. */
  rect: Rect;
}

export type TrackPlan = { kind: 'search' } | { kind: 'crops'; crops: TileCrop[] };

/** What a decoder reports for one crop. */
export interface CropResult {
  tile: number;
  ok: boolean;
  /** Where the code actually sat in frame pixels, when the decoder can say. Moves the tile's box. */
  rect?: Rect;
}

export interface TileTrackerOptions {
  layout: TileLayout;
  /**
   * Crop margin around a tile's code, in modules (default 3). Tiles sit 8 modules apart (two quiet
   * zones), so a larger margin pulls a neighbour's finder patterns into the crop and the decode fails.
   */
  paddingModules?: number;
  /** Consecutive failed crops after which one tile is dropped (default 8; half the tiles are mid-change at any refresh). */
  tileMissLimit?: number;
  /** Consecutive frames with no decoded tile after which tracking is lost (default 3). */
  emptyFrameLimit?: number;
  /** While some tiles are still unknown, plan a full search every this many frames (default 15). */
  researchInterval?: number;
}

interface Tracked {
  rect: Rect;
  misses: number;
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * Places the grid of a layout from the boxes a search found. The result keeps every found box and, when
 * the found boxes already span the whole grid, adds a predicted box for each tile that was not found.
 * @param found - Boxes of the codes a search found.
 * @param layout - The layout the sender uses.
 * @returns Boxes for the tiles that can be located, row by row.
 */
export function predictTileRects(found: readonly Rect[], layout: TileLayout): Rect[] {
  if (found.length === 0) return [];
  const side = median(found.map((rect) => (rect.width + rect.height) / 2));
  const pitch = (side * (layout.modules + 2 * TILE_QUIET_MODULES)) / layout.modules;
  const minX = Math.min(...found.map((rect) => rect.x));
  const minY = Math.min(...found.map((rect) => rect.y));
  const cells = new Map<string, Rect>();
  for (const rect of found) {
    const column = Math.round((rect.x - minX) / pitch);
    const row = Math.round((rect.y - minY) / pitch);
    const off = Math.abs(rect.x - (minX + column * pitch)) > pitch * 0.35 || Math.abs(rect.y - (minY + row * pitch)) > pitch * 0.35;
    // A box off the grid means this is not the layout; keep what was found and predict nothing.
    if (off || column >= layout.columns || row >= layout.rows) return [...found].sort((a, b) => a.y - b.y || a.x - b.x);
    cells.set(`${column},${row}`, rect);
  }
  const columns = Math.max(...[...cells.keys()].map((key) => Number(key.split(',')[0]))) + 1;
  const rows = Math.max(...[...cells.keys()].map((key) => Number(key.split(',')[1]))) + 1;
  const complete = columns === layout.columns && rows === layout.rows;
  const rects: Rect[] = [];
  for (let row = 0; row < layout.rows; row++) {
    for (let column = 0; column < layout.columns; column++) {
      const seen = cells.get(`${column},${row}`);
      if (seen) rects.push(seen);
      else if (complete) rects.push({ x: minX + column * pitch, y: minY + row * pitch, width: side, height: side });
    }
  }
  return rects;
}

/**
 * Tracks the tiles across camera frames.
 */
export class TileTracker {
  private readonly layout: TileLayout;
  private readonly paddingModules: number;
  private readonly tileMissLimit: number;
  private readonly emptyFrameLimit: number;
  private readonly researchInterval: number;
  private tiles = new Map<number, Tracked>();
  private emptyFrames = 0;
  private framesSinceSearch = 0;
  private searches = 0;

  constructor(options: TileTrackerOptions) {
    this.layout = options.layout;
    this.paddingModules = Math.max(0, Math.min(options.paddingModules ?? 3, TILE_QUIET_MODULES));
    this.tileMissLimit = Math.max(1, options.tileMissLimit ?? 8);
    this.emptyFrameLimit = Math.max(1, options.emptyFrameLimit ?? 3);
    this.researchInterval = Math.max(1, options.researchInterval ?? 15);
  }

  /** True while tile positions are known and frames are decoded as crops. */
  public get isTracking(): boolean {
    return this.tiles.size > 0;
  }

  /** How many full searches have been asked for, the first included. */
  public get searchCount(): number {
    return this.searches;
  }

  /** The boxes now tracked, by tile number. */
  public get positions(): ReadonlyMap<number, Rect> {
    return new Map([...this.tiles].map(([tile, tracked]) => [tile, tracked.rect]));
  }

  /**
   * What to do with the next camera frame.
   * @param frame - Frame size in pixels, to keep crops inside it.
   * @returns A full search, or the crops to decode.
   */
  public plan(frame: { width: number; height: number }): TrackPlan {
    const incomplete = this.tiles.size < this.layout.tiles;
    if (this.tiles.size === 0 || (incomplete && this.framesSinceSearch >= this.researchInterval)) {
      this.searches += 1;
      this.framesSinceSearch = 0;
      return { kind: 'search' };
    }
    this.framesSinceSearch += 1;
    const crops = [...this.tiles].map(([tile, tracked]) => ({ tile, rect: this.cropFor(tracked.rect, frame) }));
    return { kind: 'crops', crops };
  }

  /**
   * Records what a full search found.
   * @param found - Boxes of the codes it located. Empty leaves the tracker searching.
   */
  public reportSearch(found: readonly Rect[]): void {
    if (found.length === 0) return;
    const rects = predictTileRects(found, this.layout).slice(0, this.layout.tiles);
    this.tiles = new Map(rects.map((rect, index) => [index, { rect, misses: 0 }]));
    this.emptyFrames = 0;
  }

  /**
   * Records what the crops of one frame decoded. A decoded tile keeps its place (and moves to where
   * the code was seen); a tile that keeps failing is dropped; a frame after frame of nothing sends
   * the tracker back to a full search.
   * @param results - One entry per crop planned for the frame.
   */
  public reportCrops(results: readonly CropResult[]): void {
    let decoded = 0;
    for (const result of results) {
      const tracked = this.tiles.get(result.tile);
      if (!tracked) continue;
      if (result.ok) {
        decoded += 1;
        tracked.misses = 0;
        if (result.rect) tracked.rect = result.rect;
      } else {
        tracked.misses += 1;
        if (tracked.misses >= this.tileMissLimit) this.tiles.delete(result.tile);
      }
    }
    this.emptyFrames = decoded > 0 ? 0 : this.emptyFrames + 1;
    if (this.emptyFrames >= this.emptyFrameLimit) this.lose();
  }

  /** Forgets every position, so the next plan is a full search. */
  public lose(): void {
    this.tiles = new Map();
    this.emptyFrames = 0;
  }

  private cropFor(rect: Rect, frame: { width: number; height: number }): Rect {
    const margin = (rect.width / this.layout.modules) * this.paddingModules;
    const x0 = Math.max(0, Math.floor(rect.x - margin));
    const y0 = Math.max(0, Math.floor(rect.y - margin));
    const x1 = Math.min(frame.width, Math.ceil(rect.x + rect.width + margin));
    const y1 = Math.min(frame.height, Math.ceil(rect.y + rect.height + margin));
    return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  }
}

/** Remembers which symbols a receiver has already been given. */
export interface SymbolDedup {
  /**
   * @param text - Text read from a code.
   * @returns False for a data frame whose (session, symbol IDs) were already accepted; true for a
   * new one, for manifests (the receiver counts repeats) and for text that is not a frame at all.
   */
  accept(text: string): boolean;
}

/**
 * Creates a dedup. The same frame is read many times (a tile holds for several camera frames, and a
 * stagger repeats the unchanged tiles), and one symbol should reach the decoder once.
 * @param limit - How many frames to remember (default 4096); the oldest are forgotten first.
 * @returns The dedup.
 */
export function createSymbolDedup(limit = 4096): SymbolDedup {
  const seen = new Set<string>();
  return {
    accept(text) {
      const decoded = decodeFrame(text);
      if (!decoded.ok || decoded.frame.type !== 'data') return true;
      const { sessionId, blockNumber, firstSymbol, count } = decoded.frame;
      const key = `${sessionId}:${blockNumber}:${firstSymbol}:${count}`;
      if (seen.has(key)) return false;
      seen.add(key);
      if (seen.size > limit) {
        const oldest = seen.values().next();
        if (!oldest.done) seen.delete(oldest.value);
      }
      return true;
    },
  };
}
