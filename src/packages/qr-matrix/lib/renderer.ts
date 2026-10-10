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

import type { QRConfig, QRModules } from '@/types';
import { calculateLayout, getLogoMetrics, getIsCoveredByLogo } from './utils';
import { renderBorder, renderBorderDecoration } from './border';
import { renderModules, type ModuleRenderOptions } from './modules';
import { renderEyes } from './eyes';
import { renderLogo } from './logo';
import { renderMaze, type MazeData } from './maze';
import { planMosaic, renderMosaic, DEFAULT_MOSAIC_OPTIONS } from './mosaic';
import { getMosaicSource } from './mosaicSource';
import { renderFrame } from './frame';

/**
 * Renders the QR code onto the canvas.
 * This function handles module generation, styling, and logo embedding.
 */
export const drawQR = (
  ctx: CanvasRenderingContext2D,
  modules: QRModules,
  config: QRConfig,
  logoImg: HTMLImageElement | null,
  borderLogoImg: HTMLImageElement | null,
  size: number,
  mazeData?: MazeData | null,
  options?: ModuleRenderOptions
) => {
  const canvas = ctx.canvas;

  // Setup scaling
  const pixelRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const displaySize = size;
  const rawSize = displaySize * pixelRatio;

  // Set the actual resolution of the canvas
  canvas.width = rawSize;
  canvas.height = rawSize;

  // Clear canvas initially
  ctx.clearRect(0, 0, rawSize, rawSize);

  try {
    const moduleCount = modules.size;

    ctx.scale(pixelRatio, pixelRatio);

    drawQRInternal(
      ctx as unknown as CanvasRenderingContext2D,
      modules,
      config,
      logoImg,
      borderLogoImg,
      displaySize,
      moduleCount,
      false,
      mazeData,
      options
    );

  } catch (err) {
    console.warn("QR generation failed:", err);
  }
};

/**
 * Core rendering logic shared between the canvas and SVG export paths.
 * Works in logical display-pixel coordinates (no HiDPI scaling applied).
 *
 * @param ctx   Any context that satisfies the canvas 2D drawing API subset used here.
 * @param modules  The raw QR module data.
 * @param config   The QR configuration.
 * @param logoImg  Pre-loaded logo image (or null).
 * @param borderLogoImg Pre-loaded border-logo image (or null).
 * @param displaySize  The logical size in pixels to draw into.
 * @param moduleCount  Number of modules (rows/cols) in the QR grid.
 * @param isVirtual Whether rendering in virtual/offscreen mode.
 * @param mazeData Optional pre-computed maze overlay data.
 * @param options Optional module rendering options.
 */
export const drawQRInternal = (
  ctx: CanvasRenderingContext2D,
  modules: QRModules,
  config: QRConfig,
  logoImg: HTMLImageElement | null,
  borderLogoImg: HTMLImageElement | null,
  displaySize: number,
  moduleCount: number,
  isVirtual: boolean = false,
  mazeData?: MazeData | null,
  options?: ModuleRenderOptions
) => {
  const canFill = ctx && typeof ctx.fillRect === 'function';
  if (!canFill) {
    return;
  }

  // Modules are cut out for the logo only when there is a logo image to draw there, so a
  // logo that failed to load never leaves an empty hole in the code (#1257).
  if (config.logoUrl && !logoImg) {
    config = { ...config, logoUrl: null };
  }

  // 1. Calculate Layout
  const layout = calculateLayout(config, displaySize, moduleCount);
  const { drawX, drawY, drawSize, cellSize, borderPx, quietPx } = layout;

  // 2. Calculate Logo Metrics
  const logoMetrics = getLogoMetrics(config, moduleCount, cellSize);

  // 3. Render Backgrounds, Frame & Border, back to front, so the full-canvas
  // background never paints over the frame or CTA badge.
  const isBackgroundFilled = config.bgColor !== 'transparent' && !config.isLuminanceMaskingEnabled;
  if (isBackgroundFilled) {
    ctx.fillStyle = config.bgColor;
    ctx.fillRect(0, 0, displaySize, displaySize);
  }

  renderFrame(ctx, config, displaySize, layout);

  // The border surrounds the QR box only, which is the whole canvas when there is no frame.
  const hasBorder = config.isBorderEnabled && config.borderSize > 0;
  const boxX = drawX - quietPx - borderPx;
  const boxY = drawY - quietPx - borderPx;
  const boxSize = drawSize + (quietPx + borderPx) * 2;
  if (hasBorder) {
    ctx.save();
    ctx.translate(boxX, boxY);
    renderBorder(ctx, config, boxSize, borderPx);
    ctx.restore();
    // Fill the background over the quiet zone and the modules, inside the border band
    if (isBackgroundFilled) {
      ctx.fillStyle = config.bgColor;
      ctx.fillRect(drawX - quietPx, drawY - quietPx, drawSize + quietPx * 2, drawSize + quietPx * 2);
    }
  }

  // 4. Render Modules (or the Mosaic QR tiles, which include the finder patterns)
  const mosaicSource = getMosaicSource(config.mosaicImageUrl);
  if (mosaicSource) {
    const plan = planMosaic(modules, mosaicSource, {
      mode: config.mosaicMode ?? DEFAULT_MOSAIC_OPTIONS.mode,
      contrast: config.mosaicContrast ?? DEFAULT_MOSAIC_OPTIONS.contrast,
    });
    renderMosaic(ctx, plan, drawX, drawY, cellSize, getIsCoveredByLogo(config, moduleCount, logoMetrics));
  } else {
    renderModules(ctx, modules, config, drawX, drawY, cellSize, moduleCount, logoMetrics, isVirtual, options);
  }

  // 4b. Render Maze (if enabled)
  renderMaze(ctx, modules, config, drawX, drawY, cellSize, moduleCount, mazeData);

  // 5. Render Eyes
  if (!mosaicSource) {
    renderEyes(ctx, config, drawX, drawY, cellSize, moduleCount, options);
  }

  // 6. Render Center Logo
  renderLogo(ctx, config, logoImg, displaySize, logoMetrics);

  // 7. Render Border Decorations
  if (hasBorder) {
    ctx.save();
    ctx.translate(boxX, boxY);
    renderBorderDecoration(ctx, config, boxSize, borderPx, borderLogoImg);
    ctx.restore();
  }
};
