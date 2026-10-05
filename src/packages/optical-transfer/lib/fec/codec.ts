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
 * Prism's outer code (#1176, ADR 0037): the Rust module `crates/prism-fec`, compiled to
 * `src/wasm/prism-fec.wasm`. A non-systematic LT code over a sparse LDPC precode, decoded by
 * Gaussian elimination, that needs K + 1 symbols in the median.
 *
 * A message is split into source blocks of at most {@link FEC_BLOCK_SYMBOLS} symbols
 * ({@link planBlocks}); each block is encoded and decoded on its own, in its own module
 * instance, because the module's allocator only reclaims memory when everything in it is
 * freed. {@link FecEncoder} and {@link FecDecoder} have the shape of `FountainEncoder` and
 * `FountainDecoder`: the encoder hands out symbols by index, round-robin over the blocks, and the
 * decoder rebuilds the message from any of them. Decode in a worker: elimination runs as symbols
 * arrive, about a second of work for a full 8192-symbol block, and the last symbol's solve takes
 * under 100 ms.
 */
import { WasmModuleError, compileWasmUrl, instantiateWasmSync, type WasmInstance } from '@/packages/wasm-runtime';
import { crc32 } from '../fountain/crc32';
import { MAX_FEC_SOURCE_SYMBOLS, MAX_FEC_SYMBOL_BYTES, MAX_RECEIVE_MESSAGE_BYTES } from '../limits';

/** Default symbol size in bytes. */
export const FEC_SYMBOL_SIZE = 64;

/**
 * Default most symbols per source block: the cap, 512 KB at 64-byte symbols. Blocks are as large
 * as allowed because a round-robin stream over independent blocks wastes the symbols that reach
 * blocks already solved, which costs far more than the larger block's elimination (ADR 0037).
 */
export const FEC_BLOCK_SYMBOLS = MAX_FEC_SOURCE_SYMBOLS;

/** What `fec_decoder_add` reports. */
const ADDED_COMPLETE = 2;

/** The module's URL in a build: Vite emits the file as an asset next to the bundle. */
const PRISM_FEC_WASM_URL = new URL('../../../../wasm/prism-fec.wasm', import.meta.url);

/** Under Node (tests, scripts) this file has a `file:` URL and the module is read from `src/wasm/`. */
function moduleUrl(): URL {
  const here = import.meta.url;
  return here.startsWith('file:') ? new URL('../../../../wasm/prism-fec.wasm', here) : PRISM_FEC_WASM_URL;
}

/** Compiles the module once per page or worker. */
export function loadFecModule(): Promise<WebAssembly.Module> {
  return compileWasmUrl(moduleUrl());
}

/** How a message is cut into source blocks. Everything a receiver needs to decode it. */
export interface FecLayout {
  messageLength: number;
  /** Symbol size in bytes, a multiple of 8. */
  symbolSize: number;
  /** Seed of the code's generator, a 32-bit unsigned integer. */
  seed: number;
  /** Source symbols in each block, in order. */
  blocks: number[];
}

/** One encoding symbol: the block it belongs to, its ESI within that block, and its bytes. */
export interface FecSymbol {
  block: number;
  esi: number;
  data: Uint8Array;
}

/**
 * Splits `symbols` source symbols into blocks of at most `maxBlock`, as even as possible:
 * the first blocks get one symbol more than the rest.
 * @param symbols - Source symbols in the message, at least 1.
 * @param maxBlock - Most symbols per block.
 * @returns Source symbols per block.
 */
export function planBlocks(symbols: number, maxBlock: number = FEC_BLOCK_SYMBOLS): number[] {
  const total = Math.max(1, Math.ceil(symbols));
  const cap = Math.max(1, Math.min(MAX_FEC_SOURCE_SYMBOLS, Math.floor(maxBlock)));
  const count = Math.ceil(total / cap);
  const small = Math.floor(total / count);
  const large = total - small * count;
  return Array.from({ length: count }, (_, i) => (i < large ? small + 1 : small));
}

/** The seed of block `index`'s code: the layout's seed mixed with the index. */
function blockSeed(seed: number, index: number): number {
  return (seed + Math.imul(index, 0x9e3779b9)) >>> 0;
}

function validSymbolSize(t: number): boolean {
  return Number.isInteger(t) && t > 0 && t % 8 === 0 && t <= MAX_FEC_SYMBOL_BYTES;
}

/** Checks a layout against the receive limits before anything is allocated for it. */
export function isValidFecLayout(layout: FecLayout): boolean {
  const { messageLength, symbolSize, seed, blocks } = layout;
  if (!Number.isInteger(messageLength) || messageLength < 0 || messageLength > MAX_RECEIVE_MESSAGE_BYTES) return false;
  if (!validSymbolSize(symbolSize) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return false;
  if (blocks.length === 0 || !blocks.every((k) => Number.isInteger(k) && k >= 1 && k <= MAX_FEC_SOURCE_SYMBOLS)) return false;
  const symbols = blocks.reduce((sum, k) => sum + k, 0);
  return symbols === Math.max(1, Math.ceil(messageLength / symbolSize));
}

/** Encodes one source block in its own module instance. */
export class FecBlockEncoder {
  private readonly instance: WasmInstance;
  private readonly handle: number;
  private readonly symbolFn: (handle: number, esi: number) => number;

  constructor(
    module: WebAssembly.Module,
    readonly k: number,
    readonly symbolSize: number,
    seed: number,
    source: Uint8Array,
  ) {
    this.instance = instantiateWasmSync(module);
    const create = this.instance.fn('fec_encoder_new');
    this.handle = this.instance.withBytes(source, (ptr, len) => create(k, symbolSize, seed >>> 0, ptr, len)) >>> 0;
    if (this.handle === 0) throw new WasmModuleError('status', `The outer code cannot encode K = ${k}, T = ${symbolSize}.`);
    this.symbolFn = this.instance.fn('fec_encoder_symbol');
  }

  /** The bytes of encoding symbol `esi` (a 32-bit unsigned integer). */
  symbol(esi: number): Uint8Array {
    return this.instance.read(this.symbolFn(this.handle, esi >>> 0) >>> 0, this.symbolSize);
  }
}

/** Decodes one source block in its own module instance. */
export class FecBlockDecoder {
  private readonly instance: WasmInstance;
  private readonly handle: number;
  private readonly addFn: (handle: number, esi: number) => number;
  private readonly rankFn: (handle: number) => number;
  private readonly inbox: number;
  /** Rank at which the block solves, L = K + S. */
  readonly needed: number;
  private complete = false;

  constructor(
    module: WebAssembly.Module,
    readonly k: number,
    readonly symbolSize: number,
    seed: number,
  ) {
    if (!(k >= 1 && k <= MAX_FEC_SOURCE_SYMBOLS && Number.isInteger(k)) || !validSymbolSize(symbolSize)) {
      throw new WasmModuleError('status', `The outer code refuses K = ${k}, T = ${symbolSize}.`);
    }
    this.instance = instantiateWasmSync(module);
    this.handle = this.instance.fn('fec_decoder_new')(k, symbolSize, seed >>> 0) >>> 0;
    if (this.handle === 0) throw new WasmModuleError('memory', `The outer code could not reserve a block of K = ${k}.`);
    this.addFn = this.instance.fn('fec_decoder_add');
    this.rankFn = this.instance.fn('fec_decoder_rank');
    this.inbox = this.instance.fn('fec_decoder_inbox')(this.handle) >>> 0;
    this.needed = this.instance.fn('fec_decoder_needed')(this.handle) >>> 0;
  }

  /**
   * Adds encoding symbol `esi`.
   * @returns Whether it was new information; duplicates and combinations of earlier symbols are not.
   */
  add(esi: number, data: Uint8Array): boolean {
    if (this.complete) return false;
    if (data.length !== this.symbolSize) return false;
    this.instance.write(this.inbox, data);
    const before = this.rank;
    this.complete = this.addFn(this.handle, esi >>> 0) === ADDED_COMPLETE;
    return this.rank > before;
  }

  /** Independent equations so far; the block solves at {@link needed}. */
  get rank(): number {
    return this.rankFn(this.handle) >>> 0;
  }

  get isComplete(): boolean {
    return this.complete;
  }

  /** The block's K × T source bytes, or null before it is complete. */
  solve(): Uint8Array | null {
    if (!this.complete) return null;
    const at = this.instance.fn('fec_decoder_solve')(this.handle) >>> 0;
    return at === 0 ? null : this.instance.read(at, this.k * this.symbolSize);
  }
}

export interface FecEncoderOptions {
  /** Symbol size in bytes, a multiple of 8 (default {@link FEC_SYMBOL_SIZE}). */
  symbolSize?: number;
  /** Generator seed (default: the message's CRC-32). */
  seed?: number;
  /** Most symbols per block (default {@link FEC_BLOCK_SYMBOLS}). */
  maxBlockSymbols?: number;
}

/**
 * Encodes a whole message. Symbol `index` belongs to block `index mod B` and has ESI
 * `floor(index / B)` there, so every block gets an equal share of any run of symbols.
 */
export class FecEncoder {
  readonly layout: FecLayout;
  private readonly encoders: FecBlockEncoder[];

  constructor(module: WebAssembly.Module, message: Uint8Array, options: FecEncoderOptions = {}) {
    const symbolSize = options.symbolSize ?? FEC_SYMBOL_SIZE;
    if (!validSymbolSize(symbolSize)) throw new RangeError(`Symbol size ${symbolSize} is not a multiple of 8 up to ${MAX_FEC_SYMBOL_BYTES}.`);
    const blocks = planBlocks(Math.ceil(message.length / symbolSize), options.maxBlockSymbols);
    this.layout = { messageLength: message.length, symbolSize, seed: (options.seed ?? crc32(message)) >>> 0, blocks };
    let offset = 0;
    this.encoders = blocks.map((k, index) => {
      const source = new Uint8Array(k * symbolSize);
      source.set(message.subarray(offset, Math.min(message.length, offset + source.length)));
      offset += source.length;
      return new FecBlockEncoder(module, k, symbolSize, blockSeed(this.layout.seed, index), source);
    });
  }

  /** Encoding symbol `index` (0, 1, 2, …) of the round-robin stream. */
  symbol(index: number): FecSymbol {
    const count = this.encoders.length;
    const block = index % count;
    const esi = Math.floor(index / count) >>> 0;
    return { block, esi, data: this.encoders[block].symbol(esi) };
  }
}

/**
 * Rebuilds a message from encoding symbols in any order, with any duplicates. Each block's
 * decoder is created on its first symbol and released once the block is solved.
 */
export class FecDecoder {
  readonly layout: FecLayout;
  private readonly decoders: Array<FecBlockDecoder | null>;
  private readonly solved: Array<Uint8Array | null>;
  private readonly blockNeeded: number[];
  private readonly ranks: number[];
  private received = 0;
  private remaining: number;

  constructor(
    private readonly module: WebAssembly.Module,
    layout: FecLayout,
  ) {
    if (!isValidFecLayout(layout)) throw new RangeError('The outer-code layout is out of range or inconsistent.');
    this.layout = { ...layout, blocks: [...layout.blocks] };
    const count = layout.blocks.length;
    this.decoders = new Array<FecBlockDecoder | null>(count).fill(null);
    this.solved = new Array<Uint8Array | null>(count).fill(null);
    this.blockNeeded = layout.blocks.slice();
    this.ranks = new Array<number>(count).fill(0);
    this.remaining = count;
  }

  /**
   * Adds one symbol.
   * @returns Whether it was new information.
   */
  add(symbol: FecSymbol): boolean {
    const { block, esi, data } = symbol;
    if (!Number.isInteger(block) || block < 0 || block >= this.layout.blocks.length || this.solved[block]) return false;
    this.received += 1;
    let decoder = this.decoders[block];
    if (!decoder) {
      decoder = new FecBlockDecoder(this.module, this.layout.blocks[block], this.layout.symbolSize, blockSeed(this.layout.seed, block));
      this.decoders[block] = decoder;
      this.blockNeeded[block] = decoder.needed;
    }
    const added = decoder.add(esi, data);
    this.ranks[block] = decoder.rank;
    if (decoder.isComplete) {
      this.solved[block] = decoder.solve();
      this.decoders[block] = null;
      this.remaining -= 1;
    }
    return added;
  }

  /** Symbols handed to {@link add}, counted whether or not they helped. */
  get symbolsReceived(): number {
    return this.received;
  }

  /** Independent equations across all blocks. */
  get rank(): number {
    return this.ranks.reduce((sum, r) => sum + r, 0);
  }

  /** Rank at which every block solves. */
  get needed(): number {
    return this.blockNeeded.reduce((sum, n) => sum + n, 0);
  }

  /** Progress from 0 to 1. */
  get progress(): number {
    return this.isComplete ? 1 : Math.min(1, this.rank / Math.max(1, this.needed));
  }

  get isComplete(): boolean {
    return this.remaining === 0;
  }

  /** The message, or null until every block is solved. */
  finalize(): Uint8Array | null {
    if (!this.isComplete) return null;
    const out = new Uint8Array(this.layout.messageLength);
    let offset = 0;
    for (const block of this.solved) {
      if (!block) return null;
      out.set(block.subarray(0, Math.min(block.length, out.length - offset)), offset);
      offset += block.length;
      if (offset >= out.length) break;
    }
    return out;
  }
}
