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

import { EyeShape, QRStyle } from '@/packages/core/types';
import { drawCornerRect, drawPoly, drawRoughRect, drawRoundRect, drawScribble, drawStar } from './canvasHelpers';
import { seedRandom } from './prng';

/** One of the three finder eyes, by the corner it sits in. */
export interface EyePosition {
  /** Names the eye; it seeds the Grunge scribble, so each eye keeps its own shape. */
  id: 'top-left' | 'top-right' | 'bottom-left';
  /** Whether the eye sits in the right-hand column of eyes. */
  atRight: boolean;
  /** Whether the eye sits in the bottom row of eyes. */
  atBottom: boolean;
}

/** The three finder eyes. Every renderer and check that walks the eyes uses this list. */
export const EYE_POSITIONS: readonly EyePosition[] = [
  { id: 'top-left', atRight: false, atBottom: false },
  { id: 'top-right', atRight: true, atBottom: false },
  { id: 'bottom-left', atRight: false, atBottom: true },
];

/**
 * Corner radius of the circle and leaf eyes, as a share of the side. A true circle (0.5) cuts so
 * far into the corners that our decoder loses the finder at 4 to 5 px per module; 0.45, drawn with
 * quadratic corners, still reads as a circle and decodes at every size eyeShapes.test.ts covers.
 */
const EYE_CURVE_RATIO = 0.45;

/**
 * Traces the outline of an eye shape as a new subpath.
 * @param ctx The canvas context.
 * @param shape The eye shape.
 * @param x Top-left x coordinate of the square the shape fills.
 * @param y Top-left y coordinate of the square the shape fills.
 * @param side Side length of that square.
 * @param roundRadius Corner radius of the rounded shape.
 * @param eye The eye being drawn. A leaf points its two sharp corners along the diagonal
 * that runs through the code's centre, so the three leaves mirror each other.
 */
const traceEyeShape = (
  ctx: CanvasRenderingContext2D,
  shape: EyeShape,
  x: number,
  y: number,
  side: number,
  roundRadius: number,
  eye: EyePosition
) => {
  switch (shape) {
    case EyeShape.ROUNDED:
      drawRoundRect(ctx, x, y, side, side, roundRadius);
      break;
    case EyeShape.CIRCLE:
      drawRoundRect(ctx, x, y, side, side, side * EYE_CURVE_RATIO);
      break;
    case EyeShape.LEAF: {
      const r = side * EYE_CURVE_RATIO;
      const sharpOnMainDiagonal = eye.atRight === eye.atBottom;
      drawCornerRect(ctx, x, y, side, side, sharpOnMainDiagonal ? [0, r, 0, r] : [r, 0, r, 0]);
      break;
    }
    case EyeShape.SQUARE:
    default:
      ctx.rect(x, y, side, side);
      break;
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
  bgColor: string,
  shape?: EyeShape,
  eye: EyePosition = EYE_POSITIONS[0]
) => {
  ctx.fillStyle = eyeColor;

  const cx = x + size / 2;
  const cy = y + size / 2;
  const inner = size - 2 * cellSize;

  // A chosen eye shape replaces the pattern's frame; the ring stays one module wide.
  if (shape) {
    ctx.beginPath();
    traceEyeShape(ctx, shape, x, y, size, cellSize * 1.5, eye);
    if (bgColor === 'transparent') {
      traceEyeShape(ctx, shape, x + cellSize, y + cellSize, inner, cellSize * 0.8, eye);
      ctx.fill('evenodd');
      return;
    }
    ctx.fill();
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    traceEyeShape(ctx, shape, x + cellSize, y + cellSize, inner, cellSize * 0.8, eye);
    ctx.fill();
    ctx.fillStyle = eyeColor;
    return;
  }

  // A transparent hole paints nothing, so the frame is drawn as a ring (outer and inner
  // outline in one even-odd path) and the hole stays see-through.
  if (bgColor === 'transparent') {
    ctx.beginPath();
    if (style === QRStyle.MODERN || style === QRStyle.FLUID || style === QRStyle.SWISS) {
      drawRoundRect(ctx, x, y, size, size, cellSize * 1.5);
      drawRoundRect(ctx, x + cellSize, y + cellSize, inner, inner, cellSize * 0.8);
    } else {
      ctx.rect(x, y, size, size);
      ctx.rect(x + cellSize, y + cellSize, inner, inner);
    }
    ctx.fill('evenodd');
    return;
  }

  const drawRoundedEyeFrame = () => {
    ctx.beginPath();
    drawRoundRect(ctx, x, y, size, size, cellSize * 1.5);
    ctx.fill();

    ctx.fillStyle = bgColor;
    ctx.beginPath();
    drawRoundRect(ctx, x + cellSize, y + cellSize, inner, inner, cellSize * 0.8);
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
      // Pin notches bite into the outer edge only. A cut through the whole ring breaks the
      // 1:1:3:1:1 finder run on the centre row and column, and decoders cannot find the code (#1278).
      const notch = cellSize * 0.35;
      ctx.fillRect(cx - gap / 2, y, gap, notch); // Top notch
      ctx.fillRect(cx - gap / 2, y + size - notch, gap, notch); // Bottom notch
      ctx.fillRect(x, cy - gap / 2, notch, gap); // Left notch
      ctx.fillRect(x + size - notch, cy - gap / 2, notch, gap); // Right notch
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
 * @param eyeId Which finder this is ('top-left', 'top-right' or 'bottom-left'). It seeds the
 * Grunge scribble, so each eye has its own shape that never changes between renders.
 */
export const drawEyeball = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  cellSize: number,
  style: QRStyle,
  eyeColor: string,
  bgColor: string,
  eyeId = 'top-left',
  shape?: EyeShape,
  eye: EyePosition = EYE_POSITIONS[0]
) => {
  ctx.fillStyle = eyeColor;

  const cx = x + size / 2;
  const cy = y + size / 2;

  if (shape) {
    ctx.beginPath();
    traceEyeShape(ctx, shape, x + 2 * cellSize, y + 2 * cellSize, 3 * cellSize, cellSize * 0.5, eye);
    ctx.fill();
    return;
  }

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
      drawScribble(ctx, x + 2 * cellSize, y + 2 * cellSize, 3 * cellSize, seedRandom(`grunge-eye-${eyeId}`));
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
