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
 * What the receiver tells the person about the layer it is reading (#1143). The hint has a fixed
 * wording so it can be announced politely and tested.
 */

/** What the receiver saw over its last few camera frames. */
export interface LayerObservation {
  /** Camera frames in the window that read a dense tile. */
  denseFrames: number;
  /** Camera frames in the window that read a beacon. */
  beaconFrames: number;
  /** Whole seconds since the transfer last made progress. */
  secondsWithoutProgress: number;
}

/** Seconds without progress before the receiver suggests a lower speed. */
export const STALL_HINT_SECONDS = 5;

export const ROBUST_LAYER_HINT = 'Reading the robust layer only. Move closer or hold steady for full speed.';
export const STALL_HINT = 'No progress for 5 seconds. Ask the sender to choose a lower speed.';

/**
 * The hint to show, if any.
 * @param observation - The recent camera frames and the time since progress.
 * @returns A sentence, or null when nothing needs saying.
 */
export function layerHint(observation: LayerObservation): string | null {
  if (observation.secondsWithoutProgress >= STALL_HINT_SECONDS) return STALL_HINT;
  if (observation.beaconFrames > 0 && observation.denseFrames === 0) return ROBUST_LAYER_HINT;
  return null;
}
