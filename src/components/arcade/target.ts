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

import { DEFAULT_CONFIG } from '@/constants';
import type { QRConfig } from '@/types';
import { resolveEncodedValue } from '@/packages/qr-matrix';
import type { ArcadeTarget } from '@/packages/arcade/handoff';

/**
 * Derives the arcade target from a generator configuration: the exact payload the generator
 * encodes (URLs normalised the same way) plus its error correction tier and colours.
 * @param config - Generator configuration.
 * @returns The arcade target.
 */
export function targetFromConfig(config: QRConfig): ArcadeTarget {
  const payload = resolveEncodedValue(config);
  return {
    payload,
    ecc: config.errorCorrectionLevel,
    fgColor: config.fgColor,
    bgColor: config.bgColor,
    eyeColor: config.eyeColor || config.fgColor,
    isMazeEnabled: config.isMazeEnabled,
    isMazeBridgesEnabled: config.isMazeBridgesEnabled,
    mazePathWidth: config.mazePathWidth,
    mazeColor: config.mazeColor,
    showMazeSolution: config.showMazeSolution,
    style: config.style,
  };
}

/** High-contrast target used when no generator design is available. */
export const DEFAULT_ARCADE_TARGET: ArcadeTarget = targetFromConfig({ ...DEFAULT_CONFIG });
