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
 * The QR decoder (#1178): our Rust module `crates/qr-decode`, compiled to
 * `src/wasm/qr-decode.wasm`, behind a synchronous `read` once it has loaded.
 *
 * Load it with {@link loadQrReader} (pages and workers fetch it from the site;
 * Node reads it from disk). Tests and scripts that need it synchronously can
 * call {@link createQrReader} on an instance.
 */
import { WASM_STATUS, WasmModuleError, compileWasmUrl, instantiateWasm, type WasmInstance } from '@/packages/wasm-runtime';
import { decodeSegments, type QrReadSegment } from './text';

/** The module's URL in a build: Vite emits the file as an asset next to the bundle. */
const QR_DECODE_WASM_URL = new URL('../../../wasm/qr-decode.wasm', import.meta.url);

/**
 * Where to load the module from. Run from source under Node (tests, scripts), this
 * file has a `file:` URL and the module is read from `src/wasm/` beside it.
 */
function moduleUrl(): URL {
  const here = import.meta.url;
  return here.startsWith('file:') ? new URL('../../../wasm/qr-decode.wasm', here) : QR_DECODE_WASM_URL;
}

export type QrReadLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrPoint {
  x: number;
  y: number;
}

export interface QrReadOptions {
  /** Also look for light-on-dark codes. */
  inverted?: boolean;
  /** If nothing is found, try once more with one threshold for the whole frame. */
  global?: boolean;
  /** If nothing is found, try once more at half size (for noise and large modules). */
  half?: boolean;
  /** Scan every other row instead of a step sized to the frame (slower, finds smaller codes). */
  dense?: boolean;
  /** The most codes to return, 1 to 8. Defaults to 1. */
  maxCodes?: number;
}

/** One code found in a frame. Points are in the frame's pixels. */
export interface QrRead {
  /** The data as text: each segment decoded by its mode and ECI (UTF-8 when it is valid, else Latin-1). */
  text: string;
  /** The data bytes of every segment, in order (Shift JIS for kanji). */
  bytes: Uint8Array;
  segments: QrReadSegment[];
  version: number;
  level: QrReadLevel;
  mask: number;
  /** The code was printed mirrored. */
  mirrored: boolean;
  /** The code was light on dark. */
  inverted: boolean;
  /** Codewords Reed-Solomon corrected. */
  corrected: number;
  /** Top-left, top-right, bottom-right and bottom-left corners of the symbol. */
  corners: [QrPoint, QrPoint, QrPoint, QrPoint];
  /** Centres of the top-left, top-right and bottom-left finder patterns. */
  finders: [QrPoint, QrPoint, QrPoint];
  /** Centre of the alignment pattern used, if any. */
  alignment: QrPoint | null;
  /** Structured append: this symbol's index, the symbol count and the parity. */
  structuredAppend: { index: number; total: number; parity: number } | null;
  /** FNC1: GS1 (first position) or AIM (second position). */
  fnc1: 'gs1' | 'aim' | null;
}

/** A tile whose place and shape are already known, as Prism's tracker knows them. */
export interface QrTile {
  /** The symbol's top-left, top-right, bottom-right and bottom-left corners (its modules' outer edges), in frame pixels. */
  corners: [QrPoint, QrPoint, QrPoint, QrPoint];
  /** 1 to 40. */
  version: number;
  /** Omit to accept any level. */
  level?: QrReadLevel;
  /** Also try the tile as light on dark. */
  inverted?: boolean;
}

/** Reads QR codes from pixels, synchronously. */
export interface QrReader {
  /**
   * @param pixels RGBA (4 bytes a pixel, as in `ImageData`) or grey (1 byte a pixel), row by row.
   * @returns The codes found, best first; empty when there are none.
   */
  read(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, options?: QrReadOptions): QrRead[];
  /**
   * The Prism fast path: reads up to 8 tiles from their known corners, versions
   * and levels without searching the frame, copying the frame in once.
   * @returns One entry per tile, in order: its code, or null when it does not read as that version and level there.
   */
  readTracked(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, tiles: readonly QrTile[]): Array<QrRead | null>;
}

const LEVELS: readonly QrReadLevel[] = ['L', 'M', 'Q', 'H'];
const REQUEST_HEADER = 12;
const TILE_RECORD = 4 + 8 * 4;
const ANY_LEVEL = 255;
const CODE_HEADER = 8 + 16 * 4 + 8;
const SEGMENT_RECORD = 16;
const MAX_CODES = 8;
const FLAG_DENSE = 1;
const FLAG_INVERTED = 2;
const FLAG_GLOBAL = 4;
const FLAG_HALF = 8;
const RESULT_MIRRORED = 1;
const RESULT_INVERTED = 2;
const RESULT_STRUCTURED = 4;
const RESULT_GS1 = 8;
const RESULT_FNC1_SECOND = 16;

function flagsOf(options: QrReadOptions): number {
  return (
    (options.dense ? FLAG_DENSE : 0) |
    (options.inverted ? FLAG_INVERTED : 0) |
    (options.global ? FLAG_GLOBAL : 0) |
    (options.half ? FLAG_HALF : 0)
  );
}

function point(view: DataView, at: number): QrPoint {
  return { x: view.getFloat32(at, true), y: view.getFloat32(at + 4, true) };
}

/**
 * Reads the records out of a `qr_decode` or `qr_decode_tracked` result (layout in
 * `crates/qr-decode/src/lib.rs`). A tracked tile that did not read is a record of
 * zeros, returned as null.
 */
function parseResult(out: Uint8Array): Array<QrRead | null> {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const reads: Array<QrRead | null> = [];
  let at = 4;
  for (let i = 0; i < out[0]; i++) {
    if (out[at] === 0) {
      reads.push(null);
      at += CODE_HEADER;
      continue;
    }
    const flags = out[at + 3];
    const points = Array.from({ length: 8 }, (_, k) => point(view, at + 8 + k * 8));
    const alignment = points[7];
    const corrected = view.getUint16(at + CODE_HEADER - 8, true);
    const segmentCount = view.getUint16(at + CODE_HEADER - 6, true);
    const length = view.getUint32(at + CODE_HEADER - 4, true);
    const start = at + CODE_HEADER + segmentCount * SEGMENT_RECORD;
    const bytes = out.slice(start, start + length);
    const records = Array.from({ length: segmentCount }, (_, k) => {
      const r = at + CODE_HEADER + k * SEGMENT_RECORD;
      const eci = view.getUint32(r + 4, true);
      return { mode: out[r], eci: eci === 0xffffffff ? null : eci, start: view.getUint32(r + 8, true), length: view.getUint32(r + 12, true) };
    });
    const { text, segments } = decodeSegments(bytes, records);
    reads.push({
      text,
      bytes,
      segments,
      version: out[at],
      level: LEVELS[out[at + 1]] ?? 'L',
      mask: out[at + 2],
      mirrored: (flags & RESULT_MIRRORED) !== 0,
      inverted: (flags & RESULT_INVERTED) !== 0,
      corrected,
      corners: [points[0], points[1], points[2], points[3]],
      finders: [points[4], points[5], points[6]],
      alignment: Number.isNaN(alignment.x) ? null : alignment,
      structuredAppend: (flags & RESULT_STRUCTURED) !== 0 ? { index: out[at + 4], total: out[at + 5], parity: out[at + 6] } : null,
      fnc1: (flags & RESULT_GS1) !== 0 ? 'gs1' : (flags & RESULT_FNC1_SECOND) !== 0 ? 'aim' : null,
    });
    at = start + length;
  }
  return reads;
}

/** Checks the frame and returns its channels per pixel. */
function channelsOf(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number): number {
  const channels = pixels.length === width * height ? 1 : 4;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length !== width * height * channels) {
    throw new WasmModuleError('status', `Expected ${width} x ${height} grey or RGBA pixels, got ${pixels.length} bytes.`);
  }
  return channels;
}

/** The first 12 bytes of either request: width, height, channels and four more bytes. */
function headerOf(length: number, width: number, height: number, tail: [number, number, number, number]): Uint8Array {
  const header = new Uint8Array(length);
  const view = new DataView(header.buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  header.set(tail, 8);
  return header;
}

/** Wraps an instance of the module. The returned reader is synchronous. */
export function createQrReader(instance: WasmInstance): QrReader {
  const decode = instance.fn('qr_decode');
  const decodeTracked = instance.fn('qr_decode_tracked');
  const capacityFor = instance.fn('qr_decode_capacity');

  /** Copies the header and pixels in, runs `exported` and parses what it wrote. */
  function call(exported: typeof decode, name: string, header: Uint8Array, pixels: Uint8ClampedArray | Uint8Array, maxCodes: number): Array<QrRead | null> {
    const capacity = capacityFor(maxCodes) >>> 0;
    const requestLength = header.length + pixels.length;
    const request = instance.alloc(requestLength);
    try {
      instance.write(request, header);
      instance.write(request + header.length, pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.length));
      const out = instance.alloc(capacity);
      try {
        const status = exported(request, requestLength, out, capacity);
        if (status !== WASM_STATUS.OK) throw new WasmModuleError('status', `${name} failed with status ${status}.`);
        // Parsed in place: the result is a few hundred bytes of a buffer sized for the worst case.
        return parseResult(new Uint8Array(instance.memory.buffer, out, capacity));
      } finally {
        instance.free(out, capacity);
      }
    } finally {
      instance.free(request, requestLength);
    }
  }

  return {
    read(pixels, width, height, options = {}) {
      const channels = channelsOf(pixels, width, height);
      const maxCodes = Math.min(MAX_CODES, Math.max(1, Math.floor(options.maxCodes ?? 1)));
      const reads = call(decode, 'qr_decode', headerOf(REQUEST_HEADER, width, height, [channels, flagsOf(options), maxCodes, 0]), pixels, maxCodes);
      return reads.filter((read): read is QrRead => read !== null);
    },
    readTracked(pixels, width, height, tiles) {
      const channels = channelsOf(pixels, width, height);
      if (tiles.length < 1 || tiles.length > MAX_CODES) {
        throw new WasmModuleError('status', `Expected 1 to ${MAX_CODES} tiles, got ${tiles.length}.`);
      }
      const header = headerOf(REQUEST_HEADER + tiles.length * TILE_RECORD, width, height, [channels, 0, tiles.length, 0]);
      const view = new DataView(header.buffer);
      tiles.forEach((tile, t) => {
        if (!Number.isInteger(tile.version) || tile.version < 1 || tile.version > 40) {
          throw new WasmModuleError('status', `Expected a version from 1 to 40, got ${tile.version}.`);
        }
        const at = REQUEST_HEADER + t * TILE_RECORD;
        header.set([tile.version, tile.level === undefined ? ANY_LEVEL : LEVELS.indexOf(tile.level), tile.inverted ? FLAG_INVERTED : 0, 0], at);
        tile.corners.forEach((corner, k) => {
          view.setFloat32(at + 4 + k * 8, corner.x, true);
          view.setFloat32(at + 8 + k * 8, corner.y, true);
        });
      });
      return call(decodeTracked, 'qr_decode_tracked', header, pixels, tiles.length);
    },
  };
}

let loading: Promise<QrReader> | null = null;

/**
 * Loads the reader once per page or worker. A failed load is not kept, so a later
 * call retries.
 */
export function loadQrReader(): Promise<QrReader> {
  if (!loading) {
    loading = compileWasmUrl(moduleUrl())
      .then(instantiateWasm)
      .then(createQrReader)
      .catch((error: unknown) => {
        loading = null;
        throw error instanceof WasmModuleError ? error : new WasmModuleError('compile', 'The QR reader did not load.', { cause: error });
      });
  }
  return loading;
}
