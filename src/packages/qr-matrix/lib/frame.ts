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

import type { QRConfig, FramePosition, FrameIcon } from '@/types';
import type { LayoutMetrics } from './utils';
import { drawRoundRect } from './canvasHelpers';

/**
 * Standard vector path data for frame CTA badge icons (24x24 viewBox).
 */
const ICON_PATHS: Record<Exclude<FrameIcon, 'none'>, string> = {
  scan: 'M 3 7 L 3 5 C 3 3.9 3.9 3 5 3 L 7 3 M 17 3 L 19 3 C 20.1 3 21 3.9 21 5 L 21 7 M 21 17 L 21 19 C 21 20.1 20.1 21 19 21 L 17 21 M 7 21 L 5 21 C 3.9 21 3 20.1 3 19 L 3 17 M 7 12 L 17 12',
  camera: 'M 3 7 L 7 7 L 9 4 L 15 4 L 17 7 L 21 7 C 22.1 7 23 7.9 23 9 L 23 19 C 23 20.1 22.1 21 21 21 L 3 21 C 1.9 21 1 20.1 1 19 L 1 9 C 1 7.9 1.9 7 3 7 Z M 12 18 C 14.2 18 16 16.2 16 14 C 16 11.8 14.2 10 12 10 C 9.8 10 8 11.8 8 14 C 8 16.2 9.8 18 12 18 Z',
  star: 'M 12 2 L 15.09 8.26 L 22 9.27 L 17 14.14 L 18.18 21.02 L 12 17.77 L 5.82 21.02 L 7 14.14 L 2 9.27 L 8.91 8.26 Z',
  heart: 'M 12 21.23 L 4.22 13.45 C 2.1 11.33 2.1 7.89 4.22 5.77 C 6.34 3.65 9.78 3.65 11.9 5.77 L 12 5.87 L 12.1 5.77 C 14.22 3.65 17.66 3.65 19.78 5.77 C 21.9 7.89 21.9 11.33 19.78 13.45 Z',
  info: 'M 12 2 C 6.48 2 2 6.48 2 12 C 2 17.52 6.48 22 12 22 C 17.52 22 22 17.52 22 12 C 22 6.48 17.52 2 12 2 Z M 11 7 L 13 7 L 13 9 L 11 9 Z M 11 11 L 13 11 L 13 17 L 11 17 Z',
  phone: 'M 6.62 10.79 C 8.06 13.62 10.38 15.94 13.21 17.38 L 15.41 15.18 C 15.69 14.9 16.08 14.82 16.43 14.93 C 17.55 15.3 18.75 15.5 20 15.5 C 20.55 15.5 21 15.95 21 16.5 L 21 20 C 21 20.55 20.55 21 20 21 C 10.61 21 3 13.39 3 4 C 3 3.45 3.45 3 4 3 L 7.5 3 C 8.05 3 8.5 3.45 8.5 4 C 8.5 5.25 8.7 6.45 9.07 7.57 C 9.18 7.92 9.1 8.31 8.82 8.59 Z',
};

/**
 * Parses and draws vector path command string onto canvas context.
 * Compatible with standard CanvasRenderingContext2D and SvgContext.
 */
function drawPathData(ctx: CanvasRenderingContext2D, pathData: string): void {
  const tokens = pathData.trim().split(/[\s,]+/);
  ctx.beginPath();
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i];
    if (cmd === 'M' || cmd === 'm') {
      ctx.moveTo(parseFloat(tokens[i + 1]), parseFloat(tokens[i + 2]));
      i += 3;
    } else if (cmd === 'L' || cmd === 'l') {
      ctx.lineTo(parseFloat(tokens[i + 1]), parseFloat(tokens[i + 2]));
      i += 3;
    } else if (cmd === 'Q' || cmd === 'q') {
      ctx.quadraticCurveTo(
        parseFloat(tokens[i + 1]), parseFloat(tokens[i + 2]),
        parseFloat(tokens[i + 3]), parseFloat(tokens[i + 4])
      );
      i += 5;
    } else if (cmd === 'C' || cmd === 'c') {
      if (typeof ctx.bezierCurveTo === 'function') {
        ctx.bezierCurveTo(
          parseFloat(tokens[i + 1]), parseFloat(tokens[i + 2]),
          parseFloat(tokens[i + 3]), parseFloat(tokens[i + 4]),
          parseFloat(tokens[i + 5]), parseFloat(tokens[i + 6])
        );
      } else {
        ctx.quadraticCurveTo(
          parseFloat(tokens[i + 3]), parseFloat(tokens[i + 4]),
          parseFloat(tokens[i + 5]), parseFloat(tokens[i + 6])
        );
      }
      i += 7;
    } else if (cmd === 'Z' || cmd === 'z') {
      ctx.closePath();
      i += 1;
    } else {
      i += 1;
    }
  }
}

/**
 * Draws an icon inside the frame CTA badge.
 */
function drawIcon(
  ctx: CanvasRenderingContext2D,
  icon: FrameIcon,
  x: number,
  y: number,
  size: number,
  color: string
): void {
  if (!icon || icon === 'none') return;
  const pathData = ICON_PATHS[icon as Exclude<FrameIcon, 'none'>];
  if (!pathData) return;

  ctx.save();
  ctx.translate(x, y);
  const scale = size / 24;
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawPathData(ctx, pathData);

  if (icon === 'camera' || icon === 'info' || icon === 'star' || icon === 'heart' || icon === 'phone') {
    ctx.stroke();
  } else {
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Renders outer frame shape and CTA badge around the QR matrix.
 * Keeps the matrix safe area and quiet zone intact.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  displaySize: number,
  layout: LayoutMetrics
): void {
  const style = config.frameStyle;
  if (!style || style === 'none') return;

  const text = config.frameText?.trim() || '';
  const bgColor = config.frameBgColor || '#000000';
  const textColor = config.frameTextColor || '#ffffff';
  const position: FramePosition = config.framePosition || 'bottom';
  const icon: FrameIcon = config.frameIcon || 'none';

  ctx.save();

  // Draw Card Frame outer background if style is 'card'
  if (style === 'card') {
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    drawRoundRect(ctx, 0, 0, displaySize, displaySize, displaySize * 0.04);
    ctx.fill();

    // Inner QR container: a transparent background would let the card colour show through the code.
    ctx.fillStyle = !config.bgColor || config.bgColor === 'transparent' ? '#ffffff' : config.bgColor;
    ctx.beginPath();
    const insetPx = layout.quietPx + layout.borderPx;
    const qrBoxX = Math.max(0, layout.drawX - insetPx);
    const qrBoxY = Math.max(0, layout.drawY - insetPx);
    const qrBoxSize = layout.drawSize + (insetPx * 2);
    drawRoundRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, displaySize * 0.03);
    ctx.fill();
  }

  // Calculate Badge Geometry
  const frameMargin = displaySize * 0.18;
  let badgeX = 0;
  let badgeY = 0;
  let badgeW = 0;
  let badgeH = 0;

  if (position === 'bottom') {
    badgeX = displaySize * 0.1;
    badgeY = displaySize - frameMargin + (frameMargin * 0.15);
    badgeW = displaySize * 0.8;
    badgeH = frameMargin * 0.7;
  } else if (position === 'top') {
    badgeX = displaySize * 0.1;
    badgeY = frameMargin * 0.15;
    badgeW = displaySize * 0.8;
    badgeH = frameMargin * 0.7;
  } else if (position === 'left') {
    badgeX = frameMargin * 0.15;
    badgeY = displaySize * 0.1;
    badgeW = frameMargin * 0.7;
    badgeH = displaySize * 0.8;
  } else if (position === 'right') {
    badgeX = displaySize - frameMargin + (frameMargin * 0.15);
    badgeY = displaySize * 0.1;
    badgeW = frameMargin * 0.7;
    badgeH = displaySize * 0.8;
  }

  // Draw Badge Shape (Pill, Banner, Speech Bubble)
  if (style !== 'card') {
    ctx.fillStyle = bgColor;
    ctx.beginPath();

    if (style === 'banner') {
      if (position === 'bottom') {
        ctx.fillRect(0, displaySize - frameMargin, displaySize, frameMargin);
      } else if (position === 'top') {
        ctx.fillRect(0, 0, displaySize, frameMargin);
      } else if (position === 'left') {
        ctx.fillRect(0, 0, frameMargin, displaySize);
      } else {
        ctx.fillRect(displaySize - frameMargin, 0, frameMargin, displaySize);
      }
    } else if (style === 'pill') {
      const radius = Math.min(badgeW, badgeH) / 2;
      drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, radius);
      ctx.fill();
    } else if (style === 'speech-bubble') {
      const radius = Math.min(badgeW, badgeH) * 0.25;
      drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, radius);
      ctx.fill();

      // Speech pointer arrow
      ctx.beginPath();
      const ptrSize = Math.min(badgeW, badgeH) * 0.25;
      if (position === 'bottom') {
        const cx = displaySize / 2;
        ctx.moveTo(cx - ptrSize, badgeY);
        ctx.lineTo(cx, badgeY - ptrSize);
        ctx.lineTo(cx + ptrSize, badgeY);
      } else if (position === 'top') {
        const cx = displaySize / 2;
        ctx.moveTo(cx - ptrSize, badgeY + badgeH);
        ctx.lineTo(cx, badgeY + badgeH + ptrSize);
        ctx.lineTo(cx + ptrSize, badgeY + badgeH);
      } else if (position === 'left') {
        const cy = displaySize / 2;
        ctx.moveTo(badgeX + badgeW, cy - ptrSize);
        ctx.lineTo(badgeX + badgeW + ptrSize, cy);
        ctx.lineTo(badgeX + badgeW, cy + ptrSize);
      } else {
        const cy = displaySize / 2;
        ctx.moveTo(badgeX, cy - ptrSize);
        ctx.lineTo(badgeX - ptrSize, cy);
        ctx.lineTo(badgeX, cy + ptrSize);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  // Draw Text and Icon inside Badge
  const hasText = text.length > 0;
  const hasIcon = icon !== 'none';

  if (hasText || hasIcon) {
    const isVertical = position === 'left' || position === 'right';
    const centerX = style === 'banner'
      ? (isVertical ? (position === 'left' ? frameMargin / 2 : displaySize - frameMargin / 2) : displaySize / 2)
      : badgeX + badgeW / 2;
    const centerY = style === 'banner'
      ? (isVertical ? displaySize / 2 : (position === 'top' ? frameMargin / 2 : displaySize - frameMargin / 2))
      : badgeY + badgeH / 2;

    const availableHeight = style === 'banner' ? frameMargin : badgeH;
    const iconSize = Math.min(availableHeight * 0.5, 28);
    const fontSize = Math.max(12, Math.round(availableHeight * 0.38));

    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor;

    const measureWidth = (str: string) => {
      if (typeof ctx.measureText === 'function') {
        try {
          const m = ctx.measureText(str);
          if (m && typeof m.width === 'number') return m.width;
        } catch {
          // Fallback
        }
      }
      return str.length * fontSize * 0.55;
    };

    const textWidth = hasText ? measureWidth(text) : 0;
    const gap = (hasText && hasIcon) ? fontSize * 0.4 : 0;

    if (!isVertical) {
      // Horizontal layout
      const totalWidth = (hasIcon ? iconSize : 0) + gap + textWidth;
      let startX = centerX - totalWidth / 2;

      if (hasIcon) {
        drawIcon(ctx, icon, startX, centerY - iconSize / 2, iconSize, textColor);
        startX += iconSize + gap;
      }

      if (hasText) {
        ctx.fillText(text, startX + textWidth / 2, centerY, badgeW * 0.95);
      }
    } else {
      // Vertical side layout
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(position === 'left' ? -Math.PI / 2 : Math.PI / 2);

      const totalWidth = (hasIcon ? iconSize : 0) + gap + textWidth;
      let startX = -totalWidth / 2;

      if (hasIcon) {
        drawIcon(ctx, icon, startX, -iconSize / 2, iconSize, textColor);
        startX += iconSize + gap;
      }

      if (hasText) {
        ctx.fillText(text, startX + textWidth / 2, 0, badgeH * 0.95);
      }

      ctx.restore();
    }
  }

  ctx.restore();
}
