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
 * The multi-code receiver (#1142). It reads the camera itself, frame by frame, instead of the
 * scanner's one-code loop: a full search finds every tile, then the frames after it read each
 * tile from its known corners (the fast path) until tracking is lost. Frames go to a pool of
 * decoder workers; when every worker is busy the camera frame is skipped, never queued.
 */
import type { QrTile } from '@/packages/qr-decode';
import type { CameraFrameLoop, ScanCorners } from '@/packages/optical-scanner/client';
import { TILE_LAYOUTS, type TileLayout } from '../multicode/layout';
import { createDecoderPool, type DecoderPool } from '../multicode/pool';
import { TileTracker, createSymbolDedup, type Rect } from '../multicode/tracker';
import type { TileCode, TileReadRequest, TileReadResponse } from './tileContracts';

/**
 * The layout a stream of codes of this version and count was sent with, or null when no layout
 * uses that version (a single-code stream): the reader then searches every frame.
 * @param version - QR version of the codes found.
 * @param found - How many were found in one frame.
 */
export function layoutForCodes(version: number, found: number): TileLayout | null {
  const candidates = Object.values(TILE_LAYOUTS)
    .filter((layout) => layout.version === version)
    .sort((a, b) => a.tiles - b.tiles);
  return candidates.find((layout) => layout.tiles >= found) ?? candidates.at(-1) ?? null;
}

function boundsOf(corners: TileCode['corners']): Rect {
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function cornersOf(rect: Rect): QrTile['corners'] {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return [{ x: rect.x, y: rect.y }, { x: right, y: rect.y }, { x: right, y: bottom }, { x: rect.x, y: bottom }];
}

/** What to read in the next frame: a full search, or these tiles from their corners. */
export interface TilePlan {
  /** Tile numbers, in the order of `tiles`. */
  numbers: number[];
  tiles: QrTile[];
}

/**
 * The tracking state of one receiver, without any pixels or workers, so it can be tested on its
 * own. `plan` says what to read in a frame and `report` takes what came back.
 */
export class TileReadSession {
  private layout: TileLayout | null = null;
  private tracker: TileTracker | null = null;
  /** Last corners each tile was read at; a predicted tile has none until it first reads. */
  private corners = new Map<number, QrTile['corners']>();

  /** True while tiles are tracked and frames are read on the fast path. */
  public get isTracking(): boolean {
    return this.tracker?.isTracking ?? false;
  }

  /**
   * @param frame - Frame size in pixels.
   * @returns The tracked tiles to read, or null for a full search.
   */
  public plan(frame: { width: number; height: number }): TilePlan | null {
    const { tracker, layout } = this;
    if (!tracker || !layout) return null;
    const plan = tracker.plan(frame);
    if (plan.kind === 'search') return null;
    const positions = tracker.positions;
    const numbers = plan.crops.map((crop) => crop.tile);
    const tiles = numbers.map((tile) => {
      const rect = positions.get(tile);
      return { corners: this.corners.get(tile) ?? cornersOf(rect ?? { x: 0, y: 0, width: 0, height: 0 }), version: layout.version, level: 'L' as const };
    });
    return { numbers, tiles };
  }

  /**
   * Takes what a frame read.
   * @param plan - The plan the frame was read with (null for a search).
   * @param codes - The worker's codes for it.
   * @returns The codes that read.
   */
  public report(plan: TilePlan | null, codes: ReadonlyArray<TileCode | null>): TileCode[] {
    const read = codes.filter((code): code is TileCode => code !== null);
    if (!plan) {
      this.reportSearch(read);
      return read;
    }
    if (!this.tracker) return read;
    const results = plan.numbers.map((tile, index) => {
      const code = codes[index] ?? null;
      if (code) this.corners.set(tile, code.corners);
      return { tile, ok: code !== null, rect: code ? boundsOf(code.corners) : undefined };
    });
    this.tracker.reportCrops(results);
    if (!this.tracker.isTracking) this.corners.clear();
    return read;
  }

  private reportSearch(read: TileCode[]): void {
    if (read.length === 0) return;
    const layout = layoutForCodes(read[0].version, read.length);
    if (!layout) {
      this.layout = null;
      this.tracker = null;
      this.corners.clear();
      return;
    }
    if (layout !== this.layout) {
      this.layout = layout;
      this.tracker = new TileTracker({ layout });
    }
    const tracker = this.tracker;
    if (!tracker) return;
    const tiles = read.filter((code) => code.version === layout.version);
    const rects = tiles.map((code) => boundsOf(code.corners));
    tracker.reportSearch(rects);
    this.corners.clear();
    // Found tiles keep their exact corners; predicted ones start from their box.
    for (const [tile, rect] of tracker.positions) {
      const index = rects.indexOf(rect);
      if (index >= 0) this.corners.set(tile, tiles[index].corners);
    }
  }
}

/** A decoder worker as the reader uses it. */
export interface TileWorker {
  postMessage(message: TileReadRequest, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<TileReadResponse>) => void) | null;
  terminate(): void;
}

/** The parts of a video element the reader uses. */
export interface TileVideoSource {
  readonly readyState: number;
  readonly videoWidth: number;
  readonly videoHeight: number;
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

export interface TileReaderOptions {
  /** The element the camera streams into. */
  getVideo: () => TileVideoSource | null;
  /** Decoder workers to run. */
  poolSize: number;
  /** Receives every code read once: repeats of a data frame are dropped. */
  onText: (text: string) => void;
  /** Receives where the first code of a frame sat, for the lock-on brackets. */
  onCorners?: (corners: ScanCorners) => void;
  /** Receives every code a camera frame read, repeats included, once per camera frame read (none is an empty list). */
  onFrameRead?: (codes: readonly TileCode[]) => void;
  /** Starts one decoder worker. */
  spawnWorker: () => TileWorker;
  /** Grabs the current camera frame. Defaults to `createImageBitmap`. */
  grab?: (video: TileVideoSource) => Promise<ImageBitmap>;
}

/** A started reader is the camera session's frame loop. */
export type TileReader = CameraFrameLoop;

interface Job {
  plan: TilePlan | null;
  request: Omit<TileReadRequest, 'id'>;
}

interface Result {
  plan: TilePlan | null;
  response: TileReadResponse;
}

/** `HTMLVideoElement.HAVE_CURRENT_DATA`. */
const HAVE_CURRENT_DATA = 2;

/**
 * Creates the reader. Nothing runs and no worker starts until `start`.
 * @param options - Video source, pool size, callbacks and worker factory.
 * @returns The frame loop to hand to the camera session.
 */
export function createTileReader(options: TileReaderOptions): TileReader {
  const size = Math.max(1, Math.floor(options.poolSize));
  const grab =
    options.grab ??
    ((video: TileVideoSource) =>
      typeof HTMLVideoElement !== 'undefined' && video instanceof HTMLVideoElement
        ? createImageBitmap(video)
        : Promise.reject(new Error('No camera frame to grab.')));
  let workers: TileWorker[] = [];
  let pool: DecoderPool<Job> | null = null;
  let session = new TileReadSession();
  let dedup = createSymbolDedup();
  let running = false;
  let handle: { video: TileVideoSource; id: number } | { video: null; id: number } | null = null;
  let frameId = 0;
  let requestId = 0;
  let grabbing = false;
  const pending = new Map<number, (response: TileReadResponse) => void>();

  const run = (job: Job, slot: number): Promise<Result> =>
    new Promise((resolve) => {
      const id = ++requestId;
      pending.set(id, (response) => resolve({ plan: job.plan, response }));
      workers[slot].postMessage({ ...job.request, id }, [job.request.image]);
    });

  const onResult = ({ plan, response }: Result): void => {
    if (!running) return;
    const codes = session.report(plan, response.codes);
    if (codes.length > 0) {
      const [first] = codes;
      options.onCorners?.([first.corners[0], first.corners[1], first.corners[2], first.corners[3]]);
    }
    options.onFrameRead?.(codes);
    for (const code of codes) {
      if (dedup.accept(code.text)) options.onText(code.text);
    }
  };

  const onFrame = async (): Promise<void> => {
    const video = options.getVideo();
    const active = pool;
    if (!video || !active || grabbing || video.readyState < HAVE_CURRENT_DATA || video.videoWidth === 0) return;
    // Every worker busy: skip this camera frame rather than queue a stale one.
    if (active.stats().inFlight >= size) return;
    grabbing = true;
    try {
      const frame = { width: video.videoWidth, height: video.videoHeight };
      const image = await grab(video);
      if (!running) {
        image.close();
        return;
      }
      const plan = session.plan(frame);
      active.submit(++frameId, [{ plan, request: { image, tiles: plan?.tiles ?? null } }]);
    } catch {
      // A frame that cannot be grabbed (the stream just stopped) is skipped.
    } finally {
      grabbing = false;
    }
  };

  const schedule = (): void => {
    if (!running) return;
    const video = options.getVideo();
    const tick = () => {
      void onFrame();
      schedule();
    };
    if (video?.requestVideoFrameCallback) {
      handle = { video, id: video.requestVideoFrameCallback(tick) };
    } else {
      handle = { video: null, id: requestAnimationFrame(tick) };
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      session = new TileReadSession();
      dedup = createSymbolDedup();
      workers = Array.from({ length: size }, () => {
        const worker = options.spawnWorker();
        worker.onmessage = (event) => {
          const resolve = pending.get(event.data.id);
          pending.delete(event.data.id);
          resolve?.(event.data);
        };
        return worker;
      });
      pool = createDecoderPool<Job, Result>({ size, run, onResult });
      schedule();
    },
    stop() {
      running = false;
      if (handle?.video) handle.video.cancelVideoFrameCallback?.(handle.id);
      else if (handle) cancelAnimationFrame(handle.id);
      handle = null;
      for (const worker of workers) worker.terminate();
      workers = [];
      pool = null;
      pending.clear();
    },
  };
}
