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

/**
 * A fixed workload for the outer-code module (#1176) whose output must be identical, byte for
 * byte, in Node and in every browser engine: a sender in one browser and a receiver in another
 * must agree on every symbol. Vitest pins its SHA-256 and Playwright compares each engine's hash
 * with Node's.
 */

/** SHA-256 of {@link runPrismFecBattery}'s output for the committed `src/wasm/prism-fec.wasm`. */
export const PRISM_FEC_BATTERY_SHA256 = 'd70fc48519c65fca5bbf8e9d940a5c736b1bcfb4edde5cfb2e5c9d9a58dcc366';

/**
 * Encodes seeded blocks, records a run of symbols from each, then decodes every block from a
 * stream that joins late and skips symbols, and records each add's result and the solved bytes.
 *
 * Playwright copies this function's source into a worker, so it must stay self-contained: no
 * imports, helpers or values from outside its body.
 * @param exports - The raw exports of an instantiated `prism-fec.wasm`.
 * @returns The concatenated results.
 */
export function runPrismFecBattery(exports: WebAssembly.Exports): Uint8Array {
  const call = (name: string, ...args: number[]): number => {
    const target = exports[name];
    if (typeof target !== 'function') throw new Error(`prism-fec.wasm has no ${name} export`);
    return Number(Reflect.apply(target, undefined, args));
  };
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('prism-fec.wasm does not export its memory');

  // The same mulberry32 generator as tests/utils/scannerCorpus.ts, inlined.
  let state = 0x1176;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const out: number[] = [];
  // A loop, not a spread: spreading a whole block overflows the stack in Chromium.
  const pushBytes = (bytes: Uint8Array): void => {
    for (const byte of bytes) out.push(byte);
  };
  const pushU32 = (value: number): void => {
    out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  };

  const blocks: Array<[number, number]> = [
    [1, 8],
    [10, 64],
    [64, 16],
    [65, 64],
    [300, 32],
    [1000, 64],
  ];
  for (const [k, t] of blocks) {
    const seed = Math.floor(random() * 4294967296) >>> 0;
    const source = new Uint8Array(k * t);
    for (let i = 0; i < source.length; i++) source[i] = Math.floor(random() * 256);
    const sourcePtr = call('alloc', source.length);
    new Uint8Array(memory.buffer, sourcePtr, source.length).set(source);
    const encoder = call('fec_encoder_new', k, t, seed, sourcePtr, source.length) >>> 0;
    if (encoder === 0) throw new Error(`fec_encoder_new refused K = ${k}`);
    const decoder = call('fec_decoder_new', k, t, seed) >>> 0;
    if (decoder === 0) throw new Error(`fec_decoder_new refused K = ${k}`);
    pushU32(call('fec_decoder_needed', decoder) >>> 0);
    const inbox = call('fec_decoder_inbox', decoder) >>> 0;

    // A few symbols from the start of the stream and from near the top of the ESI range.
    for (const esi of [0, 1, 2, 3, 4294967295]) {
      const at = call('fec_encoder_symbol', encoder, esi) >>> 0;
      pushBytes(new Uint8Array(memory.buffer, at, t));
    }

    // Decode after a join, losing about a quarter of the symbols.
    let esi = Math.floor(random() * 4294967296) >>> 0;
    let status = 0;
    let sent = 0;
    while (status !== 2 && sent < 3 * k + 100) {
      esi = (esi + 1) >>> 0;
      if (random() < 0.25) continue;
      const at = call('fec_encoder_symbol', encoder, esi) >>> 0;
      new Uint8Array(memory.buffer, inbox, t).set(new Uint8Array(memory.buffer, at, t));
      status = call('fec_decoder_add', decoder, esi) >>> 0;
      out.push(status);
      sent += 1;
    }
    pushU32(call('fec_decoder_rank', decoder) >>> 0);
    const solved = call('fec_decoder_solve', decoder) >>> 0;
    if (solved === 0) throw new Error(`K = ${k} did not decode`);
    const bytes = new Uint8Array(memory.buffer, solved, k * t);
    if (!bytes.every((byte, i) => byte === source[i])) throw new Error(`K = ${k} decoded to different bytes`);
    pushBytes(bytes);

    call('fec_decoder_free', decoder);
    call('fec_encoder_free', encoder);
    call('free', sourcePtr, source.length);
  }

  // Refused sizes: K = 0, K over the cap, T not a multiple of 8, T over the cap.
  for (const [k, t] of [
    [0, 64],
    [8193, 64],
    [10, 12],
    [10, 1032],
  ]) {
    pushU32(call('fec_decoder_new', k, t, 1) >>> 0);
  }

  pushU32(call('abi_version') >>> 0);
  return new Uint8Array(out);
}

/** Symbols one engine encoded, for another engine to decode (#1141). */
export interface PrismFecJob {
  blocks: Array<{ k: number; t: number; seed: number; esis: number[]; symbols: Uint8Array }>;
}

/**
 * Encodes a few blocks and keeps a lossy run of their symbols, from a join point, to hand to
 * another engine. The source bytes come from the same generator in every engine.
 * @param exports - The instantiated module's exports.
 * @returns The job and, per block, the source it must decode to.
 */
export function makePrismFecJob(exports: WebAssembly.Exports): { job: PrismFecJob; sources: Uint8Array[] } {
  const call = (name: string, ...args: number[]): number => {
    const target = exports[name];
    if (typeof target !== 'function') throw new Error(`prism-fec.wasm has no ${name} export`);
    return Number(Reflect.apply(target, undefined, args));
  };
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('prism-fec.wasm does not export its memory');
  let state = 0x1141;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const job: PrismFecJob = { blocks: [] };
  const sources: Uint8Array[] = [];
  for (const [k, t] of [
    [40, 16],
    [2000, 64],
  ]) {
    const seed = Math.floor(random() * 4294967296) >>> 0;
    const source = new Uint8Array(k * t);
    for (let i = 0; i < source.length; i++) source[i] = Math.floor(random() * 256);
    const sourcePtr = call('alloc', source.length);
    new Uint8Array(memory.buffer, sourcePtr, source.length).set(source);
    const encoder = call('fec_encoder_new', k, t, seed, sourcePtr, source.length) >>> 0;
    if (encoder === 0) throw new Error(`fec_encoder_new refused K = ${k}`);
    // Enough symbols for the decoder with room to spare: K plus 40, a third lost on the way.
    const esis: number[] = [];
    const symbols = new Uint8Array((k + 40) * t);
    let esi = Math.floor(random() * 1000);
    while (esis.length < k + 40) {
      esi += 1;
      if (random() < 0.33) continue;
      symbols.set(new Uint8Array(memory.buffer, call('fec_encoder_symbol', encoder, esi) >>> 0, t), esis.length * t);
      esis.push(esi);
    }
    call('fec_encoder_free', encoder);
    call('free', sourcePtr, source.length);
    job.blocks.push({ k, t, seed, esis, symbols });
    sources.push(source);
  }
  return { job, sources };
}

/**
 * Decodes a job another engine made. Self-contained, so it can run in a worker as source text.
 * @param exports - The instantiated module's exports.
 * @param job - The symbols.
 * @returns Each block's decoded source, concatenated.
 */
export function decodePrismFecJob(exports: WebAssembly.Exports, job: PrismFecJob): Uint8Array {
  const call = (name: string, ...args: number[]): number => {
    const target = exports[name];
    if (typeof target !== 'function') throw new Error(`prism-fec.wasm has no ${name} export`);
    return Number(Reflect.apply(target, undefined, args));
  };
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('prism-fec.wasm does not export its memory');
  const parts: Uint8Array[] = [];
  for (const { k, t, seed, esis, symbols } of job.blocks) {
    const decoder = call('fec_decoder_new', k, t, seed) >>> 0;
    if (decoder === 0) throw new Error(`fec_decoder_new refused K = ${k}`);
    const inbox = call('fec_decoder_inbox', decoder) >>> 0;
    let status = 0;
    for (let i = 0; i < esis.length && status !== 2; i++) {
      new Uint8Array(memory.buffer, inbox, t).set(symbols.subarray(i * t, (i + 1) * t));
      status = call('fec_decoder_add', decoder, esis[i]) >>> 0;
    }
    const solved = call('fec_decoder_solve', decoder) >>> 0;
    if (solved === 0) throw new Error(`K = ${k} did not decode`);
    parts.push(new Uint8Array(memory.buffer, solved, k * t).slice());
    call('fec_decoder_free', decoder);
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
