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

import { performance } from 'node:perf_hooks';

/**
 * Times the receive side of the optical benches (#1198): each call to {@link FrameTimer.time} is one
 * captured frame read by the receiver. The times are wall clock in this process, so they compare
 * runs on one machine, not devices.
 */
export interface FrameTimer {
  /** Runs `read` and records how long it took. */
  time<T>(read: () => T): T;
  /** One line with the frame count, p50 and p95 in milliseconds. */
  summary(label: string): string;
}

export function createFrameTimer(): FrameTimer {
  const times: number[] = [];
  const at = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  return {
    time<T>(read: () => T): T {
      const start = performance.now();
      try {
        return read();
      } finally {
        times.push(performance.now() - start);
      }
    },
    summary(label: string): string {
      const sorted = times.slice().sort((a, b) => a - b);
      return `${label}: ${sorted.length} frames, p50 ${at(sorted, 0.5).toFixed(2)} ms, p95 ${at(sorted, 0.95).toFixed(2)} ms`;
    },
  };
}
