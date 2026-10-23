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
 * Heavy WebAssembly kernel entry point for optical simulation.
 * Isolated into its own entry point so generator pages importing `@/packages/scannability`
 * do not pull the WASM runtime or `.wasm` asset reference into their first-load bundle.
 */
export {
  loadOpticalSim,
  createOpticalSim,
  OPTICAL_SIM_WASM_URL,
  type OpticalSim,
} from './lib/opticalSimKernel';
export {
  simulatePrintTs,
} from './lib/opticalSimulation';
