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

import { QRConfig } from '@/types';

/**
 * Draws the background and pattern (such as dashed or dotted) of the outer border.
 *
 * @param ctx - The canvas 2D rendering context.
 * @param config - The QR configuration object specifying border style and colors.
 * @param displaySize - The size of the bordered QR box (the whole canvas unless a frame is drawn).
 * @param borderPx - The thickness of the border in pixels.
 */
export const renderBorder = (
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  displaySize: number,
  borderPx: number
) => {
  // Draw Border Background
  ctx.fillStyle = config.borderColor;
  ctx.fillRect(0, 0, displaySize, displaySize);

  // Draw Patterns based on style
  if (config.borderStyle === 'dashed' || config.borderStyle === 'dotted') {
    ctx.strokeStyle = config.bgColor; // Use background color for contrast
    ctx.lineWidth = borderPx * 0.2;
    if (config.borderStyle === 'dashed') {
      ctx.setLineDash([borderPx * 0.5, borderPx * 0.5]);
    } else {
      ctx.setLineDash([borderPx * 0.2, borderPx * 0.2]); // Dotted
    }
    ctx.strokeRect(borderPx * 0.5, borderPx * 0.5, displaySize - borderPx, displaySize - borderPx);
    ctx.setLineDash([]); // Reset
  } else if (config.borderStyle === 'double') {
    ctx.strokeStyle = config.bgColor;
    ctx.lineWidth = borderPx * 0.15;
    const offset = borderPx * 0.3;
    ctx.strokeRect(offset, offset, displaySize - offset * 2, displaySize - offset * 2);
  }
};

export const renderBorderDecoration = (
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  displaySize: number,
  borderPx: number,
  borderLogoImg: HTMLImageElement | null
) => {
  if (config.borderText) {
    ctx.fillStyle = config.borderTextColor;
    const fontSize = borderPx * 0.4;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const tx = displaySize / 2;
    let ty = borderPx / 2;

    if (config.borderTextPosition === 'bottom-center') {
      ty = displaySize - (borderPx / 2);
    } else if (config.borderTextPosition === 'top-center') {
      ty = borderPx / 2;
    }
    ctx.fillText(config.borderText, tx, ty);
  }

  if (config.borderLogoUrl && borderLogoImg) {
    const blSize = borderPx * 0.8;
    let blx = (displaySize - blSize) / 2;
    let bly = displaySize - borderPx + (borderPx - blSize) / 2;

    if (config.borderLogoPosition === 'bottom-center') {
      blx = (displaySize - blSize) / 2;
      bly = displaySize - borderPx + (borderPx - blSize) / 2;
    } else if (config.borderLogoPosition === 'bottom-right') {
      blx = displaySize - borderPx - blSize;
      bly = displaySize - borderPx + (borderPx - blSize) / 2;
    }
    ctx.drawImage(borderLogoImg, blx, bly, blSize, blSize);
  }
};

