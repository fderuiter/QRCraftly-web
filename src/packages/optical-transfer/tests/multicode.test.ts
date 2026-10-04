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

import { describe, expect, it } from 'vitest';
import {
  FRAME_OVERHEAD,
  MIN_MODULE_CSS_PX,
  TILE_LAYOUTS,
  TILE_QUIET_MODULES,
  TileTracker,
  alphanumericCapacityL,
  createDecoderPool,
  createPrismSession,
  createSymbolDedup,
  createVsyncPacer,
  decoderPoolSize,
  effectiveFps,
  holdForTargetFps,
  layoutFootprint,
  measureRefreshInterval,
  modulePxFor,
  planMultiCode,
  predictTileRects,
  prismFrameCapacity,
  qrModuleCount,
  refreshRateFromInterval,
  selectLayout,
  tileFrameCapacity,
  tileFrameIndex,
  tileGroup,
  tileSlot,
  tileSymbolPlan,
  tilesChangingAt,
  tilesIntactAcross,
  worstIntactFraction,
  type FrameClock,
  type PacerTick,
  type Rect,
  type TileLayoutId,
} from '../index';

describe('multi-code layouts (#1142)', () => {
  it('agrees with the existing capacity table up to version 20 and knows the large versions', () => {
    for (let version = 1; version <= 20; version++) {
      expect(tileFrameCapacity(version)).toBe(prismFrameCapacity('L', version));
    }
    expect(alphanumericCapacityL(40)).toBe(4296);
    expect(alphanumericCapacityL(25)).toBe(1853);
    expect(qrModuleCount(40)).toBe(177);
  });

  it('fills a tile with symbols of at most 2048 bytes', () => {
    for (const layout of Object.values(TILE_LAYOUTS)) {
      const plan = tileSymbolPlan(layout.version);
      expect(plan.symbolSize).toBeLessThanOrEqual(2048);
      expect(plan.symbolSize * plan.symbolsPerFrame + FRAME_OVERHEAD).toBeLessThanOrEqual(tileFrameCapacity(layout.version));
    }
    expect(TILE_LAYOUTS['1xv40'].symbolsPerFrame).toBe(2);
    expect(TILE_LAYOUTS['2x2-v25'].symbolsPerFrame).toBe(1);
  });

  it('picks a layout whose modules are at least 3 CSS px, or none', () => {
    const cases: Array<[number, number, TileLayoutId | null]> = [
      [1920, 1080, '3x2-v20'],
      [1440, 900, '2x2-v25'],
      [1366, 768, '2x2-v25'],
      [1024, 768, '2x2-v25'],
      [700, 700, '2x2-v22'],
      [640, 640, '2x2-v20'],
      [800, 600, '1xv40'],
      [600, 600, '1xv40'],
      [450, 450, '1xv30'],
      [390, 844, null],
    ];
    for (const [width, height, expected] of cases) {
      const choice = selectLayout({ width, height });
      expect(choice?.layout.id ?? null, `${width}x${height}`).toBe(expected);
      if (choice) {
        expect(choice.modulePx).toBeGreaterThanOrEqual(MIN_MODULE_CSS_PX);
        const { width: w, height: h } = layoutFootprint(choice.layout);
        expect(w * choice.modulePx).toBeLessThanOrEqual(width);
        expect(h * choice.modulePx).toBeLessThanOrEqual(height);
      }
    }
  });

  it('prefers one large code when asked for a distant camera', () => {
    expect(selectLayout({ width: 1920, height: 1080 }, { prefer: 'single' })?.layout.id).toBe('1xv40');
    expect(selectLayout({ width: 450, height: 450 }, { prefer: 'single' })?.layout.id).toBe('1xv30');
  });

  it('keeps a quiet zone between tiles', () => {
    const layout = TILE_LAYOUTS['2x2-v25'];
    expect(layoutFootprint(layout).width).toBe(2 * (layout.modules + 2 * TILE_QUIET_MODULES));
    expect(modulePxFor(layout, { width: 100, height: 100 })).toBe(0);
  });

  it('carries about 5 KB per frame in the dense layouts', () => {
    expect(TILE_LAYOUTS['2x2-v25'].payloadPerFrame).toBeGreaterThan(4500);
    expect(TILE_LAYOUTS['1xv40'].payloadPerFrame).toBeGreaterThan(2700);
  });
});

describe('staggered tile refresh (#1142)', () => {
  const layout = TILE_LAYOUTS['2x2-v25'];

  it('splits the tiles into two diagonal groups', () => {
    expect([0, 1, 2, 3].map((tile) => tileGroup(layout, tile))).toEqual([0, 1, 1, 0]);
    expect(Array.from({ length: 6 }, (_, tile) => tileGroup(TILE_LAYOUTS['3x2-v20'], tile))).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('changes one diagonal on even refreshes and the other on odd ones at a hold of 2', () => {
    expect(tilesChangingAt(layout, 0, 2)).toEqual([0, 1, 2, 3]);
    expect(tilesChangingAt(layout, 2, 2)).toEqual([0, 3]);
    expect(tilesChangingAt(layout, 3, 2)).toEqual([1, 2]);
    expect(tilesChangingAt(layout, 4, 2)).toEqual([0, 3]);
    expect(tilesChangingAt(layout, 5, 2)).toEqual([1, 2]);
  });

  it('holds every tile for exactly the hold between its own changes', () => {
    for (const hold of [2, 3, 4, 6]) {
      for (let tile = 0; tile < layout.tiles; tile++) {
        const changes: number[] = [];
        for (let refresh = 1; refresh < 30; refresh++) if (tilesChangingAt(layout, refresh, hold).includes(tile)) changes.push(refresh);
        const gaps = changes.slice(1).map((value, i) => value - changes[i]);
        expect(new Set(gaps), `hold ${hold} tile ${tile}`).toEqual(new Set([hold]));
      }
    }
  });

  it('keeps at least half the tiles intact across any refresh when staggered', () => {
    for (const id of ['2x2-v25', '2x2-v20', '3x2-v20'] as const) {
      for (const hold of [2, 3, 4]) {
        expect(worstIntactFraction(TILE_LAYOUTS[id], hold), `${id} hold ${hold}`).toBeGreaterThanOrEqual(0.5);
      }
    }
    expect(tilesIntactAcross(layout, 2, 2)).toEqual([1, 2]);
  });

  it('cannot stagger at a hold of 1 or with one tile, and says so', () => {
    expect(worstIntactFraction(layout, 1)).toBe(0);
    expect(worstIntactFraction(TILE_LAYOUTS['1xv40'], 2)).toBe(0);
  });

  it('gives every tile and slot its own frame index', () => {
    const seen = new Set<number>();
    for (let refresh = 0; refresh < 40; refresh++) {
      for (let tile = 0; tile < layout.tiles; tile++) seen.add(tileFrameIndex(layout, tile, tileSlot(layout, tile, refresh, 2)));
    }
    // 4 tiles over 20 slots each, plus the shared slot 0 of the late group.
    expect(seen.size).toBe(4 * 20);
  });
});

/** A display clock the test steps by hand. */
class FakeFrameClock implements FrameClock {
  public time = 1000;
  private next = 1;
  private readonly pending = new Map<number, (timestamp: number) => void>();

  request(callback: (timestamp: number) => void): number {
    const handle = this.next++;
    this.pending.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.pending.delete(handle);
  }

  /** Advances to the next refresh (or several: the browser skipped them) and runs what was waiting. */
  advance(intervalMs: number, refreshes = 1, jitterMs = 0): void {
    this.time += intervalMs * refreshes + jitterMs;
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback(this.time);
  }
}

describe('vsync-locked pacing (#1142)', () => {
  it('measures the refresh interval from rAF timestamps, ignoring late frames', () => {
    const clean = Array.from({ length: 30 }, (_, i) => 5000 + i * (1000 / 60));
    expect(measureRefreshInterval(clean)).toBeCloseTo(1000 / 60, 3);
    // Two skipped refreshes and a few jittery ones.
    const rough = clean.map((t, i) => t + (i >= 10 ? 1000 / 60 : 0) + (i >= 20 ? 2 * (1000 / 60) : 0) + (i % 3) * 0.2);
    expect(measureRefreshInterval(rough)).toBeCloseTo(1000 / 60, 0);
    expect(measureRefreshInterval([1, 2])).toBeNull();
  });

  it('snaps near-standard rates and keeps odd ones', () => {
    expect(refreshRateFromInterval(1000 / 59.94)).toBe(60);
    expect(refreshRateFromInterval(1000 / 143.8)).toBe(144);
    expect(refreshRateFromInterval(1000 / 110)).toBeCloseTo(110, 5);
  });

  it('holds a whole number of refreshes and never exceeds the target fps', () => {
    expect(holdForTargetFps(60, 60)).toBe(1);
    expect(holdForTargetFps(60, 30)).toBe(2);
    expect(holdForTargetFps(120, 30)).toBe(4);
    expect(holdForTargetFps(144, 60)).toBe(3);
    expect(holdForTargetFps(60.4, 60)).toBe(1);
    expect(holdForTargetFps(0, 30)).toBe(1);
    for (const hz of [50, 60, 75, 90, 120, 144, 165, 240]) {
      for (const fps of [15, 24, 30, 45, 60]) {
        const hold = holdForTargetFps(hz, fps);
        expect(Number.isInteger(hold)).toBe(true);
        expect(effectiveFps(hz, hold)).toBeLessThanOrEqual(fps * 1.05 + 1e-9);
      }
    }
    expect(effectiveFps(60, 1)).toBe(60);
    expect(effectiveFps(60, 2)).toBe(30);
  });

  function run(hz: number, hold: number, frames: number, stall?: { at: number; refreshes: number }): PacerTick[] {
    const clock = new FakeFrameClock();
    const ticks: PacerTick[] = [];
    const interval = 1000 / hz;
    createVsyncPacer({ clock, hold, onTick: (tick) => ticks.push(tick) });
    for (let i = 0; i < frames; i++) clock.advance(interval, stall && i === stall.at ? stall.refreshes : 1);
    return ticks;
  }

  it('waits for a measurement, then starts frames only on multiples of the hold', () => {
    for (const [hz, hold] of [
      [60, 1],
      [60, 2],
      [120, 4],
      [144, 3],
    ] as const) {
      const ticks = run(hz, hold, 20 + 90);
      expect(ticks.length).toBeGreaterThan(80);
      expect(ticks[0].refresh).toBe(0);
      const starts = ticks.filter((tick) => tick.frameStart);
      for (const tick of starts) expect(tick.refresh % hold).toBe(0);
      const gaps = starts.slice(1).map((tick, i) => tick.refresh - starts[i].refresh);
      expect(new Set(gaps)).toEqual(new Set([hold]));
      // Wall-clock time between frame starts is the same whole number of refreshes.
      const times = starts.slice(1).map((tick, i) => tick.timestamp - starts[i].timestamp);
      for (const ms of times) expect(ms).toBeCloseTo((hold * 1000) / hz, 3);
      expect(ticks.every((tick, i) => i === 0 || tick.refresh === ticks[i - 1].refresh + 1)).toBe(true);
    }
  });

  it('shows 60 frames per second at a hold of 1 and 30 at a hold of 2 on a 60 Hz display', () => {
    const one = run(60, 1, 20 + 120).filter((tick) => tick.frameStart).length;
    const two = run(60, 2, 20 + 120).filter((tick) => tick.frameStart).length;
    expect(one).toBeGreaterThanOrEqual(2 * two - 1);
    expect(one).toBeLessThanOrEqual(2 * two + 1);
  });

  it('counts refreshes the browser skipped, so frames stay on the refresh grid', () => {
    const ticks = run(60, 2, 20 + 60, { at: 40, refreshes: 3 });
    const late = ticks.find((tick) => tick.skipped > 0);
    expect(late?.skipped).toBe(2);
    const starts = ticks.filter((tick) => tick.frameStart);
    // A frame start is on the grid unless the browser skipped past it, and then it comes late, once.
    for (const tick of starts) if (tick.skipped === 0) expect(tick.refresh % 2).toBe(0);
    expect(starts.filter((tick) => tick.skipped > 0)).toHaveLength(1);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].refresh).toBeGreaterThan(ticks[i - 1].refresh);
  });

  it('can be handed a known interval and stopped, and reports the lock', () => {
    const clock = new FakeFrameClock();
    const ticks: PacerTick[] = [];
    let locked = 0;
    const pacer = createVsyncPacer({ clock, hold: 2, refreshIntervalMs: 1000 / 60, onTick: (tick) => ticks.push(tick), onLocked: (info) => (locked = info.refreshHz) });
    clock.advance(1000 / 60);
    clock.advance(1000 / 60);
    expect(ticks.map((tick) => tick.refresh)).toEqual([0, 1]);
    expect(locked).toBe(60);
    expect(pacer.refreshHz).toBe(60);
    pacer.setHold(1);
    clock.advance(1000 / 60);
    expect(ticks[2].frameStart).toBe(true);
    pacer.stop();
    clock.advance(1000 / 60);
    expect(ticks).toHaveLength(3);
  });
});

describe('tile tracking (#1142)', () => {
  const layout = TILE_LAYOUTS['2x2-v25'];
  const frame = { width: 1920, height: 1080 };
  // Code boxes of a 2x2 layout at 4 px per module: 117 modules = 468 px, pitch 125 modules = 500 px.
  const grid = (): Rect[] => [
    { x: 476, y: 56, width: 468, height: 468 },
    { x: 976, y: 56, width: 468, height: 468 },
    { x: 476, y: 556, width: 468, height: 468 },
    { x: 976, y: 556, width: 468, height: 468 },
  ];

  it('starts with a full search and then plans crops at the found positions', () => {
    const tracker = new TileTracker({ layout });
    expect(tracker.plan(frame)).toEqual({ kind: 'search' });
    tracker.reportSearch(grid());
    const plan = tracker.plan(frame);
    expect(plan.kind).toBe('crops');
    if (plan.kind !== 'crops') return;
    expect(plan.crops).toHaveLength(4);
    for (const { rect } of plan.crops) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(frame.width);
      expect(rect.width).toBeLessThan(500);
    }
    expect(tracker.searchCount).toBe(1);
  });

  it('predicts the tiles a search missed once the others fix the grid', () => {
    const [a, , , d] = grid();
    const predicted = predictTileRects([a, d], layout);
    expect(predicted).toHaveLength(4);
    expect(predicted[1]).toMatchObject({ x: 976, y: 56 });
    expect(predicted[2]).toMatchObject({ x: 476, y: 556 });
    // One tile alone cannot tell where the others are.
    expect(predictTileRects([a], layout)).toHaveLength(1);
    // A box off the grid is not this layout; nothing is invented.
    expect(predictTileRects([a, { x: 700, y: 300, width: 500, height: 500 }], layout)).toHaveLength(2);
    expect(predictTileRects([], layout)).toEqual([]);
  });

  it('follows a tile that drifts and keeps tracking through a few misses', () => {
    const tracker = new TileTracker({ layout });
    tracker.plan(frame);
    tracker.reportSearch(grid());
    const moved = { ...grid()[0], x: 450 };
    tracker.reportCrops([
      { tile: 0, ok: true, rect: moved },
      { tile: 1, ok: false },
      { tile: 2, ok: true },
      { tile: 3, ok: false },
    ]);
    expect(tracker.positions.get(0)).toEqual(moved);
    expect(tracker.isTracking).toBe(true);
    expect(tracker.searchCount).toBe(1);
  });

  it('falls back to a full search when nothing decodes for a few frames', () => {
    const tracker = new TileTracker({ layout, emptyFrameLimit: 3 });
    tracker.plan(frame);
    tracker.reportSearch(grid());
    const misses = [0, 1, 2, 3].map((tile) => ({ tile, ok: false }));
    tracker.reportCrops(misses);
    tracker.reportCrops(misses);
    expect(tracker.plan(frame).kind).toBe('crops');
    tracker.reportCrops(misses);
    expect(tracker.isTracking).toBe(false);
    expect(tracker.plan(frame)).toEqual({ kind: 'search' });
    expect(tracker.searchCount).toBe(2);
  });

  it('drops a tile that keeps failing while the others decode', () => {
    const tracker = new TileTracker({ layout, tileMissLimit: 2 });
    tracker.plan(frame);
    tracker.reportSearch(grid());
    for (let i = 0; i < 2; i++) {
      tracker.reportCrops([
        { tile: 0, ok: true },
        { tile: 1, ok: false },
        { tile: 2, ok: true },
        { tile: 3, ok: true },
      ]);
    }
    const plan = tracker.plan(frame);
    expect(plan.kind === 'crops' ? plan.crops.map((crop) => crop.tile) : []).toEqual([0, 2, 3]);
  });

  it('searches again now and then while tiles are still missing', () => {
    const tracker = new TileTracker({ layout, researchInterval: 3 });
    tracker.plan(frame);
    tracker.reportSearch([grid()[0]]);
    const kinds = Array.from({ length: 6 }, () => tracker.plan(frame).kind);
    expect(kinds).toEqual(['crops', 'crops', 'crops', 'search', 'crops', 'crops']);
  });

  it('leaves the tracker searching when a search finds nothing', () => {
    const tracker = new TileTracker({ layout });
    tracker.plan(frame);
    tracker.reportSearch([]);
    expect(tracker.plan(frame)).toEqual({ kind: 'search' });
  });
});

describe('symbol dedup (#1142)', () => {
  it('lets a (session, symbol) through once and passes manifests and foreign text', async () => {
    const bytes = new Uint8Array(3000).map((_, i) => (i * 31) >>> 3);
    const session = await createPrismSession(bytes, { fileName: 'a.bin', mimeType: 'image/png', errorCorrectionLevel: 'L', maxVersion: 20 });
    const dedup = createSymbolDedup(3);
    const manifest = session.stream.frameText(0);
    const first = session.stream.frameText(1);
    const second = session.stream.frameText(2);
    expect(dedup.accept(first)).toBe(true);
    expect(dedup.accept(first)).toBe(false);
    expect(dedup.accept(second)).toBe(true);
    expect(dedup.accept(manifest)).toBe(true);
    expect(dedup.accept(manifest)).toBe(true);
    expect(dedup.accept('not a frame')).toBe(true);
    // A different session with the same symbol ID is a different key.
    const other = await createPrismSession(bytes.map((byte) => byte ^ 1), { fileName: 'b.bin', mimeType: 'image/png', errorCorrectionLevel: 'L', maxVersion: 20 });
    expect(dedup.accept(other.stream.frameText(1))).toBe(true);
  });

  it('forgets the oldest frames beyond its limit', async () => {
    const bytes = new Uint8Array(3000).map((_, i) => i >>> 2);
    const session = await createPrismSession(bytes, { fileName: 'a.bin', mimeType: 'image/png', errorCorrectionLevel: 'L', maxVersion: 20 });
    const dedup = createSymbolDedup(2);
    const frames = [1, 2, 3].map((index) => session.stream.frameText(index));
    for (const text of frames) expect(dedup.accept(text)).toBe(true);
    expect(dedup.accept(frames[0])).toBe(true);
    expect(dedup.accept(frames[2])).toBe(false);
  });
});

describe('decoder pool (#1142)', () => {
  it('sizes the pool from the cores, between 2 and 4', () => {
    expect(decoderPoolSize(undefined)).toBe(2);
    expect(decoderPoolSize(0)).toBe(2);
    expect(decoderPoolSize(2)).toBe(2);
    expect(decoderPoolSize(4)).toBe(2);
    expect(decoderPoolSize(6)).toBe(3);
    expect(decoderPoolSize(8)).toBe(4);
    expect(decoderPoolSize(64)).toBe(4);
    expect(decoderPoolSize(64, { max: 6 })).toBe(6);
  });

  /** Workers whose jobs the test finishes by hand. */
  function manualPool(size: number) {
    const started: Array<{ job: string; worker: number; finish: (value: string) => void }> = [];
    const results: Array<{ result: string; frameId: number; superseded: boolean }> = [];
    const errors: unknown[] = [];
    const pool = createDecoderPool<string, string>({
      size,
      run: (job, worker) =>
        new Promise((resolve, reject) => {
          started.push({ job, worker, finish: (value) => (value === 'boom' ? reject(new Error(value)) : resolve(value)) });
        }),
      onResult: (result, frameId, superseded) => results.push({ result, frameId, superseded }),
      onError: (error) => errors.push(error),
    });
    return { pool, started, results, errors };
  }

  it('runs at most `size` jobs at once, each on its own slot', async () => {
    const { pool, started, results } = manualPool(2);
    pool.submit(1, ['a', 'b', 'c']);
    expect(started.map((entry) => entry.job)).toEqual(['a', 'b']);
    expect(new Set(started.map((entry) => entry.worker)).size).toBe(2);
    expect(pool.stats()).toMatchObject({ inFlight: 2, queued: 1, submitted: 3 });
    started[0].finish('A');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(started.map((entry) => entry.job)).toEqual(['a', 'b', 'c']);
    started[1].finish('B');
    started[2].finish('C');
    await pool.idle();
    expect(results.map((entry) => entry.result).sort()).toEqual(['A', 'B', 'C']);
    expect(pool.stats()).toMatchObject({ completed: 3, dropped: 0, inFlight: 0, queued: 0 });
  });

  it('drops queued jobs of a superseded frame and marks the ones already running', async () => {
    const { pool, started, results } = manualPool(1);
    pool.submit(1, ['a1', 'a2', 'a3']);
    pool.submit(2, ['b1', 'b2']);
    expect(pool.stats()).toMatchObject({ dropped: 2, queued: 2, inFlight: 1 });
    started[0].finish('A1');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(results[0]).toEqual({ result: 'A1', frameId: 1, superseded: true });
    expect(started.map((entry) => entry.job)).toEqual(['a1', 'b1']);
    started[1].finish('B1');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    started[2].finish('B2');
    await pool.idle();
    expect(results.slice(1).map((entry) => entry.superseded)).toEqual([false, false]);
  });

  it('ignores a frame older than one it has already seen', () => {
    const { pool, started } = manualPool(1);
    pool.submit(5, ['x']);
    pool.submit(4, ['late', 'later']);
    expect(pool.stats()).toMatchObject({ dropped: 2, submitted: 1 });
    expect(started.map((entry) => entry.job)).toEqual(['x']);
  });

  it('keeps going after a worker fails', async () => {
    const { pool, started, results, errors } = manualPool(1);
    pool.submit(1, ['a', 'b']);
    started[0].finish('boom');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    started[1].finish('B');
    await pool.idle();
    expect(errors).toHaveLength(1);
    expect(results.map((entry) => entry.result)).toEqual(['B']);
    expect(pool.stats()).toMatchObject({ failed: 1, completed: 1 });
    await expect(pool.idle()).resolves.toBeUndefined();
  });
});

describe('multi-code switch (#1142)', () => {
  const base = { screen: { width: 1920, height: 1080 }, refreshHz: 60 } as const;

  it('is off unless it is explicitly enabled', () => {
    expect(planMultiCode({ ...base })).toBeNull();
    expect(planMultiCode({ ...base, enabled: false })).toBeNull();
  });

  it('plans layout, hold, staggering and pool when enabled', () => {
    const plan = planMultiCode({ ...base, enabled: true, hardwareConcurrency: 8 });
    expect(plan).toMatchObject({ hold: 2, fps: 30, staggered: true, poolSize: 4 });
    expect(plan?.layout.id).toBe('3x2-v20');
    expect(plan?.worstIntactFraction).toBeGreaterThanOrEqual(0.5);
    expect(plan?.ceilingBytesPerSecond).toBe(TILE_LAYOUTS['3x2-v20'].payloadPerFrame * 30);
  });

  it('does not stagger one code or a hold of 1, and gives up on a screen that is too small', () => {
    expect(planMultiCode({ ...base, enabled: true, prefer: 'single' })).toMatchObject({ staggered: false });
    expect(planMultiCode({ ...base, enabled: true, targetFps: 60 })).toMatchObject({ hold: 1, staggered: false });
    expect(planMultiCode({ ...base, enabled: true, screen: { width: 390, height: 844 } })).toBeNull();
  });
});
