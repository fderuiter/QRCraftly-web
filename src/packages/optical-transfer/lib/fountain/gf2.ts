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

import { instantiateWasmSync, type WasmInstance } from '@/packages/wasm-runtime';
import { getFountainBcurModuleSync, loadFountainBcurModule, solveGF2Wasm } from './wasmKernel';

const syncModule = getFountainBcurModuleSync();
let gf2WasmInstance: WasmInstance | null = syncModule ? instantiateWasmSync(syncModule) : null;
let gf2WasmPromise: Promise<WasmInstance> | null = null;

function ensureGf2WasmInstance(): Promise<WasmInstance> {
  if (gf2WasmInstance) return Promise.resolve(gf2WasmInstance);
  return (gf2WasmPromise ??= loadFountainBcurModule().then((m) => {
    gf2WasmInstance = instantiateWasmSync(m);
    return gf2WasmInstance;
  }));
}

if (typeof __FOUNDRY_FOUNTAIN_BCUR__ !== 'undefined' && __FOUNDRY_FOUNTAIN_BCUR__ === 'wasm') {
  void ensureGf2WasmInstance();
}

/**
 * A linear equation over GF(2): the XOR of the listed source blocks equals `data`.
 */
export interface GF2Equation {
  columns: number[];
  data: Uint8Array;
}

/**
 * Result of a Gauss-Jordan elimination pass.
 */
export interface GF2Solution {
  /** Source blocks that were fully determined, keyed by block index. */
  solved: Map<number, Uint8Array>;
  /** Remaining independent equations (in reduced row echelon form) that still mix unknowns. */
  residual: GF2Equation[];
  /** Rank of the equation system over the supplied unknowns. */
  rank: number;
}

/**
 * Solves a system of XOR equations by Gauss-Jordan elimination over GF(2).
 * Used as the fallback when belief-propagation peeling stalls on a stopping
 * set (every pending droplet still mixes two or more unknown blocks).
 *
 * Coefficients are packed into 32-bit words, so each row operation costs
 * O(unknowns / 32 + blockSize).
 * @param equations Equations whose columns are all members of `unknowns`.
 * @param unknowns The unresolved source block indices.
 * @param blockSize Byte length of every equation payload.
 * @returns Determined blocks, residual independent equations and the system rank.
 */
export function solveGF2(equations: GF2Equation[], unknowns: number[], blockSize: number): GF2Solution {
  if (__FOUNDRY_FOUNTAIN_BCUR__ === 'wasm') {
    if (!gf2WasmInstance) {
      const syncModule = getFountainBcurModuleSync();
      if (syncModule) gf2WasmInstance = instantiateWasmSync(syncModule);
    }
    if (gf2WasmInstance) {
      return solveGF2Wasm(gf2WasmInstance, equations, unknowns, blockSize);
    }
  }
  const width = unknowns.length;
  const words = Math.ceil(width / 32);
  const position = new Map<number, number>();
  unknowns.forEach((col, i) => position.set(col, i));

  const rows: Uint32Array[] = [];
  const payloads: Uint8Array[] = [];
  for (const eq of equations) {
    const bits = new Uint32Array(words);
    let nonZero = false;
    for (const col of eq.columns) {
      const p = position.get(col);
      if (p === undefined) continue;
      bits[p >>> 5] ^= 1 << (p & 31);
      nonZero = true;
    }
    if (!nonZero) continue;
    rows.push(bits);
    const payload = new Uint8Array(blockSize);
    payload.set(eq.data.subarray(0, blockSize));
    payloads.push(payload);
  }

  const pivotColumns: number[] = [];
  let rank = 0;
  for (let c = 0; c < width && rank < rows.length; c++) {
    const word = c >>> 5;
    const mask = 1 << (c & 31);
    let pivot = -1;
    for (let r = rank; r < rows.length; r++) {
      if (rows[r][word] & mask) {
        pivot = r;
        break;
      }
    }
    if (pivot === -1) continue;

    if (pivot !== rank) {
      const tmpRow = rows[pivot];
      rows[pivot] = rows[rank];
      rows[rank] = tmpRow;
      const tmpData = payloads[pivot];
      payloads[pivot] = payloads[rank];
      payloads[rank] = tmpData;
    }

    const pivotRow = rows[rank];
    const pivotData = payloads[rank];
    for (let r = 0; r < rows.length; r++) {
      if (r === rank || !(rows[r][word] & mask)) continue;
      const row = rows[r];
      for (let w = word; w < words; w++) row[w] ^= pivotRow[w];
      const data = payloads[r];
      for (let b = 0; b < blockSize; b++) data[b] ^= pivotData[b];
    }
    pivotColumns.push(c);
    rank += 1;
  }

  const solved = new Map<number, Uint8Array>();
  const residual: GF2Equation[] = [];
  for (let r = 0; r < rank; r++) {
    const columns: number[] = [];
    const row = rows[r];
    for (let w = 0; w < words; w++) {
      let bits = row[w];
      while (bits !== 0) {
        const low = bits & -bits;
        columns.push(unknowns[(w << 5) + 31 - Math.clz32(low)]);
        bits ^= low;
      }
    }
    if (columns.length === 1) {
      solved.set(unknowns[pivotColumns[r]], payloads[r]);
    } else {
      residual.push({ columns, data: payloads[r] });
    }
  }

  return { solved, residual, rank };
}
