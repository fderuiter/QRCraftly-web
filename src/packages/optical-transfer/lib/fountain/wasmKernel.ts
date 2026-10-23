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

import { compileWasmUrl, instantiateWasmSync, WasmInstance } from '@/packages/wasm-runtime';
import type { GF2Equation, GF2Solution } from './gf2';
import type { DropletMetadata } from './contracts';
import type { BcUrIngest, BcUrResult, BcUrContent } from '../bcur/decoder';
import { cborDecode } from './cbor';

const FOUNTAIN_BCUR_WASM_URL = new URL('../../../../wasm/fountain-bcur.wasm', import.meta.url);

function moduleUrl(): URL {
  const here = import.meta.url;
  return here.startsWith('file:') ? new URL('../../../../wasm/fountain-bcur.wasm', here) : FOUNTAIN_BCUR_WASM_URL;
}

/** Compiles the fountain-bcur WebAssembly module once. */
export function loadFountainBcurModule(): Promise<WebAssembly.Module> {
  return compileWasmUrl(moduleUrl());
}

/** Solves a GF(2) equation system using the compiled WebAssembly kernel. */
export function solveGF2Wasm(
  instance: WasmInstance,
  equations: GF2Equation[],
  unknowns: number[],
  blockSize: number
): GF2Solution {
  const solverNew = instance.fn('fountain_gf2_solver_new');
  const addEq = instance.fn('fountain_gf2_solver_add_eq');
  const solve = instance.fn('fountain_gf2_solver_solve');
  const solvedCountFn = instance.fn('fountain_gf2_solver_solved_count');
  const solvedKeyFn = instance.fn('fountain_gf2_solver_get_solved_key');
  const solvedDataFn = instance.fn('fountain_gf2_solver_get_solved_data');
  const residualCountFn = instance.fn('fountain_gf2_solver_residual_count');
  const residualColsPtrFn = instance.fn('fountain_gf2_solver_get_residual_cols_ptr');
  const residualColsLenFn = instance.fn('fountain_gf2_solver_get_residual_cols_len');
  const residualDataFn = instance.fn('fountain_gf2_solver_get_residual_data');
  const solverFree = instance.fn('fountain_gf2_solver_free');

  const solver = solverNew(blockSize) >>> 0;
  try {
    for (const eq of equations) {
      const u32Cols = new Uint32Array(eq.columns);
      const colsByteView = new Uint8Array(u32Cols.buffer, u32Cols.byteOffset, u32Cols.byteLength);
      instance.withBytes(colsByteView, (colsPtr) => {
        instance.withBytes(eq.data, (dataPtr, dataLen) => {
          addEq(solver, colsPtr, eq.columns.length, dataPtr, dataLen);
        });
      });
    }

    const u32Unknowns = new Uint32Array(unknowns);
    const unkByteView = new Uint8Array(u32Unknowns.buffer, u32Unknowns.byteOffset, u32Unknowns.byteLength);
    const rank = instance.withBytes(unkByteView, (unkPtr) => {
      return solve(solver, unkPtr, unknowns.length) >>> 0;
    });

    const solved = new Map<number, Uint8Array>();
    const count = solvedCountFn(solver) >>> 0;
    for (let i = 0; i < count; i++) {
      const key = solvedKeyFn(solver, i) >>> 0;
      const dataPtr = solvedDataFn(solver, i) >>> 0;
      const data = instance.read(dataPtr, blockSize);
      solved.set(key, data);
    }

    const residual: GF2Equation[] = [];
    const resCount = residualCountFn(solver) >>> 0;
    for (let i = 0; i < resCount; i++) {
      const colsLen = residualColsLenFn(solver, i) >>> 0;
      const colsPtr = residualColsPtrFn(solver, i) >>> 0;
      const dataPtr = residualDataFn(solver, i) >>> 0;

      const rawColsBytes = instance.read(colsPtr, colsLen * 4);
      const cols = Array.from(new Uint32Array(rawColsBytes.buffer, rawColsBytes.byteOffset, colsLen));
      const data = instance.read(dataPtr, blockSize);
      residual.push({ columns: cols, data });
    }

    return { solved, residual, rank };
  } finally {
    solverFree(solver);
  }
}

/** WebAssembly-backed Fountain Decoder. */
export class WasmFountainDecoder {
  private readonly instance: WasmInstance;
  private readonly handle: number;
  private readonly ingestDropletFn: (handle: number, seq: number, ptr: number, len: number) => number;
  private readonly ingestEqFn: (handle: number, idxPtr: number, idxLen: number, dataPtr: number, dataLen: number) => number;
  private readonly progressFn: (handle: number) => number;
  private readonly rankFn: (handle: number) => number;
  private readonly isCompleteFn: (handle: number) => number;
  private readonly finalizeFn: (handle: number) => number;
  private readonly finalizeLenFn: (handle: number) => number;
  private readonly resetFn: (handle: number) => void;
  private readonly freeFn: (handle: number) => void;

  public k: number;
  public messageLength: number;
  public checksum: number;
  public blockSize: number;

  constructor(module: WebAssembly.Module, k: number, messageLength: number, checksum: number, blockSize: number) {
    this.k = k;
    this.messageLength = messageLength;
    this.checksum = checksum;
    this.blockSize = blockSize;

    this.instance = instantiateWasmSync(module);
    const create = this.instance.fn('fountain_decoder_new');
    this.handle = create(k, messageLength, checksum >>> 0, blockSize) >>> 0;

    this.ingestDropletFn = this.instance.fn('fountain_decoder_ingest_droplet');
    this.ingestEqFn = this.instance.fn('fountain_decoder_ingest_equation');
    this.progressFn = this.instance.fn('fountain_decoder_progress');
    this.rankFn = this.instance.fn('fountain_decoder_rank');
    this.isCompleteFn = this.instance.fn('fountain_decoder_is_complete');
    this.finalizeFn = this.instance.fn('fountain_decoder_finalize');
    this.finalizeLenFn = this.instance.fn('fountain_decoder_finalize_len');
    this.resetFn = this.instance.fn('fountain_decoder_reset');
    this.freeFn = this.instance.fn('fountain_decoder_free');
  }

  public get progress(): number {
    return this.progressFn(this.handle) >>> 0;
  }

  public get rank(): number {
    return this.rankFn(this.handle) >>> 0;
  }

  public get isComplete(): boolean {
    return this.isCompleteFn(this.handle) === 1;
  }

  public ingest(meta: DropletMetadata, data: Uint8Array): boolean {
    return this.instance.withBytes(data, (ptr, len) => {
      return this.ingestDropletFn(this.handle, meta.seq >>> 0, ptr, len) === 1;
    });
  }

  public ingestEquation(indices: number[], data: Uint8Array): boolean {
    const u32 = new Uint32Array(indices);
    const view = new Uint8Array(u32.buffer, u32.byteOffset, u32.byteLength);
    return this.instance.withBytes(view, (idxPtr) => {
      return this.instance.withBytes(data, (dataPtr, dataLen) => {
        return this.ingestEqFn(this.handle, idxPtr, indices.length, dataPtr, dataLen) === 1;
      });
    });
  }

  public finalize(): Uint8Array | null {
    const ptr = this.finalizeFn(this.handle) >>> 0;
    if (ptr === 0) return null;
    const len = this.finalizeLenFn(this.handle) >>> 0;
    return this.instance.read(ptr, len);
  }

  public reset(): void {
    this.resetFn(this.handle);
  }

  public free(): void {
    this.freeFn(this.handle);
  }
}

/** WebAssembly Bytewords minimal encoder & decoder. */
export function encodeBytewordsMinimalWasm(instance: WasmInstance, bytes: Uint8Array): string {
  const encodeFn = instance.fn('bytewords_encode_minimal_c');
  const cap = (bytes.length + 4) * 2;
  const outBuf = instance.alloc(cap);
  const writtenPtr = instance.alloc(4);
  try {
    instance.withBytes(bytes, (inPtr, inLen) => {
      const status = encodeFn(inPtr, inLen, outBuf, cap, writtenPtr);
      if (status !== 0) throw new Error(`bytewords_encode_minimal_c failed: status ${status}`);
    });
    const writtenView = new DataView(instance.memory.buffer, writtenPtr, 4);
    const written = writtenView.getUint32(0, true);
    const rawStr = instance.read(outBuf, written);
    return new TextDecoder('ascii').decode(rawStr);
  } finally {
    instance.free(outBuf, cap);
    instance.free(writtenPtr, 4);
  }
}

export function decodeBytewordsMinimalWasm(instance: WasmInstance, text: string): Uint8Array | null {
  const textBytes = new TextEncoder().encode(text);
  const decodeFn = instance.fn('bytewords_decode_minimal_c');
  const cap = textBytes.length;
  const outBuf = instance.alloc(cap);
  const writtenPtr = instance.alloc(4);
  try {
    let status = 0;
    instance.withBytes(textBytes, (inPtr, inLen) => {
      status = decodeFn(inPtr, inLen, outBuf, cap, writtenPtr);
    });
    if (status !== 0) return null;
    const writtenView = new DataView(instance.memory.buffer, writtenPtr, 4);
    const written = writtenView.getUint32(0, true);
    return instance.read(outBuf, written);
  } finally {
    instance.free(outBuf, cap);
    instance.free(writtenPtr, 4);
  }
}

/** WebAssembly-backed BC-UR Decoder. */
export class WasmBcUrDecoder {
  private readonly instance: WasmInstance;
  private readonly handle: number;
  private readonly ingestFn: (handle: number, ptr: number, len: number) => number;
  private readonly progressFn: (handle: number) => number;
  private readonly receivedFn: (handle: number) => number;
  private readonly seqLenFn: (handle: number) => number;
  private readonly resPtrFn: (handle: number) => number;
  private readonly resLenFn: (handle: number) => number;
  private readonly resKindFn: (handle: number) => number;
  private readonly typePtrFn: (handle: number) => number;
  private readonly typeLenFn: (handle: number) => number;
  private readonly resetFn: (handle: number) => void;
  private readonly freeFn: (handle: number) => void;

  constructor(module: WebAssembly.Module) {
    this.instance = instantiateWasmSync(module);
    this.handle = this.instance.fn('bcur_decoder_new')() >>> 0;

    this.ingestFn = this.instance.fn('bcur_decoder_ingest_str');
    this.progressFn = this.instance.fn('bcur_decoder_progress');
    this.receivedFn = this.instance.fn('bcur_decoder_received_count');
    this.seqLenFn = this.instance.fn('bcur_decoder_seq_len');
    this.resPtrFn = this.instance.fn('bcur_decoder_result_ptr');
    this.resLenFn = this.instance.fn('bcur_decoder_result_len');
    this.resKindFn = this.instance.fn('bcur_decoder_result_kind');
    this.typePtrFn = this.instance.fn('bcur_decoder_ur_type_ptr');
    this.typeLenFn = this.instance.fn('bcur_decoder_ur_type_len');
    this.resetFn = this.instance.fn('bcur_decoder_reset');
    this.freeFn = this.instance.fn('bcur_decoder_free');
  }

  public get progress(): number {
    return this.progressFn(this.handle);
  }

  public ingest(text: string): BcUrIngest {
    const textBytes = new TextEncoder().encode(text);
    const code = this.instance.withBytes(textBytes, (ptr, len) => {
      return this.ingestFn(this.handle, ptr, len);
    });

    if (code === 0) return { status: 'rejected' };
    if (code === 1) {
      const typePtr = this.typePtrFn(this.handle) >>> 0;
      const typeLen = this.typeLenFn(this.handle) >>> 0;
      const type = new TextDecoder().decode(this.instance.read(typePtr, typeLen));
      return {
        status: 'progress',
        type,
        received: this.receivedFn(this.handle) >>> 0,
        total: this.seqLenFn(this.handle) >>> 0,
      };
    }
    if (code === 2) {
      const typePtr = this.typePtrFn(this.handle) >>> 0;
      const typeLen = this.typeLenFn(this.handle) >>> 0;
      const type = new TextDecoder().decode(this.instance.read(typePtr, typeLen));

      const resPtr = this.resPtrFn(this.handle) >>> 0;
      const resLen = this.resLenFn(this.handle) >>> 0;
      const cbor = this.instance.read(resPtr, resLen);

      const kindNum = this.resKindFn(this.handle) >>> 0;
      let content: BcUrContent = { kind: 'cbor', bytes: cbor };
      if (kindNum === 0) {
        try {
          const val = cborDecode(cbor);
          if (val instanceof Uint8Array) content = { kind: 'file', bytes: val };
        } catch {
          // Fallback
        }
      } else if (kindNum === 1) {
        try {
          const val = cborDecode(cbor);
          if (typeof val === 'string') content = { kind: 'text', text: val };
        } catch {
          // Fallback
        }
      }

      const result: BcUrResult = { type, cbor, content };
      return { status: 'complete', result };
    }
    return { status: 'failed', reason: 'checksum mismatch' };
  }

  public reset(): void {
    this.resetFn(this.handle);
  }

  public free(): void {
    this.freeFn(this.handle);
  }
}
