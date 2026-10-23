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
 * added.
 *
 * This kernel is implemented in Rust (`crates/optical-sim`), compiled to `src/wasm/optical-sim.wasm`.
 * The WASM loader lives in `opticalSimKernel.ts` so pages importing scannability tools do not
 * statically pull the WASM runtime or asset URL into their first-load bundle.
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

/** Box passes that approximate the Gaussian. */
const GAUSS_PASSES = 3;

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

const NOISE_SEED = 0x51c0de;

function paperPlane(frame: PixelFrame, plane: Float32Array): Float32Array {
  const { data } = frame;
  const count = frame.width * frame.height;
  for (let i = 0; i < count; i++) {
    const src = i * 4;
    const a = data[src + 3] / 255;
    const luma = 0.299 * data[src] + 0.587 * data[src + 1] + 0.114 * data[src + 2];
    plane[i] = luma * a + 255 * (1 - a);
  }
  return plane;
}

function sampleLumaBilinear(plane: Float32Array, width: number, height: number, x: number, y: number): number {
  if (x < 0 || x >= width - 1 || y < 0 || y >= height - 1) {
    const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
    return plane[cy * width + cx];
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i00 = y0 * width + x0;
  const v00 = plane[i00];
  const v10 = plane[i00 + 1];
  const v01 = plane[i00 + width];
  const v11 = plane[i00 + width + 1];
  const top = v00 + fx * (v10 - v00);
  const bottom = v01 + fx * (v11 - v01);
  return top + fy * (bottom - top);
}

function resampleTransformed(
  sourcePlane: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  corners: readonly [Point, Point, Point, Point],
  side: number,
  outputPlane: Float32Array,
): Float32Array {
  const [tl, tr, br, bl] = corners;
  const pad = PRINT_QUIET_ZONE_MODULES * PRINT_PX_PER_MODULE;
  const innerSide = side - pad * 2;

  for (let y = 0; y < side; y++) {
    const v = (y - pad) / innerSide;
    for (let x = 0; x < side; x++) {
      const u = (x - pad) / innerSide;
      const topX = tl.x + u * (tr.x - tl.x);
      const topY = tl.y + u * (tr.y - tl.y);
      const bottomX = bl.x + u * (br.x - bl.x);
      const bottomY = bl.y + u * (br.y - bl.y);
      const sx = topX + v * (bottomX - topX);
      const sy = topY + v * (bottomY - topY);
      outputPlane[y * side + x] = sampleLumaBilinear(sourcePlane, sourceWidth, sourceHeight, sx, sy);
    }
  }
  return outputPlane;
}

function boxPass(src: Float32Array, dst: Float32Array, side: number, radius: number, horizontal: boolean): void {
  const window = radius * 2 + 1;
  const invWindow = 1 / window;

  if (horizontal) {
    for (let y = 0; y < side; y++) {
      const row = y * side;
      let sum = src[row] * (radius + 1);
      for (let i = 1; i <= radius; i++) {
        sum += src[row + Math.min(i, side - 1)];
      }
      dst[row] = sum * invWindow;

      for (let x = 1; x < side; x++) {
        const addIndex = Math.min(x + radius, side - 1);
        const removeIndex = Math.max(x - radius - 1, 0);
        sum += src[row + addIndex] - src[row + removeIndex];
        dst[row + x] = sum * invWindow;
      }
    }
    return;
  }

  for (let x = 0; x < side; x++) {
    let sum = src[x] * (radius + 1);
    for (let i = 1; i <= radius; i++) {
      sum += src[Math.min(i, side - 1) * side + x];
    }
    dst[x] = sum * invWindow;

    for (let y = 1; y < side; y++) {
      const addIndex = Math.min(y + radius, side - 1);
      const removeIndex = Math.max(y - radius - 1, 0);
      sum += src[addIndex * side + x] - src[removeIndex * side + x];
      dst[y * side + x] = sum * invWindow;
    }
  }
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pure TypeScript print simulation oracle. */
export function simulatePrintTs(
  frame: PixelFrame,
  placement: PrintPlacement,
  scratch: OpticalScratchBuffers = {},
): GreyFrame {
  const { corners, version } = placement;
  const moduleCount = 17 + version * 4;
  const totalModules = moduleCount + PRINT_QUIET_ZONE_MODULES * 2;
  const side = totalModules * PRINT_PX_PER_MODULE;
  const count = side * side;

  const sourceCount = frame.width * frame.height;
  if (!scratch.source || scratch.source.length < sourceCount) {
    scratch.source = new Float32Array(sourceCount);
  }
  if (!scratch.luma || scratch.luma.length < count) {
    scratch.luma = new Float32Array(count);
  }
  if (!scratch.temp || scratch.temp.length < count) {
    scratch.temp = new Float32Array(count);
  }
  if (!scratch.grey || scratch.grey.length < count) {
    scratch.grey = new Uint8ClampedArray(count);
  }

  const sourcePlane = paperPlane(frame, scratch.source.subarray(0, sourceCount));
  const luma = resampleTransformed(sourcePlane, frame.width, frame.height, corners, side, scratch.luma.subarray(0, count));
  const temp = scratch.temp.subarray(0, count);
  const grey = scratch.grey.subarray(0, count);

  for (let i = 0; i < count; i++) {
    const raw = luma[i] / 255;
    luma[i] = PRINT_INK_LEVEL + raw * (PRINT_PAPER_LEVEL - PRINT_INK_LEVEL);
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

export interface OpticalSimKernel {
  simulatePrint(frame: PixelFrame, placement: PrintPlacement, scratch?: OpticalScratchBuffers): GreyFrame;
}

let activeKernel: OpticalSimKernel | null = null;

export function setOpticalSimKernel(kernel: OpticalSimKernel | null): void {
  activeKernel = kernel;
}

/**
 * Simulates a phone camera looking at a print of the code.
 * Delegates frame calculation to the Rust WebAssembly kernel if loaded, falling back
 * to the pure TypeScript simulation.
 * @param frame - The rendered design (RGBA).
 * @param placement - Where a decode of `frame` found the code.
 * @param scratch - Optional reusable buffers; filled in on first use.
 * @returns The simulated camera frame, grey, {@link PRINT_PX_PER_MODULE} pixels a module, with the quiet zone.
 */
export function simulatePrint(
  frame: PixelFrame,
  placement: PrintPlacement,
  scratch: OpticalScratchBuffers = {},
): GreyFrame {
  if (activeKernel) {
    return activeKernel.simulatePrint(frame, placement, scratch);
  }
  return simulatePrintTs(frame, placement, scratch);
}
