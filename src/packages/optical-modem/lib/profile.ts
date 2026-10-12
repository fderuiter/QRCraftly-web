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

import { constellationId } from './constellation';
import type { GridGeometry } from './layout';

/**
 * One way of using the frame format: a colour count, a grid size and an inner code. Profiles 2 to 4
 * are provisional. They are tuned on the channel simulator only (docs/OPTICAL_BENCHMARK.md) and are
 * to be revisited once the probe has measured real phones (ADR 0025).
 */
export interface ModemProfile {
  /** The number in the frame header, 2 to 14. 0 and 1 are the QR modes; 15 marks probe frames. */
  id: number;
  name: string;
  /** Constellation id. */
  constellation: number;
  cols: number;
  rows: number;
  /** Data bytes in each inner code block. */
  packetBytes: number;
  /** Check bytes in each inner code block. */
  parity: number;
}

/**
 * The provisional ladder, most robust first: bigger cells and fewer colours at the bottom, smaller
 * cells and more colours at the top.
 */
export const MODEM_PROFILES: readonly ModemProfile[] = [
  { id: 2, name: 'Steady', constellation: constellationId(4, 'oklab'), cols: 104, rows: 58, packetBytes: 80, parity: 80 },
  { id: 3, name: 'Fast', constellation: constellationId(8, 'oklab'), cols: 120, rows: 67, packetBytes: 96, parity: 64 },
  { id: 4, name: 'Rapid', constellation: constellationId(16, 'oklab'), cols: 160, rows: 90, packetBytes: 80, parity: 80 },
];

/** Every grid size a modem receiver searches for. */
export const MODEM_GEOMETRIES: readonly GridGeometry[] = MODEM_PROFILES.map(({ cols, rows }) => ({ cols, rows }));

/**
 * Profiles for high-resolution cameras (#1161): the whole frame of a 1080p or a 4K camera, rather
 * than the corner of it the ladder's profiles use. Cells are about 4 camera pixels when the screen
 * fills most of the picture, which the simulator reads in its typical handheld channel; the colour
 * count stays at 4 because 8 colours need about 5 pixels there (docs/OPTICAL_CEILING.md). They are
 * not on the ladder: they need a receiver that tracks the frame and a camera that delivers that
 * resolution, and nothing about them has been measured on a device.
 */
export const HIGH_RATE_PROFILES: readonly ModemProfile[] = [
  // 384 x 216 cells: a 1920 x 1080 screen at 5 pixels per cell, a 1080p camera at about 4.
  { id: 6, name: 'Wide', constellation: constellationId(4, 'oklab'), cols: 384, rows: 216, packetBytes: 160, parity: 64 },
  // 768 x 432 cells: a 3840 x 2160 screen at 5 pixels per cell (1080p at 2.5), a 4K camera at about 4.
  { id: 7, name: 'Ultra', constellation: constellationId(4, 'oklab'), cols: 768, rows: 432, packetBytes: 176, parity: 48 },
];
