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
 */

import {
  WASM_STATUS,
  WasmModuleError,
  compileWasmUrl,
  instantiateWasm,
  instantiateWasmSync,
  type WasmInstance,
} from '@/packages/wasm-runtime';

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

/** The module's URL in a build: Vite emits the file as an asset next to the bundle. */
export const OPTICAL_SIM_WASM_URL = new URL('../../../wasm/optical-sim.wasm', import.meta.url);

function moduleUrl(): URL {
  const here = import.meta.url;
  return here.startsWith('file:') ? new URL('../../../wasm/optical-sim.wasm', here) : OPTICAL_SIM_WASM_URL;
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

export interface OpticalSim {
  simulatePrint(frame: PixelFrame, placement: PrintPlacement, scratch?: OpticalScratchBuffers): GreyFrame;
}

/** Wraps an instance of the module. The returned simulation kernel is synchronous. */
export function createOpticalSim(instance: WasmInstance): OpticalSim {
  const simulate = instance.fn('simulate_print');
  const outputSide = instance.fn('optical_sim_output_side');
  const outputCapacity = instance.fn('optical_sim_output_capacity');

  return {
    simulatePrint(frame, placement, scratch = {}) {
      const { corners, version } = placement;
      const [tl, tr, br, bl] = corners;
      const side = outputSide(version) >>> 0;
      const capacity = outputCapacity(version) >>> 0;

      const frameBytes =
        frame.data instanceof Uint8Array
          ? frame.data
          : new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.length);

      return instance.withBytes(frameBytes, (framePtr) => {
        const outPtr = instance.alloc(capacity);
        try {
          const status = simulate(
            framePtr,
            frame.width,
            frame.height,
            version,
            tl.x,
            tl.y,
            tr.x,
            tr.y,
            br.x,
            br.y,
            bl.x,
            bl.y,
            outPtr,
            capacity,
          );
          if (status !== WASM_STATUS.OK) {
            throw new WasmModuleError('status', `simulate_print failed with status ${status}.`);
          }
          const resultBytes = instance.read(outPtr, capacity);
          if (scratch.grey && scratch.grey.length === capacity) {
            scratch.grey.set(resultBytes);
            return { data: scratch.grey, width: side, height: side };
          }
          const grey = new Uint8ClampedArray(resultBytes.buffer, resultBytes.byteOffset, resultBytes.byteLength);
          scratch.grey = grey;
          return { data: grey, width: side, height: side };
        } finally {
          instance.free(outPtr, capacity);
        }
      });
    },
  };
}

let activeInstance: OpticalSim | null = null;
let loading: Promise<OpticalSim> | null = null;

function ensureSyncInstance(): OpticalSim {
  if (activeInstance) return activeInstance;
  const url = moduleUrl();
  const proc: unknown = Reflect.get(globalThis, 'process');
  if (typeof proc === 'object' && proc !== null) {
    const getBuiltinModule: unknown = Reflect.get(proc, 'getBuiltinModule');
    if (typeof getBuiltinModule === 'function') {
      const fs: unknown = Reflect.apply(getBuiltinModule, proc, ['node:fs']);
      if (typeof fs === 'object' && fs !== null) {
        const readFileSync: unknown = Reflect.get(fs, 'readFileSync');
        if (typeof readFileSync === 'function') {
          const raw: unknown = Reflect.apply(readFileSync, fs, [url]);
          if (ArrayBuffer.isView(raw)) {
            const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
            const module = new WebAssembly.Module(bytes);
            activeInstance = createOpticalSim(instantiateWasmSync(module));
            return activeInstance;
          }
        }
      }
    }
  }
  throw new WasmModuleError('load', 'The optical simulation WASM module is not loaded.');
}

/** Loads the optical simulation WASM module once per page or worker. */
export function loadOpticalSim(): Promise<OpticalSim> {
  if (!loading) {
    loading = compileWasmUrl(moduleUrl())
      .then(instantiateWasm)
      .then((instance) => {
        activeInstance = createOpticalSim(instance);
        return activeInstance;
      })
      .catch((error: unknown) => {
        loading = null;
        throw error instanceof WasmModuleError
          ? error
          : new WasmModuleError('compile', 'The optical simulation module did not load.', { cause: error });
      });
  }
  return loading;
}

/**
 * Simulates a phone camera looking at a print of the code.
 * Delegates frame calculation to the Rust WebAssembly kernel in `optical-sim.wasm`.
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
  const instance = activeInstance ?? ensureSyncInstance();
  return instance.simulatePrint(frame, placement, scratch);
}
