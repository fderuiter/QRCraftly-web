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

import type { RenderSurface } from './surface';

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
export const drawRoundRect = (ctx: RenderSurface, x: number, y: number, w: number, h: number, r: number) => {
  drawCornerRect(ctx, x, y, w, h, [r, r, r, r]);
};

/**
 * Draws a rectangle whose corners each have their own radius.
 * @param ctx The canvas context.
 * @param x The top-left x coordinate.
 * @param y The top-left y coordinate.
 * @param w The width of the rectangle.
 * @param h The height of the rectangle.
 * @param radii The top-left, top-right, bottom-right and bottom-left corner radii.
 */
export const drawCornerRect = (
  ctx: RenderSurface,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: readonly [number, number, number, number]
) => {
  const [tl, tr, br, bl] = radii.map((r) => clampCornerRadius(r, w, h));
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
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
export const drawPoly = (ctx: RenderSurface, x: number, y: number, r: number, sides: number, rotate: number = 0, fill: boolean = true, addToPath: boolean = false) => {
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
export const drawStar = (ctx: RenderSurface, cx: number, cy: number, outerR: number, innerR: number, spikes: number, fill: boolean = true, addToPath: boolean = false) => {
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
export const drawRoughRect = (ctx: RenderSurface, x: number, y: number, w: number, h: number, addToPath: boolean = false) => {
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
 * @param random A seeded generator in [0, 1) for the outline, so the shape is the same on every
 * render and export (#1397). Never pass `Math.random`.
 */
export const drawScribble = (
  ctx: RenderSurface,
  x: number,
  y: number,
  s: number,
  random: () => number
) => {
  ctx.save();
  ctx.translate(x + s / 2, y + s / 2);
  ctx.rotate(0.1);
  // Draw a rough polygon around the 3x3 pupil. Every vertex stays between 0.45s and 0.575s from
  // the centre (1.35 to 1.725 modules), so the outline never reaches far into the light ring
  // around the pupil, which a scanner needs to find the eye. The old 0.44s to 0.67s range
  // broke decoding for some shapes (#1397).
  ctx.beginPath();
  const r = s / 2;
  for (let i = 0; i < 8; i++) {
    const angle = i * (Math.PI * 2) / 8;
    const dist = r * (0.9 + random() * 0.25);
    const px = Math.cos(angle) * dist;
    const py = Math.sin(angle) * dist;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};
