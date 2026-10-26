/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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
 * The loader for the optical print simulation's Rust port (`crates/optical-sim`, #1556). The
 * Scannability Worker imports it (the worker is its own on-demand bundle) and the main-thread
 * check reaches it through a dynamic import in `scanCheck.ts`. It is not exported from the
 * package root, so neither it nor the module's URL is in any page's first load.
 */
import { WasmModuleError, checkStatus, compileWasmUrl, instantiateWasm, wasmModuleUrl, type WasmInstance } from '@/packages/wasm-runtime';
import { printTaps, scratchGrey, type PrintKernel } from './opticalSimulation';
import { installPrintKernel } from './printKernel';

/** The module's URL in a build: Vite emits the file as an asset next to the bundle. */
const OPTICAL_SIM_WASM_URL = new URL('../../../wasm/optical-sim.wasm', import.meta.url);

/**
 * Wraps an instance of the module as a {@link PrintKernel}.
 * @param instance - The instantiated `optical-sim` module.
 * @returns The simulation; it throws a `WasmModuleError` when the module refuses the input.
 */
export function createPrintKernel(instance: WasmInstance): PrintKernel {
  const sideOf = instance.fn('optical_sim_side');
  const print = instance.fn('optical_sim_print');
  return (frame, placement, scratch = {}) => {
    const side = sideOf(placement.version) >>> 0;
    if (side === 0) throw new WasmModuleError('status', `optical_sim_side refused version ${placement.version}.`);
    const [tl, tr, br, bl] = placement.corners;
    const taps = printTaps(placement);
    // The TypeScript reads width × height pixels and ignores anything after them; so does this.
    const rgba = new Uint8Array(frame.data.buffer, frame.data.byteOffset, Math.min(frame.data.byteLength, frame.width * frame.height * 4));
    const bytes = instance.withBytes(rgba, (ptr, len) =>
      instance.withOutput(side * side, (out, outLen) => {
        const status = print(ptr, len, frame.width, frame.height, placement.version, taps, tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y, out, outLen);
        checkStatus(status, 'optical_sim_print');
      })
    );
    const grey = scratchGrey(scratch, side * side);
    grey.set(bytes);
    return { data: grey, width: side, height: side };
  };
}

let loading: Promise<PrintKernel> | null = null;

/**
 * Fetches, compiles and instantiates the module once per page or worker. A failed load is
 * forgotten, so a later call retries.
 * @returns The simulation.
 */
export function loadPrintKernel(): Promise<PrintKernel> {
  loading ??= compileWasmUrl(wasmModuleUrl(OPTICAL_SIM_WASM_URL, 'optical-sim.wasm'))
    .then(instantiateWasm)
    .then(createPrintKernel)
    .catch((error: unknown) => {
      loading = null;
      throw error instanceof WasmModuleError ? error : new WasmModuleError('compile', 'The optical simulation did not load.', { cause: error });
    });
  return loading;
}

/**
 * Makes the checks run the Rust port from now on, once it loads.
 * @returns Whether the port is in use: false when it could not load (the TypeScript runs instead).
 */
export function enablePrintKernel(): Promise<boolean> {
  return installPrintKernel(loadPrintKernel);
}
