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
import { QRStyle } from '@/types';

/**
 * Clamps the corner radius so it doesn't exceed half of the width or height,
 * and is never negative.
 *
 * @param r The corner radius.
 * @param w The width.
 * @param h The height.
 * @returns The safely clamped corner radius.
 */
export const clampCornerRadius = (r: number, w: number, h: number): number => {
  const absW = Math.abs(w);
  const absH = Math.abs(h);
  return Math.max(0, Math.min(r, absW / 2, absH / 2));
};

/**
 * Draws a rounded rectangle.
 * @param ctx The canvas context.
 * @param x The top-left x coordinate.
 * @param y The top-left y coordinate.
 * @param w The width of the rectangle.
 * @param h The height of the rectangle.
 * @param r The corner radius.
 */
export const drawRoundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  const safeR = clampCornerRadius(r, w, h);
  ctx.moveTo(x + safeR, y);
  ctx.lineTo(x + w - safeR, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + safeR);
  ctx.lineTo(x + w, y + h - safeR);
  ctx.quadraticCurveTo(x + w, y + h, x + w - safeR, y + h);
  ctx.lineTo(x + safeR, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - safeR);
  ctx.lineTo(x, y + safeR);
  ctx.quadraticCurveTo(x, y, x + safeR, y);
  ctx.closePath();
};

const HEX_OFFSETS = Array.from({ length: 6 }, (_, i) => {
  const theta = (i * 2 * Math.PI) / 6;
  return { cos: Math.cos(theta), sin: Math.sin(theta) };
});

const STAR_5_OFFSETS = (() => {
  const offsets: Array<{ cos: number; sin: number }> = [];
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / 5;
  for (let i = 0; i < 5; i++) {
    offsets.push({ cos: Math.cos(rot), sin: Math.sin(rot) });
    rot += step;
    offsets.push({ cos: Math.cos(rot), sin: Math.sin(rot) });
    rot += step;
  }
  return offsets;
})();

/**
 * Draws a regular polygon.
 * @param ctx The canvas context.
 * @param x The center x coordinate.
 * @param y The center y coordinate.
 * @param r The radius.
 * @param sides The number of sides.
 * @param rotate Rotation angle in radians (default: 0).
 * @param fill Whether to fill the polygon (default: true).
 * @param addToPath Whether to add to the current path without starting a new one or filling (default: false).
 */
export const drawPoly = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, sides: number, rotate: number = 0, fill: boolean = true, addToPath: boolean = false) => {
  if (!addToPath) ctx.beginPath();
  if (sides === 6 && rotate === 0) {
    ctx.moveTo(x + r * HEX_OFFSETS[0].cos, y + r * HEX_OFFSETS[0].sin);
    for (let i = 1; i < 6; i++) {
      ctx.lineTo(x + r * HEX_OFFSETS[i].cos, y + r * HEX_OFFSETS[i].sin);
    }
  } else {
    for (let i = 0; i < sides; i++) {
      const theta = rotate + (i * 2 * Math.PI / sides);
      const px = x + r * Math.cos(theta);
      const py = y + r * Math.sin(theta);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  if (!addToPath) {
    if (fill) ctx.fill(); else ctx.stroke();
  }
};

/**
 * Draws a star shape.
 * @param ctx The canvas context.
 * @param cx The center x coordinate.
 * @param cy The center y coordinate.
 * @param outerR The outer radius.
 * @param innerR The inner radius.
 * @param spikes The number of spikes.
 * @param fill Whether to fill the star (default: true).
 * @param addToPath Whether to add to the current path without starting a new one or filling (default: false).
 */
export const drawStar = (ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, innerR: number, spikes: number, fill: boolean = true, addToPath: boolean = false) => {
  if (!addToPath) ctx.beginPath();
  if (spikes === 5) {
    ctx.moveTo(cx + STAR_5_OFFSETS[0].cos * outerR, cy + STAR_5_OFFSETS[0].sin * outerR);
    for (let i = 0; i < 5; i++) {
      const oOuter = STAR_5_OFFSETS[i * 2];
      const oInner = STAR_5_OFFSETS[i * 2 + 1];
      ctx.lineTo(cx + oOuter.cos * outerR, cy + oOuter.sin * outerR);
      ctx.lineTo(cx + oInner.cos * innerR, cy + oInner.sin * innerR);
    }
    ctx.lineTo(cx + STAR_5_OFFSETS[0].cos * outerR, cy + STAR_5_OFFSETS[0].sin * outerR);
  } else {
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;
    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outerR;
      y = cy + Math.sin(rot) * outerR;
      ctx.lineTo(x, y);
      rot += step;

      x = cx + Math.cos(rot) * innerR;
      y = cy + Math.sin(rot) * innerR;
      ctx.lineTo(x, y);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerR);
  }
  ctx.closePath();
  if (!addToPath) {
    if (fill) ctx.fill(); else ctx.stroke();
  }
};

const ROUGH_RECT_ROTATION = 0.02;
const ROUGH_RECT_COS = Math.cos(ROUGH_RECT_ROTATION);
const ROUGH_RECT_SIN = Math.sin(ROUGH_RECT_ROTATION);

/**
 * Draws a roughly rectangular shape (slightly rotated).
 * @param ctx The canvas context.
 * @param x The top-left x coordinate.
 * @param y The top-left y coordinate.
 * @param w The width.
 * @param h The height.
 * @param addToPath Whether to add to the current path instead of filling immediately (default: false).
 */
export const drawRoughRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, addToPath: boolean = false) => {
  const hw = w / 2;
  const hh = h / 2;
  const cx = x + hw;
  const cy = y + hh;

  const cosHW = hw * ROUGH_RECT_COS;
  const sinHW = hw * ROUGH_RECT_SIN;
  const cosHH = hh * ROUGH_RECT_COS;
  const sinHH = hh * ROUGH_RECT_SIN;

  const x0 = cx - cosHW + sinHH;
  const y0 = cy - sinHW - cosHH;

  const x1 = cx + cosHW + sinHH;
  const y1 = cy + sinHW - cosHH;

  const x2 = cx + cosHW - sinHH;
  const y2 = cy + sinHW + cosHH;

  const x3 = cx - cosHW - sinHH;
  const y3 = cy - sinHW + cosHH;

  if (!addToPath) {
    ctx.beginPath();
  }

  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();

  if (!addToPath) {
    ctx.fill();
  }
};

/**
 * Draws a scribbled shape.
 * @param ctx The canvas context.
 * @param x The top-left x coordinate.
 * @param y The top-left y coordinate.
 * @param s The size of the bounding box.
 */
export const drawScribble = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => {
  ctx.save();
  ctx.translate(x + s / 2, y + s / 2);
  ctx.rotate(0.1);
  // Draw a rough polygon that fills most of the space
  ctx.beginPath();
  const r = s / 1.8; // Radius to cover square corners
  for (let i = 0; i < 8; i++) {
    const angle = i * (Math.PI * 2) / 8;
    const dist = r * (0.8 + Math.random() * 0.4);
    const px = Math.cos(angle) * dist;
    const py = Math.sin(angle) * dist;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

/**
 * Draws a circular module (for Swiss/Fluid themes).
 * @param ctx The canvas context.
 * @param cx Center x coordinate.
 * @param cy Center y coordinate.
 * @param cellSize The physical size of a single module.
 * @param scale The exact scale factor overlap (e.g. 1.05 or 1.1).
 */
export const drawCircularModule = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cellSize: number,
  scale: number
) => {
  const r = (cellSize / 2) * scale;
  ctx.moveTo(cx + r, cy);
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
};

/**
 * Draws a circuit module with dynamic connections to neighbors.
 * @param ctx The canvas context.
 * @param x Top-left x coordinate.
 * @param y Top-left y coordinate.
 * @param cx Center x coordinate.
 * @param cy Center y coordinate.
 * @param cellSize Sizing properties.
 * @param hasTop Adjacent module presence states.
 * @param hasBottom Adjacent module presence states.
 * @param hasLeft Adjacent module presence states.
 * @param hasRight Adjacent module presence states.
 */
export const drawCircuitModule = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cx: number,
  cy: number,
  cellSize: number,
  hasTop: boolean,
  hasBottom: boolean,
  hasLeft: boolean,
  hasRight: boolean
) => {
  const thickness = cellSize * 0.4;
  const thicknessHalf = thickness / 2;
  const linkLen = cellSize / 2 + 1;

  drawRoundRect(ctx, x, y, cellSize, cellSize, cellSize * 0.3);

  if (hasLeft && hasRight) {
    ctx.rect(x, cy - thicknessHalf, cellSize, thickness);
  } else {
    if (hasLeft) ctx.rect(x, cy - thicknessHalf, linkLen, thickness);
    if (hasRight) ctx.rect(cx, cy - thicknessHalf, linkLen, thickness);
  }

  if (hasTop && hasBottom) {
    ctx.rect(cx - thicknessHalf, y, thickness, cellSize);
  } else {
    if (hasTop) ctx.rect(cx - thicknessHalf, y, thickness, linkLen);
    if (hasBottom) ctx.rect(cx - thicknessHalf, cy, thickness, linkLen);
  }
};

/**
 * Draws a standard square module.
 * @param ctx The canvas context.
 * @param x Top-left x coordinate.
 * @param y Top-left y coordinate.
 * @param cellSize Sizing properties.
 * @param isVirtual Whether rendering for svg or custom contexts requiring rounding.
 */
export const drawStandardModule = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellSize: number,
  isVirtual: boolean
) => {
  if (isVirtual) {
    const intX = Math.round(x);
    const intY = Math.round(y);
    const intW = Math.round(x + cellSize) - intX;
    const intH = Math.round(y + cellSize) - intY;
    ctx.rect(intX, intY, intW, intH);
  } else {
    const ceilCellSize = Math.ceil(cellSize);
    ctx.rect(Math.floor(x), Math.floor(y), ceilCellSize, ceilCellSize);
  }
};

/**
 * Draws a locator eye frame.
 * @param ctx The canvas context.
 * @param x Top-left x coordinate of the eye.
 * @param y Top-left y coordinate of the eye.
 * @param size The size of the eye (7 * cellSize).
 * @param cellSize Sizing properties.
 * @param style Style theme.
 * @param eyeColor Eye color.
 * @param bgColor Background color to clear/punch holes.
 */
export const drawEyeFrame = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  cellSize: number,
  style: QRStyle,
  eyeColor: string,
  bgColor: string
) => {
  ctx.fillStyle = eyeColor;

  const cx = x + size / 2;
  const cy = y + size / 2;

  const drawRoundedEyeFrame = () => {
    ctx.beginPath();
    drawRoundRect(ctx, x, y, size, size, cellSize * 1.5);
    ctx.fill();

    ctx.fillStyle = bgColor;
    ctx.beginPath();
    drawRoundRect(ctx, x + cellSize, y + cellSize, size - 2 * cellSize, size - 2 * cellSize, cellSize * 0.8);
    ctx.fill();
    ctx.fillStyle = eyeColor;
  };

  const drawSquareEyeFrame = () => {
    ctx.fillRect(x, y, size, size);

    ctx.fillStyle = bgColor;
    ctx.fillRect(x + cellSize, y + cellSize, size - 2 * cellSize, size - 2 * cellSize);
    ctx.fillStyle = eyeColor;
  };

  switch (style) {
    case QRStyle.MODERN:
    case QRStyle.FLUID:
    case QRStyle.SWISS:
      drawRoundedEyeFrame();
      break;

    case QRStyle.CIRCUIT:
      drawSquareEyeFrame();
      ctx.fillStyle = bgColor;
      const gap = cellSize * 0.5;
      ctx.fillRect(cx - gap / 2, y, gap, cellSize * 1.1); // Top cut
      ctx.fillRect(cx - gap / 2, y + size - cellSize * 1.1, gap, cellSize * 1.1); // Bottom cut
      ctx.fillRect(x, cy - gap / 2, cellSize * 1.1, gap); // Left cut
      ctx.fillRect(x + size - cellSize * 1.1, cy - gap / 2, cellSize * 1.1, gap); // Right cut
      ctx.fillStyle = eyeColor;
      break;

    case QRStyle.GRUNGE:
      drawRoughRect(ctx, x, y, size, size);
      ctx.fillStyle = bgColor;
      ctx.fillRect(x + cellSize, y + cellSize, size - 2 * cellSize, size - 2 * cellSize);
      ctx.fillStyle = eyeColor;
      break;

    case QRStyle.HIVE:
    case QRStyle.STARBURST:
    case QRStyle.STANDARD:
    default:
      drawSquareEyeFrame();
      break;
  }
};

/**
 * Draws a locator eyeball.
 * @param ctx The canvas context.
 * @param x Top-left x coordinate of the eye.
 * @param y Top-left y coordinate of the eye.
 * @param size The size of the eye (7 * cellSize).
 * @param cellSize Sizing properties.
 * @param style Style theme.
 * @param eyeColor Eye color.
 * @param bgColor Background color to clear/punch holes.
 */
export const drawEyeball = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  cellSize: number,
  style: QRStyle,
  eyeColor: string,
  bgColor: string
) => {
  ctx.fillStyle = eyeColor;

  const cx = x + size / 2;
  const cy = y + size / 2;

  switch (style) {
    case QRStyle.MODERN:
      ctx.beginPath();
      drawRoundRect(ctx, x + 2 * cellSize, y + 2 * cellSize, 3 * cellSize, 3 * cellSize, cellSize * 0.5);
      ctx.fill();
      break;

    case QRStyle.FLUID:
      // A squircle rather than a circle: a round 3x3 core shrinks along the diagonals and
      // fails finder-pattern checks at common sizes (see fluidRoundTrip.test.ts).
      ctx.beginPath();
      drawRoundRect(ctx, x + 2 * cellSize, y + 2 * cellSize, 3 * cellSize, 3 * cellSize, cellSize);
      ctx.fill();
      break;

    case QRStyle.SWISS:
      ctx.beginPath();
      ctx.arc(cx, cy, 1.5 * cellSize, 0, Math.PI * 2);
      ctx.fill();
      break;

    case QRStyle.CIRCUIT:
      ctx.beginPath();
      ctx.rect(x + 2 * cellSize, y + 2 * cellSize, 3 * cellSize, 3 * cellSize);
      ctx.fill();

      ctx.fillStyle = bgColor;
      ctx.fillRect(x + 4.6 * cellSize, y + 4.6 * cellSize, 0.4 * cellSize, 0.4 * cellSize);
      ctx.fillStyle = eyeColor;
      break;

    case QRStyle.HIVE:
      drawPoly(ctx, cx, cy, 1.8 * cellSize, 6, 0, true);
      break;

    case QRStyle.GRUNGE:
      drawScribble(ctx, x + 2 * cellSize, y + 2 * cellSize, 3 * cellSize);
      break;

    case QRStyle.STARBURST:
      drawStar(ctx, cx, cy, 1.9 * cellSize, 1.2 * cellSize, 5, true);
      break;

    case QRStyle.STANDARD:
    default:
      ctx.fillRect(x + 2 * cellSize, y + 2 * cellSize, 3 * cellSize, 3 * cellSize);
      break;
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

