/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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


import { QRStyle, type QRConfig } from '@/packages/core/types';

/**
 * List of available QR code pattern styles with display labels.
 * Used for the style selection UI.
 */
export const PATTERNS = [
  { id: QRStyle.STANDARD, label: 'Standard Industrial' },
  { id: QRStyle.MODERN, label: 'Modern Soft' },
  { id: QRStyle.SWISS, label: 'Swiss Dot' },
  { id: QRStyle.FLUID, label: 'Fluid Ink' },
  { id: QRStyle.CIRCUIT, label: 'Cyber Circuit' },
  { id: QRStyle.HIVE, label: 'The Hive' },
  { id: QRStyle.GRUNGE, label: 'Grunge' },
  { id: QRStyle.STARBURST, label: 'Starburst' },
];

import colorsData from './colors.json' with { type: 'json' };

/**
 * List of preset color themes.
 * Each preset defines background, foreground, and eye colors.
 */
export const PRESET_COLORS = colorsData.presets;

export const DEFAULT_GRADIENT_END_COLOR = '#3b82f6';

/**
 * Builds a patch object for applying a color preset, keeping gradient stops synchronized.
 * @param preset - Foreground, background, and eye colors from a preset theme.
 * @param config - Current configuration to preserve existing end gradient color.
 * @returns Partial QRConfig updates for the preset colors and synchronized gradient stops.
 */
export function buildPresetColorPatch(
  preset: { fg: string; bg: string; eye: string },
  config?: Partial<QRConfig>
): Partial<QRConfig> {
  const currentStops = config?.gradientColorStops;
  // The end colour is the last stop, also for an imported gradient with more than two.
  const stop1 = currentStops?.[currentStops.length - 1]?.color ?? DEFAULT_GRADIENT_END_COLOR;
  return {
    fgColor: preset.fg,
    bgColor: preset.bg,
    eyeColor: preset.eye,
    eyeFrameColor: preset.eye,
    eyeBallColor: preset.eye,
    gradientColorStops: [
      { offset: 0, color: preset.fg },
      { offset: 1, color: stop1 },
    ],
  };
}

/**
 * The minimum WCAG AA color contrast threshold for readability and accessibility.
 */
export const MIN_CONTRAST_THRESHOLD = 4.5;

