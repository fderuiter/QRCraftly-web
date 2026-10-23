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

import {
  WASM_STATUS,
  WasmModuleError,
  compileWasmUrl,
  instantiateWasm,
  instantiateWasmSync,
  type WasmInstance,
} from '@/packages/wasm-runtime';
import {
  setOpticalSimKernel,
  type GreyFrame,
  type OpticalScratchBuffers,
  type PixelFrame,
  type PrintPlacement,
} from './opticalSimulation';

export interface OpticalSim {
  simulatePrint(frame: PixelFrame, placement: PrintPlacement, scratch?: OpticalScratchBuffers): GreyFrame;
}

/** The module's URL in a build: Vite emits the file as an asset next to the bundle. */
export const OPTICAL_SIM_WASM_URL = new URL('../../../wasm/optical-sim.wasm', import.meta.url);

function moduleUrl(): URL {
  const here = import.meta.url;
  return here.startsWith('file:') ? new URL('../../../wasm/optical-sim.wasm', here) : OPTICAL_SIM_WASM_URL;
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

export function ensureSyncInstance(): OpticalSim {
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
            setOpticalSimKernel(activeInstance);
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
    loading = Promise.resolve()
      .then(() => {
        try {
          return ensureSyncInstance();
        } catch {
          return compileWasmUrl(moduleUrl())
            .then(instantiateWasm)
            .then((instance) => {
              activeInstance = createOpticalSim(instance);
              setOpticalSimKernel(activeInstance);
              return activeInstance;
            });
        }
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
