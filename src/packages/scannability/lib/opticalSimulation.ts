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

/*
 * The optical print simulation (#1248): what a phone camera sees when it looks at a print of the
 * code. It works in module units, so the preview's size, its device pixel ratio and the code's
 * version change nothing: the code (from the corners a decode found) and its quiet zone are
 * resampled to PRINT_PX_PER_MODULE pixels a module, levels are squeezed between paper and ink,
 * a Gaussian blur stands in for ink spread and a slightly soft camera, and seeded sensor noise is
 * added. The same pixels always give the same picture, so the verdict never flickers.
 */

/** Raw RGBA pixels with their dimensions (an `ImageData` satisfies it). */
export interface PixelFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Grey pixels (one byte a pixel), as the simulated camera sees them. */
export interface GreyFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/** Where a decode found the code: its outer module corners (clockwise from top left) and version. */
export interface PrintPlacement {
  corners: readonly [Point, Point, Point, Point];
  version: number;
}

/**
 * Reusable scratch memory. The Scannability Worker keeps one set alive across requests, so
 * continuous slider edits do not allocate new frames for every check.
 */
export interface OpticalScratchBuffers {
  source?: Float32Array;
  luma?: Float32Array;
  temp?: Float32Array;
  grey?: Uint8ClampedArray;
}

/** Pixels a module in the simulated camera frame. Phones at a normal scanning distance see 3 to 8. */
export const PRINT_PX_PER_MODULE = 6;
/** Quiet zone kept around the code, in modules (the size the standard asks for). */
export const PRINT_QUIET_ZONE_MODULES = 4;
/** Ink spread plus a slightly soft camera, as a Gaussian standard deviation in modules. */
export const PRINT_BLUR_MODULES = 0.3;
/** Grey level of white paper in a photo. */
export const PRINT_PAPER_LEVEL = 235;
/** Grey level of black ink in a photo. */
export const PRINT_INK_LEVEL = 25;
/** Sensor noise, peak to peak, in grey levels. */
export const PRINT_NOISE_LEVEL = 10;

/** Seed for the sensor noise. Fixed, so a design always gets the same verdict. */
const NOISE_SEED = 0x51c0de;
/** Fewest and most samples a simulated pixel averages along each axis (more when the source is shrunk). */
const MIN_TAPS = 1;
const MAX_TAPS = 3;
/** Box passes that approximate the Gaussian. */
const GAUSS_PASSES = 3;

/**
 * The frame's grey levels as seen on paper: transparent pixels show the paper. Uses the
 * decoder's own luma weights.
 */
function paperPlane(frame: PixelFrame, plane: Float32Array): Float32Array {
  const { data } = frame;
  for (let p = 0, i = 0; p < plane.length; p++, i += 4) {
    const alpha = data[i + 3] / 255;
    plane[p] = ((306 * data[i] + 601 * data[i + 1] + 117 * data[i + 2]) / 1024) * alpha + 255 * (1 - alpha);
  }
  return plane;
}

/** Bilinear grey level at a point in frame pixels (pixel centres at half-integers); paper outside the frame. */
function sampleLuma(plane: Float32Array, width: number, height: number, x: number, y: number): number {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const ax = fx - x0;
  const ay = fy - y0;
  const inX0 = x0 >= 0 && x0 < width;
  const inX1 = x0 + 1 >= 0 && x0 + 1 < width;
  let top = 255 * (1 - ay);
  let bottom = 255 * ay;
  if (y0 >= 0 && y0 < height) {
    const row = y0 * width;
    top = ((inX0 ? plane[row + x0] : 255) * (1 - ax) + (inX1 ? plane[row + x0 + 1] : 255) * ax) * (1 - ay);
  }
  if (y0 + 1 >= 0 && y0 + 1 < height) {
    const row = (y0 + 1) * width;
    bottom = ((inX0 ? plane[row + x0] : 255) * (1 - ax) + (inX1 ? plane[row + x0 + 1] : 255) * ax) * ay;
  }
  return top + bottom;
}

/**
 * Widths of the box blurs whose repeated application approximates a Gaussian of `sigma` pixels.
 * @param sigma - Standard deviation in pixels.
 * @returns One odd width for each of the {@link GAUSS_PASSES} passes.
 */
export function gaussianBoxWidths(sigma: number): number[] {
  const n = GAUSS_PASSES;
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower -= 1;
  lower = Math.max(1, lower);
  const upper = lower + 2;
  const lowerCount = Math.round((12 * sigma * sigma - n * lower * lower - 4 * n * lower - 3 * n) / (-4 * lower - 4));
  return Array.from({ length: n }, (_, i) => (i < lowerCount ? lower : upper));
}

/** One box blur pass along every row or every column of a square frame, repeating edge pixels. */
function boxPass(src: Float32Array, dst: Float32Array, side: number, radius: number, alongRows: boolean): void {
  const width = 2 * radius + 1;
  const last = side - 1;
  const step = alongRows ? 1 : side;
  for (let line = 0; line < side; line++) {
    const base = alongRows ? line * side : line;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[base + Math.min(last, Math.max(0, k)) * step];
    for (let k = 0; k < side; k++) {
      dst[base + k * step] = sum / width;
      const enter = k + radius + 1;
      const leave = k - radius;
      sum += src[base + (enter > last ? last : enter) * step] - src[base + (leave < 0 ? 0 : leave) * step];
    }
  }
}

/** Seeded uniform generator in [0, 1) (mulberry32), so the noise is the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function reuse<T extends Float32Array | Uint8ClampedArray>(buffer: T | undefined, length: number, make: (length: number) => T): T {
  return buffer && buffer.length === length ? buffer : make(length);
}

/**
 * Simulates a phone camera looking at a print of the code.
 * @param frame - The rendered design (RGBA).
 * @param placement - Where a decode of `frame` found the code.
 * @param scratch - Optional reusable buffers; filled in on first use.
 * @returns The simulated camera frame, grey, {@link PRINT_PX_PER_MODULE} pixels a module, with the quiet zone.
 */
export function simulatePrint(frame: PixelFrame, placement: PrintPlacement, scratch: OpticalScratchBuffers = {}): GreyFrame {
  const modules = 17 + 4 * placement.version;
  const side = (modules + 2 * PRINT_QUIET_ZONE_MODULES) * PRINT_PX_PER_MODULE;
  const count = side * side;
  const luma = (scratch.luma = reuse(scratch.luma, count, (n) => new Float32Array(n)));
  const temp = (scratch.temp = reuse(scratch.temp, count, (n) => new Float32Array(n)));
  const grey = (scratch.grey = reuse(scratch.grey, count, (n) => new Uint8ClampedArray(n)));
  const source = paperPlane(frame, (scratch.source = reuse(scratch.source, frame.width * frame.height, (n) => new Float32Array(n))));

  // Resample: each simulated pixel averages the source over its footprint (a bilinear map of the
  // corners, which also follows a slightly tilted code in a photo).
  const [tl, tr, br, bl] = placement.corners;
  const edge = Math.max(Math.hypot(tr.x - tl.x, tr.y - tl.y), Math.hypot(bl.x - tl.x, bl.y - tl.y));
  const taps = Math.min(MAX_TAPS, Math.max(MIN_TAPS, Math.ceil(edge / modules / PRINT_PX_PER_MODULE)));
  const scale = PRINT_PX_PER_MODULE * taps;
  const range = (PRINT_PAPER_LEVEL - PRINT_INK_LEVEL) / 255;
  for (let oy = 0; oy < side; oy++) {
    for (let ox = 0; ox < side; ox++) {
      let sum = 0;
      for (let sy = 0; sy < taps; sy++) {
        const t = ((oy * taps + sy + 0.5) / scale - PRINT_QUIET_ZONE_MODULES) / modules;
        for (let sx = 0; sx < taps; sx++) {
          const s = ((ox * taps + sx + 0.5) / scale - PRINT_QUIET_ZONE_MODULES) / modules;
          const st = s * t;
          const x = tl.x + s * (tr.x - tl.x) + t * (bl.x - tl.x) + st * (br.x - tr.x - bl.x + tl.x);
          const y = tl.y + s * (tr.y - tl.y) + t * (bl.y - tl.y) + st * (br.y - tr.y - bl.y + tl.y);
          sum += sampleLuma(source, frame.width, frame.height, x, y);
        }
      }
      luma[oy * side + ox] = PRINT_INK_LEVEL + range * (sum / (taps * taps));
    }
  }

  for (const width of gaussianBoxWidths(PRINT_BLUR_MODULES * PRINT_PX_PER_MODULE)) {
    const radius = (width - 1) / 2;
    if (radius === 0) continue;
    boxPass(luma, temp, side, radius, true);
    boxPass(temp, luma, side, radius, false);
  }

  const random = seededRandom(NOISE_SEED);
  for (let i = 0; i < count; i++) {
    grey[i] = luma[i] + (random() - 0.5) * PRINT_NOISE_LEVEL;
  }
  return { data: grey, width: side, height: side };
}
