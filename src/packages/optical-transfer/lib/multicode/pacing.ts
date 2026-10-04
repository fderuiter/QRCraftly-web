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
 * Vsync-locked frame pacing (#1142). The sender measures the display's refresh interval from
 * `requestAnimationFrame` timestamps and holds every frame for a whole number of refreshes, so a
 * frame never changes between two refreshes and a camera exposure is not asked to catch a frame
 * that was shown for 1.4 refreshes. A 60 Hz display with a hold of 1 shows 60 frames per second, a
 * hold of 2 shows 30.
 */

/** Refresh rates displays commonly run at; a measurement within 3% of one snaps to it. */
const COMMON_REFRESH_HZ: readonly number[] = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
const SNAP_TOLERANCE = 0.03;

/** Timestamps the meter needs before it reports an interval. */
export const DEFAULT_MEASURE_SAMPLES = 20;

/**
 * Median refresh interval from a run of `requestAnimationFrame` timestamps. The median shrugs off
 * a few late frames; deltas of about two or three intervals (frames the browser skipped) are
 * folded back to one interval before the median is taken.
 * @param timestamps - Callback timestamps in milliseconds, ascending.
 * @returns The interval in milliseconds, or null with fewer than 3 timestamps.
 */
export function measureRefreshInterval(timestamps: readonly number[]): number | null {
  if (timestamps.length < 3) return null;
  const deltas: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const delta = timestamps[i] - timestamps[i - 1];
    if (delta > 0) deltas.push(delta);
  }
  if (deltas.length < 2) return null;
  const sorted = [...deltas].sort((a, b) => a - b);
  // The smallest cluster is the true interval; larger deltas are whole multiples of it.
  const base = sorted[Math.floor(sorted.length / 4)];
  const folded = deltas.map((delta) => delta / Math.max(1, Math.round(delta / base))).sort((a, b) => a - b);
  return folded[Math.floor(folded.length / 2)];
}

/**
 * Snaps a measured rate to the nearest common refresh rate when it is within 3%.
 * @param intervalMs - Measured refresh interval.
 * @returns The refresh rate in hertz.
 */
export function refreshRateFromInterval(intervalMs: number): number {
  const hz = 1000 / intervalMs;
  const nearest = COMMON_REFRESH_HZ.reduce((best, candidate) => (Math.abs(candidate - hz) < Math.abs(best - hz) ? candidate : best));
  return Math.abs(nearest - hz) / nearest <= SNAP_TOLERANCE ? nearest : hz;
}

/**
 * Whole refreshes to hold each frame so the frame rate does not exceed the target.
 * @param refreshHz - The display's refresh rate.
 * @param targetFps - The frame rate a profile asks for.
 * @returns The hold, at least 1. A 144 Hz display asked for 60 fps holds 3 (48 fps), never 2 (72 fps).
 */
export function holdForTargetFps(refreshHz: number, targetFps: number): number {
  if (!(refreshHz > 0) || !(targetFps > 0)) return 1;
  // A small allowance keeps a 60.4 Hz measurement from doubling the hold for a 60 fps target.
  return Math.max(1, Math.ceil(refreshHz / targetFps - 0.05));
}

/**
 * The frame rate a hold gives.
 * @param refreshHz - The display's refresh rate.
 * @param hold - Whole refreshes per frame.
 * @returns Frames per second.
 */
export function effectiveFps(refreshHz: number, hold: number): number {
  return refreshHz / Math.max(1, hold);
}

/** What the pacer reports on every display refresh. */
export interface PacerTick {
  /** Display refresh number, counted from the first locked tick (0). Refreshes the browser skipped still count. */
  refresh: number;
  /** The `requestAnimationFrame` timestamp. */
  timestamp: number;
  /** Refreshes since the previous tick that no callback ran for (0 normally). */
  skipped: number;
  /** True when a new frame starts on this refresh: `refresh` is a whole multiple of the hold, or one was skipped past. */
  frameStart: boolean;
  /** Frames started so far, including this tick's. */
  frame: number;
}

/** The browser's frame clock, injected so a test can step it. */
export interface FrameClock {
  /** Schedules a callback for the next display refresh with its timestamp. */
  request(callback: (timestamp: number) => void): number;
  cancel(handle: number): void;
}

export interface VsyncPacerOptions {
  clock: FrameClock;
  /** Whole refreshes to hold each frame (default 1). */
  hold?: number;
  /** A known refresh interval in milliseconds; skips the measurement. */
  refreshIntervalMs?: number;
  /** Timestamps to measure from (default {@link DEFAULT_MEASURE_SAMPLES}). */
  measureSamples?: number;
  onTick: (tick: PacerTick) => void;
  /** Called once when the refresh rate is known. */
  onLocked?: (info: { intervalMs: number; refreshHz: number }) => void;
}

/** A running pacer. */
export interface VsyncPacer {
  stop(): void;
  /** Changes the hold from the next refresh on. */
  setHold(hold: number): void;
  /** The measured refresh rate, or null while measuring. */
  readonly refreshHz: number | null;
}

/**
 * Starts pacing. The pacer measures the refresh interval first (unless one is given), then calls
 * `onTick` on every refresh with a refresh count worked out from the timestamps, so a late callback
 * does not shift the frame boundaries off the display's refresh grid.
 * @param options - Frame clock, hold and callbacks.
 * @returns A handle to stop or retune it.
 */
export function createVsyncPacer(options: VsyncPacerOptions): VsyncPacer {
  const { clock, onTick } = options;
  let hold = Math.max(1, Math.floor(options.hold ?? 1));
  const wanted = Math.max(3, options.measureSamples ?? DEFAULT_MEASURE_SAMPLES);
  let intervalMs = options.refreshIntervalMs && options.refreshIntervalMs > 0 ? options.refreshIntervalMs : null;
  let refreshHz: number | null = intervalMs === null ? null : refreshRateFromInterval(intervalMs);
  const samples: number[] = [];
  let handle = 0;
  let stopped = false;
  let lastTimestamp = 0;
  let lastRefresh = -1;
  let frame = -1;
  let lastFrameStartRefresh = Number.NEGATIVE_INFINITY;

  const step = (timestamp: number): void => {
    if (stopped) return;
    handle = clock.request(step);
    if (intervalMs === null) {
      samples.push(timestamp);
      if (samples.length < wanted) return;
      const measured = measureRefreshInterval(samples);
      if (measured === null) {
        samples.shift();
        return;
      }
      // The interval stays as measured (59.94 Hz is not 60); only the reported rate snaps.
      intervalMs = measured;
      refreshHz = refreshRateFromInterval(measured);
    }
    if (lastRefresh < 0) options.onLocked?.({ intervalMs, refreshHz: refreshHz ?? 1000 / intervalMs });
    // Counting from the previous tick keeps a slightly wrong interval from drifting off the refresh grid.
    const passed = lastRefresh < 0 ? 1 : Math.max(1, Math.round((timestamp - lastTimestamp) / intervalMs));
    const refresh = lastRefresh < 0 ? 0 : lastRefresh + passed;
    const skipped = lastRefresh < 0 ? 0 : passed - 1;
    // A frame starts on every multiple of the hold; a skipped multiple starts it late rather than never.
    const due = Math.floor(refresh / hold) * hold;
    const frameStart = lastRefresh < 0 || due > lastFrameStartRefresh;
    if (frameStart) {
      lastFrameStartRefresh = due;
      frame += 1;
    }
    lastRefresh = refresh;
    lastTimestamp = timestamp;
    onTick({ refresh, timestamp, skipped, frameStart, frame });
  };

  handle = clock.request(step);
  return {
    stop() {
      stopped = true;
      clock.cancel(handle);
    },
    setHold(next) {
      hold = Math.max(1, Math.floor(next));
    },
    get refreshHz() {
      return refreshHz;
    },
  };
}
