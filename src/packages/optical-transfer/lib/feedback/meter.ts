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
 * The receiver's side of the webcam back channel (#1146): what it measured over its last camera
 * frames, for the feedback code it shows in a corner of its screen. Nothing here is stored or sent
 * anywhere but that code.
 */
import { MULTI_RATE_PROFILES, type MultiRateProfileName } from '../multicode/multirate';
import { TILE_LAYOUTS } from '../multicode/layout';
import { FLAG_BEACON, decodeFrame, type FeedbackLayer } from '../prism/frame';
import { SPEED_LADDER } from './controller';

/** Camera frames the receiver measures over. */
export const FEEDBACK_WINDOW_FRAMES = 30;

/** One code a camera frame read: its text and QR version. */
export interface ReadCode {
  text: string;
  version: number;
}

/** What the receiver tells the sender about its reading, besides progress and done. */
export interface ReadingMeasure {
  /** Share of the codes the receiver expected over the window that it read, 0 to 1. */
  frameSuccessRate: number;
  /** The densest profile whose tiles it read in the window, or "none". */
  densestLayer: FeedbackLayer;
}

/** The profile a dense tile of this QR version belongs to: each profile's layout has its own version. */
function layerOfVersion(version: number): { layer: MultiRateProfileName; tiles: number } | null {
  for (const name of SPEED_LADDER) {
    const layout = TILE_LAYOUTS[MULTI_RATE_PROFILES[name].layoutId];
    if (layout.version === version) return { layer: name, tiles: layout.tiles };
  }
  return null;
}

export interface FeedbackMeter {
  /**
   * Records one camera frame.
   * @param codes - Every code it read; an empty list is a frame that read nothing.
   */
  record(codes: readonly ReadCode[]): void;
  /** @returns The measure over the window: no frames read nothing. */
  measure(): ReadingMeasure;
  /** Forgets the window, for a new transfer. */
  reset(): void;
}

/**
 * Creates the meter. A camera frame scores the share of its layout's tiles it read, a frame that
 * read only a beacon scores 1 (a beacon is shown alone), and a frame that read no transfer code
 * scores 0. The densest layer is the fastest profile any frame in the window read a tile of.
 * @param windowFrames - Camera frames to measure over.
 * @returns The meter.
 */
export function createFeedbackMeter(windowFrames = FEEDBACK_WINDOW_FRAMES): FeedbackMeter {
  let frames: Array<{ score: number; rank: number }> = [];

  return {
    record(codes) {
      let dense = 0;
      let tiles = 1;
      let rank = 0;
      let beacon = false;
      for (const code of codes) {
        const decoded = decodeFrame(code.text);
        if (!decoded.ok || decoded.frame.type === 'feedback') continue;
        if ((decoded.frame.flags & FLAG_BEACON) !== 0) {
          beacon = true;
          continue;
        }
        const layer = layerOfVersion(code.version);
        if (!layer) continue;
        dense += 1;
        tiles = layer.tiles;
        rank = Math.max(rank, SPEED_LADDER.indexOf(layer.layer) + 1);
      }
      const score = dense > 0 ? Math.min(1, dense / tiles) : beacon ? 1 : 0;
      frames.push({ score, rank });
      if (frames.length > windowFrames) frames.shift();
    },
    measure() {
      if (frames.length === 0) return { frameSuccessRate: 0, densestLayer: 'none' };
      const rank = Math.max(...frames.map((frame) => frame.rank));
      return {
        frameSuccessRate: frames.reduce((sum, frame) => sum + frame.score, 0) / frames.length,
        densestLayer: rank === 0 ? 'none' : SPEED_LADDER[rank - 1],
      };
    },
    reset() {
      frames = [];
    },
  };
}
