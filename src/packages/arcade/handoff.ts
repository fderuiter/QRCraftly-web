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

import type { QRStyle } from '@/packages/core/types';
import type { EccLevel } from './lib/matrix';

/**
 * The generator design the arcade stress-tests. Colours are hex strings; the payload is the
 * exact text the generator encodes.
 */
export interface ArcadeTarget {
  /** Encoded text. */
  payload: string;
  /** Error correction tier. */
  ecc: EccLevel;
  /** Module colour. */
  fgColor: string;
  /** Background colour. */
  bgColor: string;
  /** Finder pattern colour. */
  eyeColor: string;
  /** Playable maze overlay toggle. */
  isMazeEnabled?: boolean;
  /** Finder pattern bridges toggle. */
  isMazeBridgesEnabled?: boolean;
  /** Maze path width multiplier. */
  mazePathWidth?: number;
  /** Maze path color hex string. */
  mazeColor?: string;
  /** Show solved maze path toggle. */
  showMazeSolution?: boolean;
  /** QR style. */
  style?: QRStyle;
}

/**
 * Volatile, module-level handoff from the generator to the arcade. The generator's QR store
 * is scoped to its route, so "Stress Test in Arcade" stages the design here right before a
 * client-side navigation. It lives only in this tab's memory: it is never written to
 * storage, never sent over the network and never placed in the URL, and a reload clears it.
 */
let staged: ArcadeTarget | null = null;

/**
 * Stages the generator design for the arcade.
 * @param target - The design.
 */
export function stageArcadeTarget(target: ArcadeTarget): void {
  staged = { ...target };
}

/**
 * Reads the staged generator design without clearing it, so "Reset to Generator QR" can
 * restore it again later.
 * @returns A copy of the staged design, or null when nothing was staged in this tab.
 */
export function getStagedArcadeTarget(): ArcadeTarget | null {
  return staged ? { ...staged } : null;
}

/** Forgets the staged design. */
export function clearStagedArcadeTarget(): void {
  staged = null;
}
