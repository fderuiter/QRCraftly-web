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
 * Drives the committed `qr-decode` module (#1178) directly for the Foundry tests and benchmarks:
 * renders encoded symbols into grey frames and reads `qr_decode`'s result layout
 * (`crates/qr-decode/src/lib.rs`). App code will use the wrapper in its package instead.
 */
import type { WasmInstance } from '@/packages/wasm-runtime';

const REQUEST_HEADER = 12;
const CODE_FIXED = 8 + 16 * 4 + 8;
const SEGMENT_RECORD = 16;

export interface ModuleGrid {
  size: number;
  data: Uint8Array;
}

export interface DecodedCode {
  version: number;
  ecc: number;
  mask: number;
  flags: number;
  bytes: Uint8Array;
}

/** A grey frame with the symbol at `scale` pixels per module and a quiet zone of four. */
export function renderGrid(grid: ModuleGrid, scale: number, width = (grid.size + 8) * scale, height = width): Uint8Array {
  const pixels = new Uint8Array(width * height).fill(255);
  const left = Math.floor((width - grid.size * scale) / 2);
  const top = Math.floor((height - grid.size * scale) / 2);
  for (let row = 0; row < grid.size; row++) {
    for (let col = 0; col < grid.size; col++) {
      if (grid.data[row * grid.size + col] !== 1) continue;
      for (let y = 0; y < scale; y++) pixels.fill(0, (top + row * scale + y) * width + left + col * scale, (top + row * scale + y) * width + left + (col + 1) * scale);
    }
  }
  return pixels;
}

/** The `qr_decode` request: header then pixels. */
export function decodeRequest(pixels: Uint8Array, width: number, height: number, channels: 1 | 4, flags = 0, maxCodes = 1): Uint8Array {
  const request = new Uint8Array(REQUEST_HEADER + pixels.length);
  const view = new DataView(request.buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  request.set([channels, flags, maxCodes, 0], 8);
  request.set(pixels, REQUEST_HEADER);
  return request;
}

/** Reads the codes out of a `qr_decode` result. */
export function parseDecodeResult(out: Uint8Array): DecodedCode[] {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const codes: DecodedCode[] = [];
  let at = 4;
  for (let i = 0; i < out[0]; i++) {
    const [version, ecc, mask, flags] = out.subarray(at, at + 4);
    const segments = view.getUint16(at + CODE_FIXED - 6, true);
    const length = view.getUint32(at + CODE_FIXED - 4, true);
    const start = at + CODE_FIXED + segments * SEGMENT_RECORD;
    codes.push({ version, ecc, mask, flags, bytes: out.slice(start, start + length) });
    at = start + length;
  }
  return codes;
}

/**
 * Returns a function that decodes `request`, copying it in and the result out on every call as an
 * app would. The module's allocator only rewinds once every buffer is freed, so nothing is kept.
 */
export function prepareDecode(instance: WasmInstance, request: Uint8Array, maxCodes = 1): () => DecodedCode[] {
  const decode = instance.fn('qr_decode');
  const capacity = instance.fn('qr_decode_capacity')(maxCodes);
  return () =>
    instance.withBytes(request, (input, length) => {
      let status = 0;
      const out = instance.withOutput(capacity, (output) => {
        status = decode(input, length, output, capacity);
      });
      if (status !== 0) throw new Error(`qr_decode status ${status}`);
      return parseDecodeResult(out);
    });
}
