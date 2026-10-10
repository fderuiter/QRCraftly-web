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

import { type QRConfig, QRStyle, type QRModules } from '@/types';
import { drawRoundRect, drawRoughRect, drawPoly, drawStar, drawCircularModule, drawCircuitModule, drawStandardModule } from './canvasHelpers';
import { getIsCoveredByLogo, type LogoMetrics, iterateMatrix } from './utils';
import { getLuminance } from '@/utils/colorUtils';
import { renderFluidModules, isFinderPattern } from './fluid';

export interface ModuleRenderOptions {
  /** Optional pre-sampled cell background relative luminance array (length = moduleCount * moduleCount). */
  cellLuminance?: Float64Array | number[];
  /** Optional background ImageData to sample cell relative luminance from. */
  bgImageData?: { data: Uint8ClampedArray; width: number; height: number };
  /** Explicit foreground color for dark module group (over bright background cells). */
  fgColorDark?: string;
  /** Explicit foreground color for light module group (over dark background cells). */
  fgColorLight?: string;
  /** Relative luminance threshold separating bright and dark background cells (0..1). Default: 0.25. */
  luminanceThreshold?: number;
}

type DrawModuleFn = (r: number, c: number, x: number, y: number, cx: number, cy: number) => void;

/**
 * Calculates WCAG relative luminance for normalized sRGB components (0..1).
 */
function calculateComponentLuminance(r: number, g: number, b: number): number {
  const rLin = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const gLin = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const bLin = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * Samples relative luminance across each logical QR code matrix cell coordinate (r, c)
 * from provided background image pixel data.
 */
export function sampleCellLuminances(
  imageData: { data: Uint8ClampedArray; width: number; height: number },
  moduleCount: number,
  drawX: number,
  drawY: number,
  cellSize: number
): Float64Array {
  const cellLuminance = new Float64Array(moduleCount * moduleCount);
  const { data, width, height } = imageData;

  for (let r = 0; r < moduleCount; r++) {
    const y0 = Math.max(0, Math.floor(drawY + r * cellSize));
    const y1 = Math.min(height, Math.ceil(drawY + (r + 1) * cellSize));

    for (let c = 0; c < moduleCount; c++) {
      const x0 = Math.max(0, Math.floor(drawX + c * cellSize));
      const x1 = Math.min(width, Math.ceil(drawX + (c + 1) * cellSize));

      let totalLum = 0;
      let count = 0;

      const stepY = Math.max(1, Math.floor((y1 - y0) / 4));
      const stepX = Math.max(1, Math.floor((x1 - x0) / 4));

      for (let y = y0; y < y1; y += stepY) {
        for (let x = x0; x < x1; x += stepX) {
          const idx = (y * width + x) * 4;
          const alpha = data[idx + 3] / 255;

          const rNorm = (data[idx] * alpha + 255 * (1 - alpha)) / 255;
          const gNorm = (data[idx + 1] * alpha + 255 * (1 - alpha)) / 255;
          const bNorm = (data[idx + 2] * alpha + 255 * (1 - alpha)) / 255;

          totalLum += calculateComponentLuminance(rNorm, gNorm, bNorm);
          count++;
        }
      }

      const idx = r * moduleCount + c;
      cellLuminance[idx] = count > 0 ? totalLum / count : 1.0;
    }
  }

  return cellLuminance;
}

const getModuleDrawer = (
  style: QRStyle,
  ctx: CanvasRenderingContext2D,
  cellSize: number,
  modules: QRModules,
  moduleCount: number,
  isCoveredByLogo: (r: number, c: number) => boolean,
  isVirtual: boolean
): DrawModuleFn => {
  switch(style) {
    case QRStyle.MODERN: {
      const rModern = cellSize * 0.3;
      return (_r, _c, x, y, _cx, _cy) => drawRoundRect(ctx, x, y, cellSize, cellSize, rModern);
    }
    case QRStyle.SWISS: {
      return (_r, _c, _x, _y, cx, cy) => drawCircularModule(ctx, cx, cy, cellSize, 1.05);
    }
    case QRStyle.FLUID: {
      return (_r, _c, _x, _y, cx, cy) => drawCircularModule(ctx, cx, cy, cellSize, 1.1);
    }
    case QRStyle.CIRCUIT: {
      const validGrid = new Uint8Array(moduleCount * moduleCount);

      iterateMatrix(moduleCount, (r, c) => {
        if (modules.get(r, c) && !isCoveredByLogo(r, c)) {
          validGrid[r * moduleCount + c] = 1;
        }
      });

      return (r, c, x, y, cx, cy) => {
        const idx = r * moduleCount + c;
        const hasTop = r > 0 && validGrid[idx - moduleCount] === 1;
        const hasBottom = r < moduleCount-1 && validGrid[idx + moduleCount] === 1;
        const hasLeft = c > 0 && validGrid[idx - 1] === 1;
        const hasRight = c < moduleCount-1 && validGrid[idx + 1] === 1;

        drawCircuitModule(ctx, x, y, cx, cy, cellSize, hasTop, hasBottom, hasLeft, hasRight);
      };
    }
    case QRStyle.HIVE: {
      const rHive = cellSize / 1.55;
      return (_r, _c, _x, _y, cx, cy) => drawPoly(ctx, cx, cy, rHive, 6, 0, false, true);
    }
    case QRStyle.GRUNGE:
      return (_r, _c, x, y, _cx, _cy) => drawRoughRect(ctx, x, y, cellSize, cellSize, true);
    case QRStyle.STARBURST: {
      const outerR = cellSize / 1.5;
      const innerR = cellSize / 2.2;
      return (_r, _c, _x, _y, cx, cy) => drawStar(ctx, cx, cy, outerR, innerR, 5, false, true);
    }
    case QRStyle.STANDARD:
    default: {
      return (_r, _c, x, y, _cx, _cy) => drawStandardModule(ctx, x, y, cellSize, isVirtual);
    }
  }
};

let sharedFluidGrid: Uint8Array | null = null;
function getSharedFluidGrid(total: number): Uint8Array {
  if (!sharedFluidGrid || sharedFluidGrid.length < total) {
    sharedFluidGrid = new Uint8Array(total);
  } else {
    sharedFluidGrid.fill(0, 0, total);
  }
  return sharedFluidGrid;
}

/**
 * Builds a CanvasGradient or virtual SVG gradient over the QR code module grid bounding box
 * when config.gradientType is active ('linear' or 'radial').
 */
export function createModuleGradient(
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  drawX: number,
  drawY: number,
  drawSize: number
): CanvasGradient | null {
  const { gradientType, gradientColorStops, gradientAngle = 0 } = config;
  if (!gradientType || gradientType === 'none') {
    return null;
  }

  const stops = gradientColorStops && gradientColorStops.length > 0
    ? gradientColorStops
    : [{ offset: 0, color: config.fgColor }, { offset: 1, color: config.fgColor }];

  const cx = drawX + drawSize / 2;
  const cy = drawY + drawSize / 2;

  let gradient: CanvasGradient;

  if (gradientType === 'linear') {
    const rad = (gradientAngle * Math.PI) / 180;
    const half = drawSize / 2;
    const x0 = cx - half * Math.cos(rad);
    const y0 = cy - half * Math.sin(rad);
    const x1 = cx + half * Math.cos(rad);
    const y1 = cy + half * Math.sin(rad);

    gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  } else if (gradientType === 'radial') {
    const radius = (drawSize * Math.SQRT2) / 2;
    gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  } else {
    return null;
  }

  if (stops.length === 1) {
    gradient.addColorStop(0, stops[0].color);
    gradient.addColorStop(1, stops[0].color);
  } else {
    for (const stop of stops) {
      const offset = Math.max(0, Math.min(1, stop.offset));
      gradient.addColorStop(offset, stop.color);
    }
  }

  return gradient;
}

export const renderModules = (
  ctx: CanvasRenderingContext2D,
  modules: QRModules,
  config: QRConfig,
  drawX: number,
  drawY: number,
  cellSize: number,
  moduleCount: number,
  logoMetrics: LogoMetrics,
  isVirtual: boolean = false,
  options?: ModuleRenderOptions
) => {
  const isCoveredByLogo = getIsCoveredByLogo(config, moduleCount, logoMetrics);
  const drawModuleFn = getModuleDrawer(config.style, ctx, cellSize, modules, moduleCount, isCoveredByLogo, isVirtual);

  const cellSizeHalf = cellSize / 2;
  const xs = new Float64Array(moduleCount);
  const cxs = new Float64Array(moduleCount);
  for (let c = 0; c < moduleCount; c++) {
    xs[c] = drawX + c * cellSize;
    cxs[c] = xs[c] + cellSizeHalf;
  }

  const ys = new Float64Array(moduleCount);
  const cys = new Float64Array(moduleCount);
  for (let r = 0; r < moduleCount; r++) {
    ys[r] = drawY + r * cellSize;
    cys[r] = ys[r] + cellSizeHalf;
  }

  // 1. Resolve background luminance per cell
  let cellLuminance: Float64Array | number[] | null = options?.cellLuminance || null;
  if (!cellLuminance && options?.bgImageData) {
    cellLuminance = sampleCellLuminances(options.bgImageData, moduleCount, drawX, drawY, cellSize);
  } else if (!cellLuminance && (config.isLuminanceMaskingEnabled || config.backgroundImageUrl) && 'getImageData' in ctx && typeof ctx.getImageData === 'function') {
    try {
      const displaySize = Math.ceil(drawX + moduleCount * cellSize);
      const imgData = ctx.getImageData(0, 0, displaySize, displaySize);
      cellLuminance = sampleCellLuminances(imgData, moduleCount, drawX, drawY, cellSize);
    } catch {
      // Fallback if canvas is tainted or context does not support reading pixels
    }
  }

  const threshold = options?.luminanceThreshold ?? config.luminanceThreshold ?? 0.25;

  // 2. Select contrast-optimized foreground colors for dark and light contrast groups
  const drawSize = moduleCount * cellSize;
  const gradientFill = (!options?.fgColorDark && !config.fgColorDark && config.gradientType && config.gradientType !== 'none')
    ? createModuleGradient(ctx, config, drawX, drawY, drawSize)
    : null;

  let fgColorDark: string | CanvasGradient = gradientFill || options?.fgColorDark || config.fgColorDark || config.fgColor;
  let fgColorLight = options?.fgColorLight || config.fgColorLight || '#ffffff';

  if (!gradientFill && !options?.fgColorDark && !config.fgColorDark) {
    const defaultDarkLum = getLuminance(fgColorDark as string);
    if ((1.0 + 0.05) / (defaultDarkLum + 0.05) < 3.0) {
      fgColorDark = '#000000';
    }
  }

  if (!options?.fgColorLight && !config.fgColorLight) {
    const defaultLightLum = getLuminance(fgColorLight);
    if ((defaultLightLum + 0.05) / (0.0 + 0.05) < 3.0) {
      fgColorLight = '#ffffff';
    }
  }

  // 3. Partition modules into Group 0 (bright background cells -> dark fg) and Group 1 (dark background cells -> light fg)
  const total = moduleCount * moduleCount;
  const group0Rows = new Int16Array(total);
  const group0Cols = new Int16Array(total);
  let group0Count = 0;

  const group1Rows = new Int16Array(total);
  const group1Cols = new Int16Array(total);
  let group1Count = 0;

  // A transparent background is placed on light media, so it groups like white.
  const flatBgLum = config.bgColor && config.bgColor !== 'transparent' ? getLuminance(config.bgColor) : 1.0;

  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (modules.get(r, c)) {
        if (isCoveredByLogo(r, c)) continue;

        const idx = r * moduleCount + c;
        const bgLum = cellLuminance ? cellLuminance[idx] : flatBgLum;

        if (bgLum >= threshold) {
          group0Rows[group0Count] = r;
          group0Cols[group0Count] = c;
          group0Count++;
        } else {
          group1Rows[group1Count] = r;
          group1Cols[group1Count] = c;
          group1Count++;
        }
      }
    }
  }

  // 4. Two-Pass Batched Vector Path Execution
  if (config.style === QRStyle.FLUID) {
    if (group0Count > 0) {
      const grid0 = getSharedFluidGrid(total);
      for (let i = 0; i < group0Count; i++) {
        const r = group0Rows[i];
        const c = group0Cols[i];
        if (!isFinderPattern(r, c, moduleCount)) {
          grid0[r * moduleCount + c] = 1;
        }
      }
      ctx.fillStyle = fgColorDark;
      ctx.beginPath();
      renderFluidModules(ctx, grid0, drawX, drawY, cellSize, moduleCount);
      ctx.fill();
    }

    if (group1Count > 0) {
      const grid1 = getSharedFluidGrid(total);
      for (let i = 0; i < group1Count; i++) {
        const r = group1Rows[i];
        const c = group1Cols[i];
        if (!isFinderPattern(r, c, moduleCount)) {
          grid1[r * moduleCount + c] = 1;
        }
      }
      ctx.fillStyle = fgColorLight;
      ctx.beginPath();
      renderFluidModules(ctx, grid1, drawX, drawY, cellSize, moduleCount);
      ctx.fill();
    }
    return;
  }

  // Pass 0: High-luminance cell background group -> Dark module fill
  if (group0Count > 0) {
    ctx.fillStyle = fgColorDark;
    ctx.beginPath();
    for (let i = 0; i < group0Count; i++) {
      const r = group0Rows[i];
      const c = group0Cols[i];
      drawModuleFn(r, c, xs[c], ys[r], cxs[c], cys[r]);
    }
    ctx.fill();
  }

  // Pass 1: Low-luminance cell background group -> Light module fill
  if (group1Count > 0) {
    ctx.fillStyle = fgColorLight;
    ctx.beginPath();
    for (let i = 0; i < group1Count; i++) {
      const r = group1Rows[i];
      const c = group1Cols[i];
      drawModuleFn(r, c, xs[c], ys[r], cxs[c], cys[r]);
    }
    ctx.fill();
  }
};
