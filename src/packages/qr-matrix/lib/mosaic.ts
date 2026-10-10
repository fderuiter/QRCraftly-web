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

/**
 * Mosaic QR engine (ADR 0019).
 *
 * Tiles a user-supplied image into the QR modules while every module keeps its
 * dark or light value. Nothing is flipped, so the error-correction budget is left
 * for the logo cutout and for real-world damage.
 *
 * - `tiles`: each module is one tile painted with the image colour under it.
 * - `halftone`: each module is split into 3x3 sub-cells. The centre sub-cell (where
 *   scanners sample) is held to the module's value; the eight outer sub-cells keep
 *   more of the image.
 *
 * Function patterns (finders, separators, timing, alignment, format and version
 * information) are always drawn as whole tiles at full contrast.
 */

import type { QRModules, MosaicMode } from '@/types';
import { srgbToLinear, linearToSrgb, getLuminanceFromLinearRgb } from '@/utils/colorUtils';
import { isAlignmentPatternZone } from './utils';

/** Engine options. */
export interface MosaicOptions {
  /** Tile layout. */
  mode: MosaicMode;
  /** How hard module colours are pushed towards their dark or light value (0..1). */
  contrast: number;
}

/** A decoded RGBA image, like `ImageData`. */
export interface MosaicSource {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** The colour of every sub-cell of the mosaic. */
export interface MosaicPlan {
  /** QR modules per side. */
  moduleCount: number;
  /** Sub-cells per module side (1 for tiles, 3 for halftone). */
  subdivisions: number;
  /** RGB triplets, row-major over a `(moduleCount * subdivisions)` square grid. */
  colors: Uint8Array;
}

/** Relative-luminance limits a module colour must respect. */
export interface MosaicThresholds {
  /** Highest luminance allowed for a dark module core. */
  darkMax: number;
  /** Lowest luminance allowed for a light module core. */
  lightMin: number;
  /** Highest luminance allowed for the outer sub-cells of a dark module (halftone). */
  softDarkMax: number;
  /** Lowest luminance allowed for the outer sub-cells of a light module (halftone). */
  softLightMin: number;
}

export type { MosaicMode };

export const DEFAULT_MOSAIC_OPTIONS: MosaicOptions = { mode: 'halftone', contrast: 0.5 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Maps the contrast setting to luminance limits.
 * At contrast 0 the core contrast ratio is about 5:1; at contrast 1 it is about 13:1.
 * @param contrast - Contrast setting (0..1).
 * @returns The luminance limits.
 */
export function resolveMosaicThresholds(contrast: number): MosaicThresholds {
  const t = clamp01(contrast);
  return {
    darkMax: lerp(0.08, 0.02, t),
    lightMin: lerp(0.6, 0.85, t),
    softDarkMax: lerp(0.25, 0.1, t),
    softLightMin: lerp(0.34, 0.55, t),
  };
}

/**
 * Whether a module belongs to a function pattern: finder patterns and their separators,
 * timing patterns, alignment patterns, format information and version information.
 * @param r - Row.
 * @param c - Column.
 * @param n - Modules per side.
 * @returns True for function-pattern modules.
 */
export function isMosaicFunctionModule(r: number, c: number, n: number): boolean {
  // Finder patterns, separators and the format information strips next to them.
  if (r <= 8 && c <= 8) return true;
  if (r <= 8 && c >= n - 8) return true;
  if (r >= n - 8 && c <= 8) return true;
  // Timing patterns.
  if (r === 6 || c === 6) return true;
  // Version information (version 7 and up).
  if (n >= 45) {
    if (r < 6 && c >= n - 11 && c < n - 8) return true;
    if (c < 6 && r >= n - 11 && r < n - 8) return true;
  }
  // Alignment patterns (5x5; the helper's zone includes a one-module margin).
  return isAlignmentPatternZone(r, c, n);
}

/**
 * Area-averages the image into a `grid` x `grid` RGB raster. The image is centre-cropped
 * to a square ("cover" fit) and composited over white.
 * @param source - Decoded RGBA image.
 * @param grid - Output cells per side.
 * @returns RGB triplets, row-major.
 */
export function sampleMosaicGrid(source: MosaicSource, grid: number): Uint8Array {
  const out = new Uint8Array(grid * grid * 3);
  const { width, height, data } = source;
  if (width <= 0 || height <= 0) {
    out.fill(255);
    return out;
  }

  const side = Math.min(width, height);
  const offX = (width - side) / 2;
  const offY = (height - side) / 2;
  const step = side / grid;

  for (let gy = 0; gy < grid; gy++) {
    const y0 = Math.floor(offY + gy * step);
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor(offY + (gy + 1) * step)));
    for (let gx = 0; gx < grid; gx++) {
      const x0 = Math.floor(offX + gx * step);
      const x1 = Math.max(x0 + 1, Math.min(width, Math.floor(offX + (gx + 1) * step)));
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          const a = data[i + 3] / 255;
          rs += data[i] * a + 255 * (1 - a);
          gs += data[i + 1] * a + 255 * (1 - a);
          bs += data[i + 2] * a + 255 * (1 - a);
          count++;
        }
      }
      const o = (gy * grid + gx) * 3;
      out[o] = Math.round(rs / count);
      out[o + 1] = Math.round(gs / count);
      out[o + 2] = Math.round(bs / count);
    }
  }
  return out;
}

/** Quantisation step for output channels; keeps the number of distinct fills (and SVG size) down. */
const QUANT = 8;

/**
 * Pushes an sRGB colour (0..255 channels) to a luminance limit while keeping its hue.
 * Dark colours are scaled down in linear light; light colours are mixed towards white.
 * @param rgb - Colour to adjust, modified in place.
 * @param offset - Index of the red channel in `rgb`.
 * @param dark - Whether the colour must be dark.
 * @param limit - Luminance ceiling (dark) or floor (light).
 */
function clampColor(rgb: Uint8Array, offset: number, dark: boolean, limit: number): void {
  const rl = srgbToLinear(rgb[offset] / 255);
  const gl = srgbToLinear(rgb[offset + 1] / 255);
  const bl = srgbToLinear(rgb[offset + 2] / 255);
  const lum = getLuminanceFromLinearRgb(rl, gl, bl);

  let r = rl;
  let g = gl;
  let b = bl;
  if (dark && lum > limit) {
    const k = limit / lum;
    r *= k;
    g *= k;
    b *= k;
  } else if (!dark && lum < limit) {
    const t = (limit - lum) / (1 - lum);
    r += t * (1 - r);
    g += t * (1 - g);
    b += t * (1 - b);
  }

  // Quantise away from the limit so it still holds afterwards.
  const q = (v: number) => {
    const s = linearToSrgb(clamp01(v)) * 255;
    const stepped = dark ? Math.floor(s / QUANT) * QUANT : Math.ceil(s / QUANT) * QUANT;
    return Math.min(255, Math.max(0, stepped));
  };
  rgb[offset] = q(r);
  rgb[offset + 1] = q(g);
  rgb[offset + 2] = q(b);
}

/**
 * Plans the colour of every mosaic sub-cell.
 * @param modules - The QR module matrix.
 * @param source - The decoded image.
 * @param options - Engine options.
 * @returns The mosaic plan.
 */
export function planMosaic(
  modules: QRModules,
  source: MosaicSource,
  options: MosaicOptions = DEFAULT_MOSAIC_OPTIONS
): MosaicPlan {
  const n = modules.size;
  const s = options.mode === 'halftone' ? 3 : 1;
  const grid = n * s;
  const colors = sampleMosaicGrid(source, grid);
  const th = resolveMosaicThresholds(options.contrast);
  const core = Math.floor(s / 2);

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const dark = !!modules.get(r, c);
      const whole = s === 1 || isMosaicFunctionModule(r, c, n);

      for (let i = 0; i < s; i++) {
        for (let j = 0; j < s; j++) {
          const isCore = whole || (i === core && j === core);
          const limit = isCore
            ? (dark ? th.darkMax : th.lightMin)
            : (dark ? th.softDarkMax : th.softLightMin);
          clampColor(colors, ((r * s + i) * grid + (c * s + j)) * 3, dark, limit);
        }
      }

      // Function patterns are solid: repeat the core colour across the module.
      if (whole && s > 1) {
        const src = ((r * s + core) * grid + (c * s + core)) * 3;
        for (let i = 0; i < s; i++) {
          for (let j = 0; j < s; j++) {
            const dst = ((r * s + i) * grid + (c * s + j)) * 3;
            colors[dst] = colors[src];
            colors[dst + 1] = colors[src + 1];
            colors[dst + 2] = colors[src + 2];
          }
        }
      }
    }
  }

  return { moduleCount: n, subdivisions: s, colors };
}

const hex2 = (v: number) => v.toString(16).padStart(2, '0');

/**
 * Draws a mosaic plan onto any canvas-like 2D context (canvas or `SvgContext`).
 * Same-colour horizontal runs are merged and every colour is filled as one path.
 * @param ctx - Target context.
 * @param plan - The mosaic plan.
 * @param drawX - Left edge of the module area.
 * @param drawY - Top edge of the module area.
 * @param cellSize - Module size in context units.
 * @param skipModule - Optional predicate for modules to leave empty (e.g. under a logo).
 */
export function renderMosaic(
  ctx: CanvasRenderingContext2D,
  plan: MosaicPlan,
  drawX: number,
  drawY: number,
  cellSize: number,
  skipModule?: (r: number, c: number) => boolean
): void {
  const { moduleCount: n, subdivisions: s, colors } = plan;
  const grid = n * s;
  const sub = cellSize / s;
  const runs = new Map<string, number[]>();

  for (let y = 0; y < grid; y++) {
    const r = Math.floor(y / s);
    let x = 0;
    while (x < grid) {
      const o = (y * grid + x) * 3;
      if (skipModule?.(r, Math.floor(x / s))) {
        x++;
        continue;
      }
      let end = x + 1;
      while (
        end < grid &&
        colors[(y * grid + end) * 3] === colors[o] &&
        colors[(y * grid + end) * 3 + 1] === colors[o + 1] &&
        colors[(y * grid + end) * 3 + 2] === colors[o + 2] &&
        !skipModule?.(r, Math.floor(end / s))
      ) {
        end++;
      }
      const key = `#${hex2(colors[o])}${hex2(colors[o + 1])}${hex2(colors[o + 2])}`;
      let list = runs.get(key);
      if (!list) {
        list = [];
        runs.set(key, list);
      }
      list.push(x, y, end - x);
      x = end;
    }
  }

  for (const [color, list] of runs) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 3) {
      ctx.rect(drawX + list[i] * sub, drawY + list[i + 1] * sub, list[i + 2] * sub, sub);
    }
    ctx.fill();
  }
}

/**
 * Rasterises a mosaic plan into an RGBA buffer with a light quiet zone.
 * Used to verify that a mosaic decodes without a canvas.
 * @param plan - The mosaic plan.
 * @param pixelsPerModule - Output pixels per module side (a multiple of `plan.subdivisions` is sharpest).
 * @param quietZone - Quiet zone width in modules (4 per ISO/IEC 18004).
 * @returns An `ImageData`-like RGBA image.
 */
export function rasterizeMosaic(plan: MosaicPlan, pixelsPerModule: number, quietZone: number = 4): MosaicSource {
  const { moduleCount: n, subdivisions: s, colors } = plan;
  const grid = n * s;
  const size = (n + quietZone * 2) * pixelsPerModule;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  const origin = quietZone * pixelsPerModule;
  const span = n * pixelsPerModule;

  for (let py = 0; py < span; py++) {
    const gy = Math.min(grid - 1, Math.floor((py * s) / pixelsPerModule));
    for (let px = 0; px < span; px++) {
      const gx = Math.min(grid - 1, Math.floor((px * s) / pixelsPerModule));
      const o = (gy * grid + gx) * 3;
      const d = ((origin + py) * size + origin + px) * 4;
      data[d] = colors[o];
      data[d + 1] = colors[o + 1];
      data[d + 2] = colors[o + 2];
    }
  }
  return { width: size, height: size, data };
}
