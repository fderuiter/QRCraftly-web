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

import type { ColorStop, QRConfig } from '@/packages/core/types';

/** How QRCanvas reacts to a change in a given QRConfig property. */
export type QrConfigDependencyRole = 'encode' | 'animation' | 'paint';

/**
 * Exhaustive classification of every QRConfig field for QRCanvas:
 * - 'encode': matrix calculation inputs read by buildMatrix (value, type, errorCorrectionLevel).
 * - 'animation': animated playback loop inputs consumed by useQrAnimation.
 * - 'paint': visual rendering inputs read by qr-matrix and qr-export canvas renderers.
 *
 * Adding a new field to QRConfig requires classifying it here so QRCanvas cannot miss repaints.
 */
export const QR_CONFIG_DEPENDENCIES = {
  // Matrix encoding inputs (MatrixSource in buildMatrix.ts)
  value: 'encode',
  type: 'encode',
  errorCorrectionLevel: 'encode',

  // Animation loop inputs (QrAnimationOptions in useQrAnimation.ts)
  animationValues: 'animation',
  isAnimating: 'animation',
  animationFps: 'animation',

  // Core colors & module pattern
  fgColor: 'paint',
  bgColor: 'paint',
  style: 'paint',

  // Center logo & cutout padding
  logoUrl: 'paint',
  logoSize: 'paint',
  logoPaddingStyle: 'paint',
  logoPadding: 'paint',
  logoBackgroundColor: 'paint',

  // Finder pattern colors & shapes
  eyeColor: 'paint',
  eyeFrameColor: 'paint',
  eyeBallColor: 'paint',
  eyeFrameShape: 'paint',
  eyeBallShape: 'paint',

  // Decorative border
  isBorderEnabled: 'paint',
  borderSize: 'paint',
  borderColor: 'paint',
  borderStyle: 'paint',
  borderText: 'paint',
  borderTextPosition: 'paint',
  borderTextColor: 'paint',
  borderLogoUrl: 'paint',
  borderLogoPosition: 'paint',

  // Social format & template layout
  socialFormat: 'paint',
  templateStyle: 'paint',
  templateHeadline: 'paint',
  templateSubtext: 'paint',
  templateBgColor: 'paint',
  templateTextColor: 'paint',
  templateQrScale: 'paint',

  // Maze overlay
  isMazeEnabled: 'paint',
  isMazeBridgesEnabled: 'paint',
  mazeColor: 'paint',
  mazePathWidth: 'paint',
  showMazeSolution: 'paint',

  // Background image & batched luminance masking
  backgroundImageUrl: 'paint',
  isLuminanceMaskingEnabled: 'paint',
  fgColorDark: 'paint',
  fgColorLight: 'paint',
  luminanceThreshold: 'paint',

  // Mosaic QR
  mosaicImageUrl: 'paint',
  mosaicMode: 'paint',
  mosaicContrast: 'paint',

  // Outer CTA frame badge
  frameStyle: 'paint',
  frameText: 'paint',
  frameTextColor: 'paint',
  frameBgColor: 'paint',
  framePosition: 'paint',
  frameIcon: 'paint',
  frameFontFamily: 'paint',

  // Module gradient fill
  gradientType: 'paint',
  gradientColorStops: 'paint',
  gradientAngle: 'paint',

  // Quiet zone geometry
  quietZoneModules: 'paint',
} as const satisfies Record<keyof QRConfig, QrConfigDependencyRole>;

/** Union of all QRConfig keys whose changes require an immediate canvas repaint. */
export type PaintConfigKey = {
  [K in keyof QRConfig]-?: (typeof QR_CONFIG_DEPENDENCIES)[K] extends 'paint' ? K : never;
}[keyof QRConfig];

/**
 * Compile-time guard: every 'paint' key other than gradientColorStops must hold a scalar value
 * so Object.is comparison in hasPaintConfigChanged is exact without deep traversal.
 */
type NonScalarPaintKey = {
  [K in Exclude<PaintConfigKey, 'gradientColorStops'>]-?: QRConfig[K] extends
    | string
    | number
    | boolean
    | null
    | undefined
    ? never
    : K;
}[Exclude<PaintConfigKey, 'gradientColorStops'>];

const _assertAllOtherPaintKeysAreScalar: NonScalarPaintKey extends never ? true : false = true;
void _assertAllOtherPaintKeysAreScalar;

function isPaintConfigKey(key: string): key is PaintConfigKey {
  return (
    Object.hasOwn(QR_CONFIG_DEPENDENCIES, key) &&
    Reflect.get(QR_CONFIG_DEPENDENCIES, key) === 'paint'
  );
}

/** Ordered list of all QRConfig keys classified as 'paint'. */
export const PAINT_CONFIG_KEYS: readonly PaintConfigKey[] =
  Object.keys(QR_CONFIG_DEPENDENCIES).filter(isPaintConfigKey);

/**
 * Compares two gradient stop lists by item offset and color.
 * @param prevStops - Previous gradient color stops.
 * @param nextStops - Next gradient color stops.
 * @returns True when both lists are absent or contain identical stops in order.
 */
function areColorStopsEqual(
  prevStops: readonly ColorStop[] | undefined,
  nextStops: readonly ColorStop[] | undefined,
): boolean {
  if (Object.is(prevStops, nextStops)) return true;
  if (!prevStops || !nextStops || prevStops.length !== nextStops.length) return false;
  for (let i = 0; i < prevStops.length; i++) {
    const prevStop = prevStops[i];
    const nextStop = nextStops[i];
    if (!prevStop || !nextStop) return false;
    if (!Object.is(prevStop.offset, nextStop.offset) || prevStop.color !== nextStop.color) {
      return false;
    }
  }
  return true;
}

/**
 * Reports whether any visual 'paint' field in QRConfig changed between two configurations.
 * Uses Object.is for scalar fields (avoiding copying large data: URLs) and item-wise comparison
 * for gradientColorStops.
 * @param prev - Previous QR configuration.
 * @param next - Next QR configuration.
 * @returns True when QRCanvas needs to repaint the existing module matrix.
 */
export function hasPaintConfigChanged(prev: QRConfig, next: QRConfig): boolean {
  if (Object.is(prev, next)) return false;

  for (const key of PAINT_CONFIG_KEYS) {
    if (key === 'gradientColorStops') {
      if (!areColorStopsEqual(prev.gradientColorStops, next.gradientColorStops)) {
        return true;
      }
      continue;
    }
    if (!Object.is(prev[key], next[key])) {
      return true;
    }
  }

  return false;
}
