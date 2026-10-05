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
 * The QR encoder (#1177): our Rust module `crates/qr-encode`, compiled to
 * `src/wasm/qr-encode.wasm`, behind a synchronous `create` once it has loaded.
 *
 * Load it with {@link loadQrEncoder} (pages and workers fetch it from the site;
 * Node reads it from disk). Workers start the load when they start, so the first
 * code does not wait on a fetch after typing begins. Tests and scripts that need
 * it synchronously can call {@link createQrEncoder} on an instance.
 */
import { WASM_STATUS, WasmModuleError, compileWasmUrl, instantiateWasm, type WasmInstance } from '@/packages/wasm-runtime';
import type { QRErrorCorrectionLevel, QRModules } from '@/types';

/** The module's URL in a build: Vite emits the file as an asset next to the bundle. */
export const QR_ENCODE_WASM_URL = new URL('../../../wasm/qr-encode.wasm', import.meta.url);

/**
 * Where to load the module from. Run from source under Node (tests, scripts), this
 * file has a `file:` URL and the module is read from `src/wasm/` beside it; Vite's
 * dev server would otherwise point {@link QR_ENCODE_WASM_URL} at its own origin.
 */
function moduleUrl(): URL {
  const here = import.meta.url;
  return here.startsWith('file:') ? new URL('../../../wasm/qr-encode.wasm', here) : QR_ENCODE_WASM_URL;
}

export type QrEccLetter = 'L' | 'M' | 'Q' | 'H';
export type QrSegmentMode = 'numeric' | 'alphanumeric' | 'byte' | 'kanji';

/** A segment supplied by the caller. Kanji data is big-endian Shift JIS byte pairs. */
export interface QrSegmentInput {
  mode: QrSegmentMode;
  data: string | Uint8Array;
}

export interface QrEncodeOptions {
  /** Level of error correction. Defaults to M. */
  errorCorrectionLevel?: QRErrorCorrectionLevel | QrEccLetter;
  /** A fixed version (1 to 40). By default the smallest version that holds the data. */
  version?: number;
  /** A fixed mask (0 to 7). By default the mask with the lowest penalty. */
  maskPattern?: number;
  /** Raise the level as far as the chosen version still holds the data. Off by default. */
  boostErrorCorrection?: boolean;
  /** An ECI designator placed before the data, for a character set other than the default. */
  eci?: number;
  /** Structured append: this symbol's index (from 0), the symbol count (2 to 16) and the message parity. */
  structuredAppend?: { index: number; total: number; parity: number };
}

/** One segment of an encoded symbol. For ECI, `chars` is the assignment number. */
export interface QrEncodedSegment {
  mode: QrSegmentMode | 'eci';
  chars: number;
  bytes: Uint8Array;
}

/** Modules of an encoded symbol, row by row in `data` (1 = dark). */
export interface QrModuleGrid extends QRModules {
  readonly data: Uint8Array;
}

export interface QrSymbol {
  modules: QrModuleGrid;
  version: number;
  errorCorrectionLevel: QrEccLetter;
  maskPattern: number;
  /** Bits the segments use, headers included. */
  dataBits: number;
  segments: QrEncodedSegment[];
}

export type QrEncodeErrorKind = 'empty' | 'too-long' | 'invalid';

/** Why a value could not be encoded. The generator treats every kind as "nothing to draw". */
export class QrEncodeError extends Error {
  readonly kind: QrEncodeErrorKind;

  constructor(kind: QrEncodeErrorKind, message: string) {
    super(message);
    this.name = 'QrEncodeError';
    this.kind = kind;
  }
}

/** Encodes text or caller segments into a symbol, synchronously. */
export interface QrSymbolEncoder {
  create(value: string | readonly QrSegmentInput[], options?: QrEncodeOptions): QrSymbol;
}

const ECC_LETTERS: readonly QrEccLetter[] = ['L', 'M', 'Q', 'H'];
const MODE_CODES: Record<QrSegmentMode, number> = { numeric: 1, alphanumeric: 2, byte: 4, kanji: 8 };
const MODES_BY_CODE: Record<number, QrSegmentMode | 'eci'> = { 1: 'numeric', 2: 'alphanumeric', 4: 'byte', 8: 'kanji', 7: 'eci' };
const AUTO_MASK = 8;
const FLAG_BOOST_ECC = 1;
const FLAG_STRUCTURED_APPEND = 2;
const FLAG_SEGMENTS = 4;
const FLAG_ECI = 8;
const RESULT_HEADER = 12;
const SEGMENT_RECORD = 13;

const textEncoder = new TextEncoder();

function eccIndex(level: QrEncodeOptions['errorCorrectionLevel']): number {
  if (level === undefined) return 1;
  const letters: readonly string[] = ECC_LETTERS;
  const index = letters.indexOf(level);
  if (index < 0) throw new QrEncodeError('invalid', `Unknown error correction level: ${String(level)}`);
  return index;
}

function checkedByte(value: number, min: number, max: number, what: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new QrEncodeError('invalid', `${what} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

/** Encodes the request the module reads (layout in `crates/qr-encode/src/lib.rs`). */
function buildRequest(value: string | readonly QrSegmentInput[], options: QrEncodeOptions): { request: Uint8Array; bodyStart: number } {
  const head: number[] = [
    eccIndex(options.errorCorrectionLevel),
    options.version === undefined ? 0 : checkedByte(options.version, 1, 40, 'version'),
    options.maskPattern === undefined ? AUTO_MASK : checkedByte(options.maskPattern, 0, 7, 'maskPattern'),
    0,
  ];
  if (options.boostErrorCorrection) head[3] |= FLAG_BOOST_ECC;
  if (options.structuredAppend) {
    const { index, total, parity } = options.structuredAppend;
    head[3] |= FLAG_STRUCTURED_APPEND;
    head.push(checkedByte(index, 0, 15, 'structuredAppend.index'), checkedByte(total, 2, 16, 'structuredAppend.total'), checkedByte(parity, 0, 255, 'structuredAppend.parity'));
  }
  if (options.eci !== undefined) {
    const eci = options.eci;
    if (!Number.isInteger(eci) || eci < 0 || eci > 999_999) throw new QrEncodeError('invalid', 'eci must be an integer from 0 to 999999.');
    head[3] |= FLAG_ECI;
    head.push(eci & 0xff, (eci >>> 8) & 0xff, (eci >>> 16) & 0xff, 0);
  }

  const parts: Uint8Array[] = [];
  if (typeof value === 'string') {
    if (value === '') throw new QrEncodeError('empty', 'No input text');
    parts.push(textEncoder.encode(value));
  } else if (Array.isArray(value)) {
    head[3] |= FLAG_SEGMENTS;
    const segments: readonly QrSegmentInput[] = value;
    for (const segment of segments) {
      const bytes = typeof segment.data === 'string' ? textEncoder.encode(segment.data) : segment.data;
      const record = new Uint8Array(5);
      record[0] = MODE_CODES[segment.mode];
      new DataView(record.buffer).setUint32(1, bytes.length, true);
      parts.push(record, bytes);
    }
  } else {
    throw new QrEncodeError('invalid', 'Invalid data');
  }
  const bodyLength = parts.reduce((sum, part) => sum + part.length, 0);
  const request = new Uint8Array(head.length + bodyLength);
  request.set(head);
  let at = head.length;
  for (const part of parts) {
    request.set(part, at);
    at += part.length;
  }
  return { request, bodyStart: head.length };
}

function moduleGrid(size: number, data: Uint8Array): QrModuleGrid {
  return { size, data, get: (row, col) => data[row * size + col] === 1 };
}

function statusError(status: number, options: QrEncodeOptions): QrEncodeError {
  if (status === WASM_STATUS.DATA_TOO_LONG) {
    return new QrEncodeError(
      'too-long',
      options.version === undefined
        ? 'The amount of data is too big to be stored in a QR Code'
        : `The chosen QR Code version (${options.version}) cannot contain this amount of data.`,
    );
  }
  if (status === WASM_STATUS.BAD_INPUT) return new QrEncodeError('invalid', 'The QR code input is invalid.');
  return new QrEncodeError('invalid', `The QR encoder failed with status ${status}.`);
}

/** Wraps an instance of the module. The returned encoder is synchronous. */
export function createQrEncoder(instance: WasmInstance): QrSymbolEncoder {
  const encode = instance.fn('qr_encode');
  const outputCapacity = instance.fn('qr_output_capacity');

  return {
    create(value, options = {}) {
      const { request, bodyStart } = buildRequest(value, options);
      const body = request.subarray(bodyStart);
      const capacity = outputCapacity(request.length) >>> 0;
      return instance.withBytes(request, (reqPtr, reqLen) => {
        const outPtr = instance.alloc(capacity);
        try {
          const status = encode(reqPtr, reqLen, outPtr, capacity);
          if (status !== WASM_STATUS.OK) throw statusError(status, options);
          const header = new DataView(instance.read(outPtr, RESULT_HEADER).buffer);
          const size = header.getUint16(4, true);
          const segmentCount = header.getUint16(6, true);
          const modules = instance.read(outPtr + RESULT_HEADER, size * size);
          const records = new DataView(instance.read(outPtr + RESULT_HEADER + size * size, segmentCount * SEGMENT_RECORD).buffer);
          const segments: QrEncodedSegment[] = [];
          for (let i = 0; i < segmentCount; i++) {
            const at = i * SEGMENT_RECORD;
            const offset = records.getUint32(at + 5, true);
            segments.push({
              mode: MODES_BY_CODE[records.getUint8(at)] ?? 'byte',
              chars: records.getUint32(at + 1, true),
              bytes: body.slice(offset, offset + records.getUint32(at + 9, true)),
            });
          }
          return {
            modules: moduleGrid(size, modules),
            version: header.getUint8(0),
            errorCorrectionLevel: ECC_LETTERS[header.getUint8(1)] ?? 'M',
            maskPattern: header.getUint8(2),
            dataBits: header.getUint32(8, true),
            segments,
          };
        } finally {
          instance.free(outPtr, capacity);
        }
      });
    },
  };
}

let loading: Promise<QrSymbolEncoder> | null = null;

/**
 * Loads the encoder once per page or worker. A failed load is not kept, so a
 * later call retries.
 */
export function loadQrEncoder(): Promise<QrSymbolEncoder> {
  if (!loading) {
    loading = compileWasmUrl(moduleUrl())
      .then(instantiateWasm)
      .then(createQrEncoder)
      .catch((error: unknown) => {
        loading = null;
        throw error instanceof WasmModuleError ? error : new WasmModuleError('compile', 'The QR encoder did not load.', { cause: error });
      });
  }
  return loading;
}
