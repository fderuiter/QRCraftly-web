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
 * Multi-code transfer benchmark (#1142): a seeded end-to-end simulation of a sender showing tiled
 * Prism frames and a receiver that finds them once, tracks them and decodes crops.
 *
 * What is real: the Prism frames, the fountain code, QR encoding at a fixed version, the pixels, the
 * jsQR decode of every tile, the tile tracker, the dedup and the receiver. What is simulated: the
 * display and the camera. The camera sees the screen filling its frame, sharp, level and in sync with
 * the display, apart from the tear scenario. Decode times are this machine's, one thread.
 */
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import {
  PrismReceiver,
  PrismStream,
  TILE_LAYOUTS,
  TILE_QUIET_MODULES,
  TileTracker,
  createPrismSession,
  createSymbolDedup,
  layoutFootprint,
  tileFrameIndex,
  tileSlot,
  type Rect,
  type TileLayout,
  type TileLayoutId,
} from '../../src/packages/optical-transfer/index';
import { createRandom } from './scannerCorpus';

const LIGHT = 232;
const DARK = 28;
const BACKGROUND = 128;

export interface GreyFrame {
  /** One byte per pixel. */
  grey: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * A Prism stream whose symbols fill the tiles of a layout.
 * @param bytes - The file.
 * @param layout - The layout.
 * @returns The stream.
 */
export async function createTileStream(bytes: Uint8Array, layout: TileLayout): Promise<PrismStream> {
  // A precompressed MIME type keeps the message equal to the file, so the manifest's length and CRC stay valid.
  const session = await createPrismSession(bytes, {
    fileName: 'bench.bin',
    mimeType: 'image/png',
    errorCorrectionLevel: 'L',
    maxVersion: 20,
  });
  return new PrismStream(bytes, { ...session.manifest, symbolSize: layout.symbolSize }, { symbolsPerFrame: layout.symbolsPerFrame });
}

/** A rendered tile: grey values of the code and its quiet zone. */
interface TileBitmap {
  side: number;
  pixels: Uint8ClampedArray;
}

/** Renders and caches tile bitmaps, one per frame text. */
class TileRenderer {
  private readonly cache = new Map<string, TileBitmap>();

  constructor(
    private readonly layout: TileLayout,
    private readonly modulePx: number
  ) {}

  public bitmap(text: string): TileBitmap {
    const cached = this.cache.get(text);
    if (cached) return cached;
    // The version is fixed, so a tile's size does not depend on what it carries (a manifest is short).
    const qr = QRCode.create(text, { errorCorrectionLevel: 'L', version: this.layout.version });
    const count = qr.modules.size;
    const side = (count + 2 * TILE_QUIET_MODULES) * this.modulePx;
    const pixels = new Uint8ClampedArray(side * side).fill(LIGHT);
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (!qr.modules.get(y, x)) continue;
        for (let dy = 0; dy < this.modulePx; dy++) {
          const row = ((y + TILE_QUIET_MODULES) * this.modulePx + dy) * side + (x + TILE_QUIET_MODULES) * this.modulePx;
          pixels.fill(DARK, row, row + this.modulePx);
        }
      }
    }
    const bitmap = { side, pixels };
    if (this.cache.size > 400) this.cache.clear();
    this.cache.set(text, bitmap);
    return bitmap;
  }
}

export interface SimScreen {
  frame: { width: number; height: number };
  modulePx: number;
}

/** Where tile cells (code plus quiet zone) sit in the frame, and where the code itself sits. */
function tilePlacement(layout: TileLayout, screen: SimScreen): { cell: Rect[]; code: Rect[] } {
  const { width, height } = layoutFootprint(layout);
  const originX = Math.floor((screen.frame.width - width * screen.modulePx) / 2);
  const originY = Math.floor((screen.frame.height - height * screen.modulePx) / 2);
  const pitch = (layout.modules + 2 * TILE_QUIET_MODULES) * screen.modulePx;
  const cell: Rect[] = [];
  const code: Rect[] = [];
  for (let tile = 0; tile < layout.tiles; tile++) {
    const x = originX + (tile % layout.columns) * pitch;
    const y = originY + Math.floor(tile / layout.columns) * pitch;
    cell.push({ x, y, width: pitch, height: pitch });
    const quiet = TILE_QUIET_MODULES * screen.modulePx;
    code.push({ x: x + quiet, y: y + quiet, width: pitch - 2 * quiet, height: pitch - 2 * quiet });
  }
  return { cell, code };
}

/** What the sender shows: tile text for any display refresh. */
export class TileSender {
  private readonly renderer: TileRenderer;
  public readonly placement: { cell: Rect[]; code: Rect[] };

  constructor(
    public readonly stream: PrismStream,
    public readonly layout: TileLayout,
    public readonly screen: SimScreen,
    public readonly hold: number,
    public readonly staggered: boolean
  ) {
    this.renderer = new TileRenderer(layout, screen.modulePx);
    this.placement = tilePlacement(layout, screen);
  }

  /** The slot a tile is in at a refresh; without staggering every tile changes together. */
  public slot(tile: number, refresh: number): number {
    return this.staggered ? tileSlot(this.layout, tile, refresh, this.hold) : Math.floor(refresh / this.hold);
  }

  /** The text of each tile at a refresh. */
  public texts(refresh: number): string[] {
    return Array.from({ length: this.layout.tiles }, (_, tile) => this.stream.frameText(tileFrameIndex(this.layout, tile, this.slot(tile, refresh))));
  }

  /** Paints what the display shows at a refresh into `frame`, rows `from` up to (not including) `to`. */
  public paint(frame: GreyFrame, refresh: number, from: number, to: number): void {
    const texts = this.texts(refresh);
    for (let tile = 0; tile < texts.length; tile++) {
      const bitmap = this.renderer.bitmap(texts[tile]);
      const cell = this.placement.cell[tile];
      for (let row = Math.max(from, cell.y); row < Math.min(to, cell.y + cell.height); row++) {
        const source = (row - cell.y) * bitmap.side;
        frame.grey.set(bitmap.pixels.subarray(source, source + bitmap.side), row * frame.width + cell.x);
      }
    }
  }

  /**
   * One camera frame: the display at `refresh`, or, torn, the display at the refresh before above
   * `tearRow` and at `refresh` from there down.
   */
  public capture(refresh: number, tearRow?: number): GreyFrame {
    const { width, height } = this.screen.frame;
    const frame: GreyFrame = { grey: new Uint8ClampedArray(width * height).fill(BACKGROUND), width, height };
    if (tearRow === undefined) {
      this.paint(frame, refresh, 0, height);
    } else {
      this.paint(frame, Math.max(0, refresh - 1), 0, tearRow);
      this.paint(frame, refresh, tearRow, height);
    }
    return frame;
  }
}

/** Grey plane to the RGBA jsQR reads. */
export function toRgba(grey: Uint8ClampedArray): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(grey.length * 4);
  for (let i = 0; i < grey.length; i++) {
    const value = grey[i];
    rgba[i * 4] = value;
    rgba[i * 4 + 1] = value;
    rgba[i * 4 + 2] = value;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export interface Decoded {
  text: string;
  rect: Rect;
}

export function boundingBox(location: NonNullable<ReturnType<typeof jsQR>>['location'], offsetX: number, offsetY: number): Rect {
  const xs = [location.topLeftCorner.x, location.topRightCorner.x, location.bottomLeftCorner.x, location.bottomRightCorner.x];
  const ys = [location.topLeftCorner.y, location.topRightCorner.y, location.bottomLeftCorner.y, location.bottomRightCorner.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: x + offsetX, y: y + offsetY, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Decodes the crop of a frame with jsQR.
 * @param frame - The camera frame.
 * @param crop - The region.
 * @returns The text and where the code sat in frame pixels, or null.
 */
export function decodeCrop(frame: GreyFrame, crop: Rect): Decoded | null {
  const grey = new Uint8ClampedArray(crop.width * crop.height);
  for (let row = 0; row < crop.height; row++) {
    const start = (crop.y + row) * frame.width + crop.x;
    grey.set(frame.grey.subarray(start, start + crop.width), row * crop.width);
  }
  const result = jsQR(toRgba(grey), crop.width, crop.height, { inversionAttempts: 'dontInvert' });
  return result ? { text: result.data, rect: boundingBox(result.location, crop.x, crop.y) } : null;
}

/**
 * A multi-code search with a single-code decoder. jsQR reads one code per image and fails when
 * several are in view (it did not decode one of four tiles in a 1080p frame), so the bench tries
 * every layout as a hypothesis: it cuts the frame into that layout's cells, assuming the screen
 * fills the frame, and keeps the hypothesis that decodes the most. The shipped scanner would use
 * zxing's multi-symbol read here. Search cost in the bench is therefore a stand-in, not a measurement
 * of that read.
 * @param frame - The camera frame.
 * @returns Every code found by the best hypothesis.
 */
export function searchAll(frame: GreyFrame): Decoded[] {
  let best: Decoded[] = [];
  for (const layout of Object.values(TILE_LAYOUTS)) {
    const { width, height } = layoutFootprint(layout);
    const modulePx = Math.floor(Math.min(frame.width / width, frame.height / height));
    if (modulePx < 1) continue;
    const { cell } = tilePlacement(layout, { frame, modulePx });
    const hits = cell.map((rect) => decodeCrop(frame, rect)).filter((hit): hit is Decoded => hit !== null);
    if (hits.length > best.length) best = hits;
  }
  return best;
}

const median = (values: number[]): number => (values.length === 0 ? 0 : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]);

export interface TileRunOptions {
  layoutId: TileLayoutId;
  screen: SimScreen;
  /** File size in bytes. */
  bytes: number;
  /** Whole display refreshes per frame (2 on a 60 Hz display is 30 fps). */
  hold: number;
  staggered: boolean;
  refreshHz?: number;
  cameraFps?: number;
  /** Tear every camera frame at a random row between two refreshes. */
  tear?: boolean;
  /** Decode every frame as a full search instead of tracking (the cost without #1142's tracker). */
  noTracking?: boolean;
  seed?: number;
  /** Give up after this many camera frames. */
  maxCameraFrames?: number;
}

export interface TileRunResult {
  complete: boolean;
  cameraFrames: number;
  /** Simulated seconds on the camera's clock. */
  seconds: number;
  /** File bytes divided by the simulated seconds, in KB/s (1 KB = 1000 bytes). */
  goodputKBps: number;
  searches: number;
  /** Individual code decodes that returned a frame (a tile read again counts again). */
  decodes: number;
  /** Frames the dedup kept out of the receiver. */
  duplicates: number;
  cropMsMedian: number;
  searchMsMedian: number;
  /** Real jsQR time spent decoding, per simulated camera frame, in milliseconds. */
  decodeMsPerFrame: number;
}

/**
 * Sends a seeded random file through the simulated display and camera.
 * @param options - Layout, screen, pacing and scenario.
 * @returns What the transfer took.
 */
export async function runTileTransfer(options: TileRunOptions): Promise<TileRunResult> {
  const layout = TILE_LAYOUTS[options.layoutId];
  const refreshHz = options.refreshHz ?? 60;
  const cameraFps = options.cameraFps ?? 30;
  const random = createRandom(options.seed ?? 7);
  const file = new Uint8Array(options.bytes);
  for (let i = 0; i < file.length; i++) file[i] = Math.floor(random() * 256);

  const stream = await createTileStream(file, layout);
  const sender = new TileSender(stream, layout, options.screen, options.hold, options.staggered);
  const receiver = new PrismReceiver();
  const dedup = createSymbolDedup();
  const tracker = new TileTracker({ layout });
  const cropTimes: number[] = [];
  const searchTimes: number[] = [];
  let decodeMs = 0;
  let decodes = 0;
  let duplicates = 0;
  const limit = options.maxCameraFrames ?? 900;

  const take = (text: string): void => {
    decodes += 1;
    if (!dedup.accept(text)) {
      duplicates += 1;
      return;
    }
    receiver.ingest(text);
  };

  let frameCount = 0;
  while (!receiver.isComplete && frameCount < limit) {
    const refresh = Math.floor((frameCount * refreshHz) / cameraFps);
    const tearRow = options.tear && refresh > 0 ? Math.floor(random() * options.screen.frame.height) : undefined;
    const frame = sender.capture(refresh, tearRow);
    const plan = options.noTracking ? { kind: 'search' as const } : tracker.plan(options.screen.frame);
    if (plan.kind === 'search') {
      const started = performance.now();
      const found = searchAll(frame);
      const elapsed = performance.now() - started;
      searchTimes.push(elapsed);
      decodeMs += elapsed;
      for (const hit of found) take(hit.text);
      tracker.reportSearch(found.map((hit) => hit.rect));
    } else {
      const results = plan.crops.map((crop) => {
        const started = performance.now();
        const hit = decodeCrop(frame, crop.rect);
        const elapsed = performance.now() - started;
        cropTimes.push(elapsed);
        decodeMs += elapsed;
        if (hit) take(hit.text);
        return { tile: crop.tile, ok: hit !== null, rect: hit?.rect };
      });
      tracker.reportCrops(results);
    }
    frameCount += 1;
  }

  const seconds = frameCount / cameraFps;
  return {
    complete: receiver.isComplete,
    cameraFrames: frameCount,
    seconds,
    goodputKBps: receiver.isComplete ? Number((options.bytes / 1000 / seconds).toFixed(1)) : 0,
    searches: tracker.searchCount,
    decodes,
    duplicates,
    cropMsMedian: Number(median(cropTimes).toFixed(1)),
    searchMsMedian: Number(median(searchTimes).toFixed(1)),
    decodeMsPerFrame: Number((decodeMs / Math.max(1, frameCount)).toFixed(1)),
  };
}

export interface TearResult {
  /** Share of tiles that decoded, worst over the tear positions and refreshes tried. */
  worst: number;
  mean: number;
  /** Tear positions tried. */
  positions: number;
}

/**
 * Tears a frame at many rows across the screen and counts the tiles that still decode.
 * @param layoutId - The layout.
 * @param screen - Frame and module size.
 * @param hold - Whole refreshes per frame.
 * @param staggered - Whether the diagonal groups change on alternate refreshes.
 * @param positions - Tear rows tried between the top and bottom of the codes (default 9).
 * @returns The share of tiles that survive.
 */
export async function runTearScenario(layoutId: TileLayoutId, screen: SimScreen, hold: number, staggered: boolean, positions = 9): Promise<TearResult> {
  const layout = TILE_LAYOUTS[layoutId];
  const stream = await createTileStream(new Uint8Array(layout.symbolSize * layout.tiles * 40).map((_, i) => (i * 2654435761) >>> 24), layout);
  const sender = new TileSender(stream, layout, screen, hold, staggered);
  const top = Math.min(...sender.placement.cell.map((cell) => cell.y));
  const bottom = Math.max(...sender.placement.cell.map((cell) => cell.y + cell.height));
  // Refreshes where something changes: the tear then has two different pictures to mix.
  const refreshes = Array.from({ length: 4 * hold }, (_, i) => hold * 2 + i).filter((refresh) => {
    const before = sender.texts(refresh - 1);
    return sender.texts(refresh).some((text, tile) => text !== before[tile]);
  });
  const shares: number[] = [];
  for (const refresh of refreshes) {
    const before = sender.texts(refresh - 1);
    const after = sender.texts(refresh);
    for (let p = 0; p < positions; p++) {
      const tearRow = Math.round(top + ((p + 0.5) / positions) * (bottom - top));
      const frame = sender.capture(refresh, tearRow);
      let good = 0;
      for (let tile = 0; tile < layout.tiles; tile++) {
        const cell = sender.placement.cell[tile];
        const hit = decodeCrop(frame, cell);
        if (hit && (hit.text === before[tile] || hit.text === after[tile])) good += 1;
      }
      shares.push(good / layout.tiles);
    }
  }
  return { worst: Math.min(...shares), mean: Number((shares.reduce((a, b) => a + b, 0) / shares.length).toFixed(3)), positions: shares.length };
}

export interface PoolMeasurement {
  workers: number;
  /** jsQR decodes of one tile crop per second, all workers together. */
  decodesPerSecond: number;
  /** Longest gap between ticks of a 16 ms timer on the main thread while the workers ran, in milliseconds. */
  mainThreadMaxLagMs: number;
}

const POOL_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const jsQR = require('jsqr');
const rgba = new Uint8ClampedArray(workerData.rgba);
let decoded = 0;
const end = Date.now() + workerData.ms;
while (Date.now() < end) {
  if (jsQR(rgba, workerData.width, workerData.height, { inversionAttempts: 'dontInvert' })) decoded += 1;
}
parentPort.postMessage(decoded);
`;

/** One 2x2 v25 tile of a 1080p frame as the RGBA a decoder reads: the crop a tracked frame decodes. */
export async function sampleTileCrop(): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const layout = TILE_LAYOUTS['2x2-v25'];
  const screen: SimScreen = { frame: { width: 1920, height: 1080 }, modulePx: 4 };
  const stream = await createTileStream(new Uint8Array(layout.symbolSize * 8).map((_, i) => (i * 40503) >>> 7), layout);
  const sender = new TileSender(stream, layout, screen, 2, true);
  const frame = sender.capture(4);
  const cell = sender.placement.cell[0];
  const crop = new Uint8ClampedArray(cell.width * cell.height);
  for (let row = 0; row < cell.height; row++) crop.set(frame.grey.subarray((cell.y + row) * frame.width + cell.x, (cell.y + row) * frame.width + cell.x + cell.width), row * cell.width);
  return { rgba: toRgba(crop), width: cell.width, height: cell.height };
}

/**
 * Measures how many tile crops per second real threads decode with jsQR: one crop of a 2x2 v25 tile at
 * 1080p, decoded in a loop on each worker thread.
 * @param workerCounts - Pool sizes to try.
 * @param millis - How long each size runs.
 * @returns One measurement per size.
 */
export async function measureDecoderPool(workerCounts: readonly number[], millis = 2000): Promise<PoolMeasurement[]> {
  const { Worker } = await import('node:worker_threads');
  const { rgba, width, height } = await sampleTileCrop();

  const results: PoolMeasurement[] = [];
  for (const workers of workerCounts) {
    let maxLag = 0;
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      maxLag = Math.max(maxLag, now - last - 16);
      last = now;
    }, 16);
    const counts = await Promise.all(
      Array.from(
        { length: workers },
        () =>
          new Promise<number>((resolve, reject) => {
            const worker = new Worker(POOL_WORKER, { eval: true, workerData: { rgba: rgba.buffer.slice(0), width, height, ms: millis } });
            worker.once('message', (decoded: number) => resolve(decoded));
            worker.once('error', reject);
          })
      )
    );
    clearInterval(ticker);
    results.push({ workers, decodesPerSecond: Math.round(counts.reduce((a, b) => a + b, 0) / (millis / 1000)), mainThreadMaxLagMs: Math.round(Math.max(0, maxLag)) });
  }
  return results;
}
