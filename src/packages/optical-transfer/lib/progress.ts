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

import type { FountainTelemetry } from './fountain/reassembler';

/** How far a looping stream has got. */
export interface TransferProgress {
  /** Share of one pass shown so far, 0 to 100. */
  percent: number;
  /** Which loop through the frames is on screen, counted from 1. */
  loop: number;
}

/**
 * The progress and pass of a stream that loops over `total` frames.
 * @param shown - Frames shown so far, counting the current one.
 * @param total - Frames in one pass.
 * @returns The percent of the first pass (capped at 100) and the current pass.
 */
export function transferProgress(shown: number, total: number): TransferProgress {
  if (total <= 0) return { percent: 0, loop: 1 };
  return {
    percent: Math.min(100, Math.round((shown / total) * 100)),
    loop: Math.max(1, Math.floor((shown - 1) / total) + 1),
  };
}

/**
 * The receiver's telemetry once every block is decoded: full rank, 100 percent and no time left.
 * @param stats - The last telemetry, or null when none arrived.
 * @returns The finished telemetry, or null.
 */
export function fountainStatsFrom(stats: FountainTelemetry | null): FountainTelemetry | null {
  return stats ? { ...stats, rank: stats.k, resolved: stats.k, progress: 100, etaSeconds: 0 } : stats;
}
