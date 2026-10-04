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

import { QRErrorCorrectionLevel } from '../types';

/** Smallest module a print head and a phone camera handle reliably, in millimetres. */
export const MIN_MODULE_MM = 0.4;
/** The printed square counts the quiet zone: four modules on each side. */
const QUIET_ZONE_MODULES = 8;
/** The rule of thumb: a code scans from about ten times its width. */
const DISTANCE_RULE = 10;
/** Module count of a version 4 code, where the rule of thumb holds as stated. */
const REFERENCE_MODULES = 33;
/** Higher error correction forgives a little more distance. */
const ERROR_LEVEL_FACTOR: Record<QRErrorCorrectionLevel, number> = {
  [QRErrorCorrectionLevel.L]: 0.9,
  [QRErrorCorrectionLevel.M]: 1,
  [QRErrorCorrectionLevel.Q]: 1.05,
  [QRErrorCorrectionLevel.H]: 1.1,
};

/** What the print size means for a code. */
export interface PrintGuidance {
  /** Width of one module when printed, in millimetres. */
  moduleMm: number;
  /** Estimated distance a phone scans it from, in centimetres. */
  distanceCm: number;
  /** True when modules print smaller than {@link MIN_MODULE_MM}. */
  tooSmall: boolean;
  /** Smallest printed width that keeps modules at {@link MIN_MODULE_MM}, in centimetres. */
  minWidthCm: number;
}

/**
 * Width of one module when the code is printed at a given size.
 * @param widthCm - Printed width of the whole code, quiet zone included, in centimetres.
 * @param moduleCount - Modules per side of the QR matrix.
 * @returns Module width in millimetres.
 */
export function moduleSizeMm(widthCm: number, moduleCount: number): number {
  return (widthCm * 10) / (Math.max(1, moduleCount) + QUIET_ZONE_MODULES);
}

/**
 * Estimates how far away a phone can scan a printed code and whether it is printed too small.
 * It starts from about ten times the width and adjusts for the module count (a denser code needs
 * a nearer phone) and the error correction level. It is an estimate for planning, not a promise;
 * the viewing test on the same page decodes the real code under stress.
 * @param widthCm - Printed width in centimetres.
 * @param moduleCount - Modules per side of the QR matrix.
 * @param errorLevel - Error correction level of the code.
 * @returns Module size, scan distance and the minimum size.
 */
export function getPrintGuidance(widthCm: number, moduleCount: number, errorLevel: QRErrorCorrectionLevel): PrintGuidance {
  const density = Math.min(1.2, Math.max(0.5, Math.sqrt(REFERENCE_MODULES / Math.max(1, moduleCount))));
  const moduleMm = moduleSizeMm(widthCm, moduleCount);
  return {
    moduleMm,
    distanceCm: widthCm * DISTANCE_RULE * density * ERROR_LEVEL_FACTOR[errorLevel],
    tooSmall: moduleMm < MIN_MODULE_MM,
    minWidthCm: (MIN_MODULE_MM * (Math.max(1, moduleCount) + QUIET_ZONE_MODULES)) / 10,
  };
}

/**
 * Formats a distance for people: centimetres below a metre, metres above.
 * @param cm - Distance in centimetres.
 * @returns For example "45 cm" or "2.4 m".
 */
export function formatDistance(cm: number): string {
  if (cm < 100) return `${Math.round(cm)} cm`;
  return `${(cm / 100).toFixed(1)} m`;
}
