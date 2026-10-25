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

import type { QRConfig } from '@/packages/core/types';
import type { LogoMetrics } from './utils';

export const renderLogo = (
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  logoImg: HTMLImageElement | null,
  displaySize: number,
  logoMetrics: LogoMetrics
) => {
  if (config.logoUrl && logoImg) {
    const { logoSizePx, logoPaddingPx } = logoMetrics;
    const lx = (displaySize - logoSizePx) / 2;
    const ly = (displaySize - logoSizePx) / 2;

    if (config.logoPaddingStyle !== 'none') {
      const bgColor = config.logoBackgroundColor || config.bgColor;
      drawLogoBackground(
        ctx,
        displaySize,
        logoSizePx,
        logoPaddingPx,
        config.logoPaddingStyle,
        bgColor
      );
    }

    ctx.drawImage(logoImg, lx, ly, logoSizePx, logoSizePx);
  }
};

/**
 * Draws a circular or rectangular logo background padding mask.
 * @param ctx The canvas context.
 * @param displaySize The full display size of the canvas.
 * @param logoSizePx The width/height of the logo.
 * @param logoPaddingPx The size of the padding around the logo.
 * @param paddingStyle The style of padding ('circle' or 'square').
 * @param backgroundColor The fill color.
 */
export const drawLogoBackground = (
  ctx: CanvasRenderingContext2D,
  displaySize: number,
  logoSizePx: number,
  logoPaddingPx: number,
  paddingStyle: 'circle' | 'square' | string,
  backgroundColor: string
) => {
  ctx.fillStyle = backgroundColor;
  if (paddingStyle === 'circle') {
    ctx.beginPath();
    const radius = (logoSizePx / 2) + logoPaddingPx;
    ctx.arc(displaySize / 2, displaySize / 2, radius, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const lx = (displaySize - logoSizePx) / 2;
    const ly = (displaySize - logoSizePx) / 2;
    ctx.fillRect(lx - logoPaddingPx, ly - logoPaddingPx, logoSizePx + (logoPaddingPx * 2), logoSizePx + (logoPaddingPx * 2));
  }
};
