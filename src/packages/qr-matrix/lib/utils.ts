/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import { QRConfig, QRErrorCorrectionLevel } from '@/types';

export interface LayoutMetrics {
  drawX: number;
  drawY: number;
  drawSize: number;
  cellSize: number;
  borderPx: number;
}

export interface LogoMetrics {
  logoSizePx: number;
  logoPaddingPx: number;
  cutoutModuleSize: number;
  effectiveLogoSizeModules: number;
  effectivePaddingModules: number;
}

export const calculateLayout = (
  config: QRConfig,
  displaySize: number,
  moduleCount: number
): LayoutMetrics => {
  let borderPx = 0;
  const quietZoneModules = 4;
  const minBorderPx = (quietZoneModules * displaySize) / (moduleCount + 2 * quietZoneModules);

  if (config.isBorderEnabled && config.borderSize > 0) {
    const rawBorderPx = displaySize * config.borderSize;
    borderPx = Math.max(rawBorderPx, minBorderPx);
  } else {
    borderPx = minBorderPx;
  }

  const hasFrame = config.frameStyle && config.frameStyle !== 'none';
  const frameMargin = hasFrame ? displaySize * 0.18 : 0;
  const position = config.framePosition || 'bottom';

  let availableWidth = displaySize;
  let availableHeight = displaySize;

  if (hasFrame) {
    if (position === 'bottom' || position === 'top') {
      availableHeight = displaySize - frameMargin;
    } else {
      availableWidth = displaySize - frameMargin;
    }
  }

  const drawSize = Math.min(availableWidth, availableHeight) - (borderPx * 2);
  const cellSize = drawSize / moduleCount;

  let drawX = borderPx;
  let drawY = borderPx;

  if (hasFrame) {
    if (position === 'bottom') {
      drawX = (displaySize - drawSize) / 2;
      drawY = borderPx;
    } else if (position === 'top') {
      drawX = (displaySize - drawSize) / 2;
      drawY = frameMargin + borderPx;
    } else if (position === 'left') {
      drawX = frameMargin + borderPx;
      drawY = (displaySize - drawSize) / 2;
    } else if (position === 'right') {
      drawX = borderPx;
      drawY = (displaySize - drawSize) / 2;
    }
  }

  return {
    drawX,
    drawY,
    drawSize,
    cellSize,
    borderPx
  };
};

export const getLogoMetrics = (
  config: QRConfig,
  moduleCount: number,
  cellSize: number
): LogoMetrics => {
  const safeAreaRatioMap: Record<QRErrorCorrectionLevel, number> = {
    [QRErrorCorrectionLevel.L]: 0.22,
    [QRErrorCorrectionLevel.M]: 0.35,
    [QRErrorCorrectionLevel.Q]: 0.42,
    [QRErrorCorrectionLevel.H]: 0.50,
  };

  const safeAreaRatio = safeAreaRatioMap[config.errorCorrectionLevel] ?? 0.50;
  const maxAllowedCutoutModules = moduleCount * safeAreaRatio;

  const requestedLogoSizeModules = moduleCount * config.logoSize;
  const requestedPaddingModules = config.logoPaddingStyle !== 'none' ? config.logoPadding : 0;
  const requestedTotalCutoutModules = requestedLogoSizeModules + (requestedPaddingModules * 2);

  let scaleFactor = 1;
  if (requestedTotalCutoutModules > maxAllowedCutoutModules) {
    scaleFactor = maxAllowedCutoutModules / requestedTotalCutoutModules;
  }

  const effectiveLogoSizeModules = requestedLogoSizeModules * scaleFactor;
  const effectivePaddingModules = requestedPaddingModules * scaleFactor;
  const cutoutModuleSize = effectiveLogoSizeModules + (effectivePaddingModules * 2);

  const logoSizePx = effectiveLogoSizeModules * cellSize;
  const logoPaddingPx = effectivePaddingModules * cellSize;

  return {
    logoSizePx,
    logoPaddingPx,
    cutoutModuleSize,
    effectiveLogoSizeModules,
    effectivePaddingModules,
  };
};

export const getIsCoveredByLogo = (
  config: QRConfig,
  moduleCount: number,
  logoMetrics: LogoMetrics
) => {
  if (!config.logoUrl) return () => false;

  const { cutoutModuleSize } = logoMetrics;
  const center = moduleCount / 2;
  const halfCutout = cutoutModuleSize / 2;

  return (r: number, c: number) => {
    const x = c - center + 0.5;
    const y = r - center + 0.5;

    if (config.logoPaddingStyle === 'circle') {
      const distSq = x * x + y * y;
      return distSq < halfCutout * halfCutout;
    }

    return Math.abs(x) < halfCutout && Math.abs(y) < halfCutout;
  };
};

export const iterateMatrix = (
  moduleCount: number,
  callback: (r: number, c: number) => void
) => {
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      callback(r, c);
    }
  }
};

export const ALIGNMENT_PATTERN_COORDINATES: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
  11: [6, 30, 54],
  12: [6, 32, 58],
  13: [6, 34, 62],
  14: [6, 26, 46, 66],
  15: [6, 26, 48, 70],
  16: [6, 26, 50, 74],
  17: [6, 30, 54, 78],
  18: [6, 30, 56, 82],
  19: [6, 30, 58, 86],
  20: [6, 34, 62, 90],
  21: [6, 28, 50, 72, 94],
  22: [6, 26, 50, 74, 98],
  23: [6, 30, 54, 78, 102],
  24: [6, 28, 54, 80, 106],
  25: [6, 32, 58, 84, 110],
  26: [6, 30, 58, 86, 114],
  27: [6, 34, 62, 90, 118],
  28: [6, 26, 50, 74, 98, 122],
  29: [6, 30, 54, 78, 102, 126],
  30: [6, 26, 52, 78, 104, 130],
  31: [6, 30, 56, 82, 108, 134],
  32: [6, 34, 60, 86, 112, 138],
  33: [6, 30, 58, 86, 114, 142],
  34: [6, 34, 62, 90, 118, 146],
  35: [6, 30, 54, 78, 102, 126, 150],
  36: [6, 24, 50, 76, 102, 128, 154],
  37: [6, 28, 54, 80, 106, 132, 158],
  38: [6, 32, 58, 84, 110, 136, 162],
  39: [6, 26, 54, 82, 110, 138, 166],
  40: [6, 30, 58, 86, 114, 142, 170],
};

export function getAlignmentPatternCenters(version: number): { r: number; c: number }[] {
  if (version < 2 || version > 40) return [];
  const coords = ALIGNMENT_PATTERN_COORDINATES[version] || [];
  const centers: { r: number; c: number }[] = [];
  const len = coords.length;

  for (let i = 0; i < len; i++) {
    for (let j = 0; j < len; j++) {
      const r = coords[i];
      const c = coords[j];

      // Exclude the 3 corners that contain finder patterns
      if (i === 0 && j === 0) continue; // Top-Left
      if (i === 0 && j === len - 1) continue; // Top-Right
      if (i === len - 1 && j === 0) continue; // Bottom-Left

      centers.push({ r, c });
    }
  }

  return centers;
}

export function isAlignmentPatternZone(r: number, c: number, size: number): boolean {
  const version = (size - 17) / 4;
  if (version < 2) return false;

  const centers = getAlignmentPatternCenters(version);
  for (const center of centers) {
    if (Math.abs(r - center.r) <= 3 && Math.abs(c - center.c) <= 3) {
      return true;
    }
  }

  return false;
}
