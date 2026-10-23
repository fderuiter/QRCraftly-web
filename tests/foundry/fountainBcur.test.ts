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

import { describe, expect, it } from 'vitest';
import { solveGF2, type GF2Equation } from '@/packages/optical-transfer/lib/fountain/gf2';
import { FountainDecoder } from '@/packages/optical-transfer/lib/fountain/decoder';
import { FountainEncoder } from '@/packages/optical-transfer/lib/fountain/encoder';
import { decodeBytewordsMinimal, encodeBytewordsMinimal } from '@/packages/optical-transfer/lib/fountain/bytewords';
import { BcUrDecoder } from '@/packages/optical-transfer/lib/bcur/decoder';
import { BcUrEncoder } from '@/packages/optical-transfer/lib/bcur/encoder';
import {
  loadCommittedModule,
  runDifferential,
  seededBytes,
} from './differential';
import {
  solveGF2Wasm,
  WasmFountainDecoder,
  encodeBytewordsMinimalWasm,
  decodeBytewordsMinimalWasm,
  WasmBcUrDecoder,
  loadFountainBcurModule,
} from '@/packages/optical-transfer/lib/fountain/wasmKernel';
import { instantiateWasm, compileWasmBytes } from '@/packages/wasm-runtime';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WASM_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/wasm/fountain-bcur.wasm');

describe('fountain-bcur WebAssembly kernel', () => {
  it('passes GF2 matrix elimination differential test', async () => {
    const instance = await loadCommittedModule('fountain-bcur');

    const inputs: Array<{ equations: GF2Equation[]; unknowns: number[]; blockSize: number }> = [];

    // System 1: Simple 2x2
    inputs.push({
      equations: [
        { columns: [0, 1], data: new Uint8Array([0x03, 0x0f]) },
        { columns: [1], data: new Uint8Array([0x01, 0x05]) },
      ],
      unknowns: [0, 1],
      blockSize: 2,
    });

    // System 2: 4 unknowns with stopping set
    inputs.push({
      equations: [
        { columns: [0, 1], data: new Uint8Array([10, 20, 30, 40]) },
        { columns: [1, 2], data: new Uint8Array([5, 15, 25, 35]) },
        { columns: [2, 3], data: new Uint8Array([1, 2, 3, 4]) },
        { columns: [0, 3], data: new Uint8Array([14, 21, 28, 35]) },
      ],
      unknowns: [0, 1, 2, 3],
      blockSize: 4,
    });

    const report = runDifferential({
      name: 'GF2 Gauss-Jordan Elimination',
      inputs,
      candidate: (input) => {
        const res = solveGF2Wasm(instance, input.equations, input.unknowns, input.blockSize);
        return JSON.stringify({
          rank: res.rank,
          solved: Array.from(res.solved.entries()).map(([k, v]) => [k, Array.from(v)]),
          residualCount: res.residual.length,
        });
      },
      reference: (input) => {
        const res = solveGF2(input.equations, input.unknowns, input.blockSize);
        return JSON.stringify({
          rank: res.rank,
          solved: Array.from(res.solved.entries()).map(([k, v]) => [k, Array.from(v)]),
          residualCount: res.residual.length,
        });
      },
    });

    if (report.mismatchCount > 0) {
      console.dir(report.mismatches, { depth: null });
    }
    expect(report.mismatchCount).toBe(0);
  });

  it('passes Bytewords minimal encode/decode differential test', async () => {
    const instance = await loadCommittedModule('fountain-bcur');
    const byteInputs = Array.from(seededBytes(12345, 20, 64));

    const encodeReport = runDifferential({
      name: 'Bytewords Encode Minimal',
      inputs: byteInputs,
      candidate: (buf) => encodeBytewordsMinimalWasm(instance, buf),
      reference: (buf) => encodeBytewordsMinimal(buf),
    });
    expect(encodeReport.mismatchCount).toBe(0);

    const stringInputs = byteInputs.map((buf) => encodeBytewordsMinimal(buf));
    const decodeReport = runDifferential({
      name: 'Bytewords Decode Minimal',
      inputs: stringInputs,
      candidate: (str) => decodeBytewordsMinimalWasm(instance, str),
      reference: (str) => decodeBytewordsMinimal(str),
    });
    expect(decodeReport.mismatchCount).toBe(0);
  });

  it('passes FountainDecoder differential test', async () => {
    const bytes = new Uint8Array(fs.readFileSync(WASM_PATH));
    const module = await compileWasmBytes(bytes);

    const message = new Uint8Array(256);
    for (let i = 0; i < message.length; i++) message[i] = (i * 17) % 251;

    const encoder = new FountainEncoder(message, { targetBlockSize: 32 });
    const droplets = Array.from({ length: encoder.k * 2 }, (_, i) => encoder.nextDroplet(i + 1));

    const tsDecoder = new FountainDecoder();
    const wasmDecoder = new WasmFountainDecoder(module, encoder.k, message.length, encoder.checksum, encoder.blockSize);

    for (const droplet of droplets) {
      tsDecoder.ingest(droplet, droplet.data);
      wasmDecoder.ingest(droplet, droplet.data);

      expect(wasmDecoder.progress).toBe(tsDecoder.progress);
      expect(wasmDecoder.rank).toBe(tsDecoder.rank);
      expect(wasmDecoder.isComplete).toBe(tsDecoder.isComplete);
    }

    expect(wasmDecoder.isComplete).toBe(true);
    expect(wasmDecoder.finalize()).toEqual(tsDecoder.finalize());
  });

  it('passes BcUrDecoder differential test for single and multipart streams', async () => {
    const bytes = new Uint8Array(fs.readFileSync(WASM_PATH));
    const module = await compileWasmBytes(bytes);

    const filePayload = new Uint8Array(500);
    for (let i = 0; i < filePayload.length; i++) filePayload[i] = (i * 31) % 256;

    const encoder = BcUrEncoder.forBytes(filePayload, 80);
    const parts: string[] = [];
    for (let i = 0; i < encoder.fragmentCount * 2; i++) {
      parts.push(encoder.nextPart());
    }

    const tsDecoder = new BcUrDecoder();
    const wasmDecoder = new WasmBcUrDecoder(module);

    for (const part of parts) {
      const tsStatus = tsDecoder.ingest(part);
      const wasmStatus = wasmDecoder.ingest(part);

      expect(wasmStatus.status).toBe(tsStatus.status);
      expect(wasmDecoder.progress).toBeCloseTo(tsDecoder.progress, 5);

      if (wasmStatus.status === 'complete' && tsStatus.status === 'complete') {
        expect(wasmStatus.result.type).toBe(tsStatus.result.type);
        expect(wasmStatus.result.cbor).toEqual(tsStatus.result.cbor);
        expect(wasmStatus.result.content).toEqual(tsStatus.result.content);
      }
    }
  });

  it('compiles fountain-bcur WASM module via loadFountainBcurModule', async () => {
    const module = await loadFountainBcurModule();
    expect(module).toBeInstanceOf(WebAssembly.Module);
  });
});
