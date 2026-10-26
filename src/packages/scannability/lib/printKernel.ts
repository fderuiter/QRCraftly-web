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
 * Which print simulation the checks run (#1556): the Rust port (`crates/optical-sim`) once
 * {@link installPrintKernel} has loaded it, and the TypeScript reference (`opticalSimulation.ts`)
 * until then or when it cannot load. The Scannability Worker and the main-thread check enable it
 * before their first check. Both give the same bytes (`tests/foundry/opticalSim.test.ts`).
 */
import { simulatePrint, type GreyFrame, type OpticalScratchBuffers, type PixelFrame, type PrintKernel, type PrintPlacement } from './opticalSimulation';

let kernel: PrintKernel | null = null;
let kernelLoading: Promise<boolean> | null = null;

/**
 * Loads the Rust port once and makes {@link runPrintSimulation} use it. If the module does not
 * load, the TypeScript keeps running and the next call tries again. Callers reach this through
 * `enablePrintKernel` in `opticalSimKernel.ts`, which passes the loader in: the Scannability
 * Worker's bundle cannot split, so this file must not import the loader itself.
 * @param load - Loads the port.
 * @returns Whether the port is in use: true once it is, false when loading it failed.
 */
export function installPrintKernel(load: () => Promise<PrintKernel>): Promise<boolean> {
  kernelLoading ??= load()
    .then((loaded) => {
      kernel = loaded;
      return true;
    })
    .catch(() => {
      kernelLoading = null;
      return false;
    });
  return kernelLoading;
}

/** Goes back to the TypeScript simulation. Tests only. */
export function resetPrintKernelForTests(): void {
  kernel = null;
  kernelLoading = null;
}

/**
 * Simulates a phone camera looking at a print of the code, with the Rust port once
 * {@link installPrintKernel} has loaded it and the TypeScript `simulatePrint` until then.
 * @param frame - The rendered design (RGBA).
 * @param placement - Where a decode of `frame` found the code.
 * @param scratch - Optional reusable buffers; filled in on first use.
 * @returns The simulated camera frame, grey, six pixels a module, with the quiet zone.
 */
export function runPrintSimulation(frame: PixelFrame, placement: PrintPlacement, scratch: OpticalScratchBuffers = {}): GreyFrame {
  return (kernel ?? simulatePrint)(frame, placement, scratch);
}
