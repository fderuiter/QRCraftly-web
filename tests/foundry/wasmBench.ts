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

/**
 * Measures our Rust modules (#1182, ADR 0033): size, cold start (compile plus instantiate) and the
 * time per call of each export a module's issue cares about. `pnpm run bench:wasm` prints it and
 * can write it as JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { compileWasmBytes, instantiateWasm, type WasmInstance } from '../../src/packages/wasm-runtime/index';
import { committedModuleNames } from '../../scripts/utils/rustWorkspace.js';
import { qrEncoder } from '../fixtures/qrEncoder';
import { decodeRequest, prepareDecode, renderGrid } from './qrDecodeModule';

const WASM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/wasm');

export interface WasmBenchCall {
  name: string;
  /** Sets up inputs once and returns the call to time. */
  prepare(instance: WasmInstance): () => void;
}

/** Seeded grey noise: the frame a camera sees between codes. */
const NOISE_1080P = new Uint8Array(1920 * 1080).map((_, i) => (Math.imul(i, 2654435761) >>> 24) & 0xff);

const FOUR_KB = new Uint8Array(4096).map((_, i) => (i * 31 + 7) & 0xff);

/** The calls timed for each module. A module without an entry reports only size and cold start. */
export const BENCH_CALLS: Record<string, WasmBenchCall[]> = {
  selftest: [
    {
      name: 'crc32 4 KB',
      prepare(instance) {
        const crc = instance.fn('selftest_crc32');
        const ptr = instance.alloc(FOUR_KB.length);
        instance.write(ptr, FOUR_KB);
        return () => crc(ptr, FOUR_KB.length);
      },
    },
    {
      name: 'gf_mul',
      prepare(instance) {
        const mul = instance.fn('selftest_gf_mul');
        return () => mul(0x53, 0xca);
      },
    },
    {
      name: 'scale 4 KB',
      prepare(instance) {
        const scale = instance.fn('selftest_scale');
        const input = instance.alloc(FOUR_KB.length);
        const output = instance.alloc(FOUR_KB.length);
        instance.write(input, FOUR_KB);
        return () => scale(input, FOUR_KB.length, 0x1d, output, FOUR_KB.length);
      },
    },
  ],
  'qr-encode': [
    {
      name: 'encode URL (M)',
      prepare: (instance) => prepareEncode(instance, 1, 'https://qrcraftly.com/menu?table=12'),
    },
    {
      name: 'encode v40 (L)',
      prepare: (instance) => prepareEncode(instance, 0, 'abcdefghijklmnopqrstuvwxyz'.repeat(114).slice(0, 2953)),
    },
  ],
  'prism-fec': [
    {
      name: 'encode symbol (K 2048, T 64)',
      prepare(instance) {
        const { encoder } = prepareFecEncoder(instance, 2048);
        const symbol = instance.fn('fec_encoder_symbol');
        let esi = 0;
        return () => symbol(encoder, esi++);
      },
    },
    {
      name: 'decode block after a join (K 2048, T 64)',
      prepare: (instance) => prepareFecDecode(instance, 2048),
    },
  ],
  'qr-decode': [
    {
      name: 'blank 1080p frame',
      prepare: (instance) => prepareDecode(instance, decodeRequest(new Uint8Array(1920 * 1080).fill(200), 1920, 1080, 1)),
    },
    {
      name: 'noisy 1080p frame',
      prepare: (instance) => prepareDecode(instance, decodeRequest(NOISE_1080P, 1920, 1080, 1)),
    },
    {
      name: 'noisy 1080p, all passes',
      prepare: (instance) => prepareDecode(instance, decodeRequest(NOISE_1080P, 1920, 1080, 1, 0b1110)),
    },
    {
      name: 'URL code in 640x480',
      prepare: (instance) => prepareDecode(instance, decodeRequest(renderGrid(qrEncoder.create('https://qrcraftly.com/menu?table=12').modules, 6, 640, 480), 640, 480, 1)),
    },
  ],
  modem: [
    {
      name: 'sample P4 grid (160 x 72 cells, 640x360)',
      prepare: (instance) => prepareModemFrame(instance).sample,
    },
    {
      name: 'decode P4 frame, soft (36 blocks)',
      prepare: (instance) => prepareModemFrame(instance).decode,
    },
  ],
};

/**
 * A receiver over a noisy 640x360 picture of P4's grid (crates/modem): the homography and a
 * 16-colour palette are set directly, so the calls time the per-frame kernels, not acquisition.
 */
function prepareModemFrame(instance: WasmInstance): { sample: () => void; decode: () => void } {
  const [cols, rows, dataRows] = [160, 90, 72];
  const rx = instance.fn('modem_rx_new')() >>> 0;
  const image = instance.fn('modem_rx_image')(rx, 640, 360) >>> 0;
  instance.write(
    image,
    new Uint8Array(640 * 360 * 4).map((_, i) => (Math.imul(i >> 6, 2654435761) >>> 24) & 0xff),
  );
  const io = new Float64Array(instance.memory.buffer, instance.fn('modem_rx_io')(rx) >>> 0, 256);
  io.set([3.9, 0.01, 8, -0.01, 3.9, 4, 0.00001, -0.00002, 1], 12);
  for (let s = 0; s < 16; s++) io.set([(s & 1) * 230 + 10, ((s >> 1) & 1) * 230 + 10, ((s >> 2) & 1) * 200 + (s >> 3) * 40], 21 + 3 * s);
  const sample = instance.fn('modem_rx_sample');
  const decode = instance.fn('modem_rx_decode');
  sample(rx, cols, dataRows, 9, 16);
  return {
    sample: () => sample(rx, cols, dataRows, 9, 16),
    decode: () => decode(rx, 4, cols, rows, 80, 80, 1, 1, 32),
  };
}

const FEC_SYMBOL = 64;
const FEC_SEED = 1176;

/** An encoder over a seeded block of `k` symbols (crates/prism-fec). */
function prepareFecEncoder(instance: WasmInstance, k: number): { encoder: number; source: number } {
  const bytes = new Uint8Array(k * FEC_SYMBOL).map((_, i) => (Math.imul(i, 2654435761) >>> 24) & 0xff);
  const source = instance.alloc(bytes.length);
  instance.write(source, bytes);
  const encoder = instance.fn('fec_encoder_new')(k, FEC_SYMBOL, FEC_SEED, source, bytes.length) >>> 0;
  return { encoder, source };
}

/**
 * A whole block decode: a new decoder, symbols from a mid-stream join until it completes, then
 * back-substitution. The symbols are made once, and the encoder is freed so each decode starts
 * from an empty heap.
 */
function prepareFecDecode(instance: WasmInstance, k: number): () => void {
  const { encoder, source } = prepareFecEncoder(instance, k);
  const symbolAt = instance.fn('fec_encoder_symbol');
  const join = 1_000_000;
  const symbols = Array.from({ length: k + 40 }, (_, i) => instance.read(symbolAt(encoder, join + i) >>> 0, FEC_SYMBOL));
  instance.fn('fec_encoder_free')(encoder);
  instance.free(source, k * FEC_SYMBOL);
  const create = instance.fn('fec_decoder_new');
  const inboxOf = instance.fn('fec_decoder_inbox');
  const add = instance.fn('fec_decoder_add');
  const solve = instance.fn('fec_decoder_solve');
  const free = instance.fn('fec_decoder_free');
  return () => {
    const decoder = create(k, FEC_SYMBOL, FEC_SEED) >>> 0;
    const inbox = inboxOf(decoder) >>> 0;
    for (let i = 0; i < symbols.length; i++) {
      instance.write(inbox, symbols[i]);
      if (add(decoder, join + i) === 2) break;
    }
    if (solve(decoder) === 0) throw new Error('the bench block did not decode');
    free(decoder);
  };
}

/** A raw `qr_encode` call with the best mask: level, smallest version, then UTF-8 text (crates/qr-encode). */
function prepareEncode(instance: WasmInstance, level: number, text: string): () => void {
  const encode = instance.fn('qr_encode');
  const request = new Uint8Array([level, 0, 8, 0, ...new TextEncoder().encode(text)]);
  const capacity = instance.fn('qr_output_capacity')(request.length);
  const input = instance.alloc(request.length);
  const output = instance.alloc(capacity);
  instance.write(input, request);
  return () => encode(input, request.length, output, capacity);
}

export interface WasmBenchOptions {
  /** Compiles and instantiations measured for the cold start; the median is reported. */
  coldRuns: number;
  /** How long each call is repeated for. */
  callMs: number;
}

export interface WasmCallResult {
  name: string;
  iterations: number;
  microsPerCall: number;
}

export interface WasmModuleResult {
  module: string;
  bytes: number;
  gzipBytes: number;
  compileMs: number;
  instantiateMs: number;
  calls: WasmCallResult[];
}

export interface WasmBenchReport {
  bench: 'wasm';
  runtime: string;
  options: WasmBenchOptions;
  modules: WasmModuleResult[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/**
 * Warms up with up to 100 calls, then times batches that double up to 100 calls until `callMs`
 * has passed, so a call of tens of milliseconds (a whole camera frame) is not run hundreds of times.
 */
function timeCall(call: () => void, callMs: number): Omit<WasmCallResult, 'name'> {
  const warmStart = performance.now();
  for (let i = 0; i < 100 && (i === 0 || performance.now() - warmStart < callMs); i++) call();
  let iterations = 0;
  let batch = 1;
  const start = performance.now();
  let elapsed = 0;
  while (elapsed < callMs) {
    for (let i = 0; i < batch; i++) call();
    iterations += batch;
    batch = Math.min(batch * 2, 100);
    elapsed = performance.now() - start;
  }
  return { iterations, microsPerCall: round((elapsed * 1000) / iterations) };
}

/** Measures one module from its bytes. */
export async function benchWasmModule(module: string, bytes: Uint8Array, options: WasmBenchOptions, calls = BENCH_CALLS[module] ?? []): Promise<WasmModuleResult> {
  const compileTimes: number[] = [];
  const instantiateTimes: number[] = [];
  let instance: WasmInstance | null = null;
  for (let run = 0; run < Math.max(1, options.coldRuns); run++) {
    const t0 = performance.now();
    const compiled = await compileWasmBytes(bytes);
    const t1 = performance.now();
    instance = await instantiateWasm(compiled);
    const t2 = performance.now();
    compileTimes.push(t1 - t0);
    instantiateTimes.push(t2 - t1);
  }
  if (!instance) throw new Error(`${module} did not instantiate`);
  const loaded = instance;
  return {
    module,
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
    compileMs: round(median(compileTimes)),
    instantiateMs: round(median(instantiateTimes)),
    calls: calls.map((call) => ({ name: call.name, ...timeCall(call.prepare(loaded), options.callMs) })),
  };
}

/** Measures every committed module, or only those named. */
export async function runWasmBench(options: WasmBenchOptions, only: string[] = []): Promise<WasmBenchReport> {
  const names = committedModuleNames(WASM_DIR).filter((name) => only.length === 0 || only.includes(name));
  const modules: WasmModuleResult[] = [];
  for (const name of names) {
    modules.push(await benchWasmModule(name, new Uint8Array(fs.readFileSync(path.join(WASM_DIR, `${name}.wasm`))), options));
  }
  return { bench: 'wasm', runtime: `node ${process.version}`, options, modules };
}
