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

import { drawRoundRect } from './canvasHelpers';
import type { RenderSurface } from './surface';

/**
 * Draws a circular module (for Swiss/Fluid themes).
 * @param ctx The canvas context.
 * @param cx Center x coordinate.
 * @param cy Center y coordinate.
 * @param cellSize The physical size of a single module.
 * @param scale The exact scale factor overlap (e.g. 1.05 or 1.1).
 */
export const drawCircularModule = (
  ctx: RenderSurface,
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
  ctx: RenderSurface,
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
  ctx: RenderSurface,
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
