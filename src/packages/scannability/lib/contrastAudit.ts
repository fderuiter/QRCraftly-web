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

export interface LowContrastCell {
  row: number;
  col: number;
  contrast: number;
}

export interface ModuleContrastAuditResult {
  violations: number;
  minContrast: number;
  lowContrastCells: LowContrastCell[];
}

import { getLuminanceFromRgb } from '@/packages/core/encoding';


/**
 * Audits a rendered QR canvas image for localized relative luminance drops
 * across each matrix module coordinate.
 *
 * @param imageData - Raw canvas pixel data (Uint8ClampedArray) with width and height.
 * @param moduleCount - The physical QR matrix size (number of modules per side).
 * @param margin - Optional explicit quiet zone margin in modules.
 * @returns Result object containing violation counts, min local contrast, and flagged cell coordinates.
 */
export function auditModuleContrast(
  imageData: { data: Uint8ClampedArray; width: number; height: number },
  moduleCount?: number,
  margin?: number
): ModuleContrastAuditResult {
  if (!moduleCount || moduleCount <= 0 || !imageData || !imageData.data || imageData.width <= 0 || imageData.height <= 0) {
    return { violations: 0, minContrast: 21, lowContrastCells: [] };
  }

  const { data, width, height } = imageData;

  // Calculate layout bounds: determine if quiet zones exist or if a specific margin was provided
  let drawX = 0;
  let drawY = 0;
  let drawWidth = width;
  let drawHeight = height;

  if (margin !== undefined && margin >= 0) {
    const minDim = Math.min(width, height);
    const borderPx = (margin * minDim) / (moduleCount + 2 * margin);
    drawX = (width - (minDim - 2 * borderPx)) / 2;
    drawY = (height - (minDim - 2 * borderPx)) / 2;
    drawWidth = minDim - 2 * borderPx;
    drawHeight = drawWidth;
  } else if (margin === undefined && width > moduleCount) {
    const isTightMatrix = width % moduleCount === 0 && width % (moduleCount + 8) !== 0;
    if (!isTightMatrix) {
      // Default 4-module quiet zone floor used by calculateLayout in standard rendering
      const borderPx = (4 * Math.min(width, height)) / (moduleCount + 8);
      drawX = (width - (Math.min(width, height) - 2 * borderPx)) / 2;
      drawY = (height - (Math.min(width, height) - 2 * borderPx)) / 2;
      drawWidth = Math.min(width, height) - 2 * borderPx;
      drawHeight = drawWidth;
    }
  }

  const cellWidth = drawWidth / moduleCount;
  const cellHeight = drawHeight / moduleCount;

  const cellLuminance = new Float64Array(moduleCount * moduleCount);
  const cellMinLum = new Float64Array(moduleCount * moduleCount);
  const cellMaxLum = new Float64Array(moduleCount * moduleCount);

  // 1. Calculate relative luminance per module cell
  for (let r = 0; r < moduleCount; r++) {
    const y0 = Math.floor(drawY + r * cellHeight);
    const y1 = Math.min(height, Math.floor(drawY + (r + 1) * cellHeight));

    for (let c = 0; c < moduleCount; c++) {
      const x0 = Math.floor(drawX + c * cellWidth);
      const x1 = Math.min(width, Math.floor(drawX + (c + 1) * cellWidth));

      let totalLum = 0;
      let count = 0;
      let minLum = 1.0;
      let maxLum = 0.0;

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * width + x) * 4;
          const alpha = data[idx + 3] / 255;

          const rNorm = (data[idx] * alpha + 255 * (1 - alpha)) / 255;
          const gNorm = (data[idx + 1] * alpha + 255 * (1 - alpha)) / 255;
          const bNorm = (data[idx + 2] * alpha + 255 * (1 - alpha)) / 255;

          const lum = getLuminanceFromRgb(rNorm, gNorm, bNorm);
          totalLum += lum;
          count++;

          if (lum < minLum) minLum = lum;
          if (lum > maxLum) maxLum = lum;
        }
      }

      const idx = r * moduleCount + c;
      if (count > 0) {
        cellLuminance[idx] = totalLum / count;
        cellMinLum[idx] = minLum;
        cellMaxLum[idx] = maxLum;
      } else {
        cellLuminance[idx] = 1.0;
        cellMinLum[idx] = 1.0;
        cellMaxLum[idx] = 1.0;
      }
    }
  }

  // 2. Identify global dark and light reference levels
  const sorted = Array.from(cellLuminance).sort((a, b) => a - b);
  const p10Idx = Math.floor(sorted.length * 0.1);
  const p90Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9));
  const refDark = sorted[p10Idx];
  const refLight = sorted[p90Idx];

  if (refLight - refDark < 0.01) {
    return { violations: 0, minContrast: 21, lowContrastCells: [] };
  }

  const midLum = (refDark + refLight) / 2;

  let violations = 0;
  let minContrast = 21;
  const lowContrastCells: LowContrastCell[] = [];

  // 3. Local contrast audit per cell coordinate
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      const idx = r * moduleCount + c;
      const cellLum = cellLuminance[idx];

      // Find local neighborhood max and min
      let nMax = cellLum;
      let nMin = cellLum;

      for (let dr = -1; dr <= 1; dr++) {
        const nr = r + dr;
        if (nr < 0 || nr >= moduleCount) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const nc = c + dc;
          if (nc < 0 || nc >= moduleCount) continue;
          const nLum = cellLuminance[nr * moduleCount + nc];
          if (nLum > nMax) nMax = nLum;
          if (nLum < nMin) nMin = nLum;
        }
      }

      let contrast: number;
      if (cellLum <= midLum) {
        // Intended dark module
        const targetLight = Math.max(nMax, refLight);
        contrast = (targetLight + 0.05) / (cellLum + 0.05);
      } else {
        // Intended light module / background
        const targetDark = Math.min(nMin, refDark);
        contrast = (cellLum + 0.05) / (targetDark + 0.05);
      }

      if (contrast < minContrast) {
        minContrast = contrast;
      }

      // Standard WCAG / scannability threshold for local contrast is < 3:1
      if (contrast < 3.0) {
        violations++;
        lowContrastCells.push({ row: r, col: c, contrast });
      }
    }
  }

  return {
    violations,
    minContrast,
    lowContrastCells,
  };
}

