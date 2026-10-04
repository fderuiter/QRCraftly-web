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
 * A fixed workload for the QR encoder module whose output must be identical, byte for byte, in
 * Node and in every browser engine (#1177). Vitest pins its SHA-256 and Playwright compares each
 * engine's hash with Node's.
 */

/** SHA-256 of {@link runQrEncodeBattery}'s output for the committed `src/wasm/qr-encode.wasm`. */
export const QR_ENCODE_BATTERY_SHA256 = '612e5ec728b77d5869b1f4912fdd50f4164c90cb7ff4e889b014e6f3d440dc37';

/**
 * Encodes a fixed set of requests (every level, automatic and fixed versions and masks, caller
 * segments, ECI, structured append, a version 40 symbol and refused inputs) and returns each
 * status and result as one byte string.
 *
 * Playwright copies this function's source into a worker, so it must stay self-contained: no
 * imports, helpers or values from outside its body.
 * @param exports - The raw exports of an instantiated `qr-encode.wasm`.
 * @returns The concatenated results.
 */
export function runQrEncodeBattery(exports: WebAssembly.Exports): Uint8Array {
  const call = (name: string, ...args: number[]): number => {
    const target = exports[name];
    if (typeof target !== 'function') throw new Error(`qr-encode.wasm has no ${name} export`);
    return Number(Reflect.apply(target, undefined, args));
  };
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('qr-encode.wasm does not export its memory');
  const utf8 = (text: string): number[] => Array.from(new TextEncoder().encode(text));
  const segment = (mode: number, bytes: number[]): number[] => [mode, bytes.length & 0xff, (bytes.length >>> 8) & 0xff, 0, 0, ...bytes];

  // [level, version, mask, flags, ...body]: the request layout in crates/qr-encode/src/lib.rs.
  const requests: number[][] = [];
  const texts = ['https://qrcraftly.com', 'HELLO WORLD 0123456789', '日本語のテキスト 🎉', 'WIFI:T:WPA;S:Guest;P:pass word;;'];
  for (let level = 0; level < 4; level++) {
    for (const text of texts) requests.push([level, 0, 8, 0, ...utf8(text)]);
  }
  for (let mask = 0; mask < 8; mask++) requests.push([mask % 4, 7, mask, 0, ...utf8(`mask ${mask}`)]);
  requests.push([1, 0, 8, 4, ...segment(1, utf8('0123456789')), ...segment(2, utf8('AC-42')), ...segment(4, utf8('ok')), ...segment(8, [0x93, 0x5f, 0xe4, 0xaa])]);
  requests.push([1, 0, 8, 8, 26, 0, 0, 0, ...utf8('ECI ünïcode')]);
  requests.push([2, 0, 8, 2, 1, 3, 0xa5, ...utf8('part two of three')]);
  requests.push([0, 0, 8, 1, ...utf8('raise me')]);
  requests.push([0, 0, 8, 0, ...utf8('abcdefghijklmnopqrstuvwxyz'.repeat(114).slice(0, 2953))]);
  requests.push([0, 0, 8, 0, ...utf8('x'.repeat(2954))]);
  requests.push([3, 1, 8, 0, ...utf8('too long for version 1 at level H')]);
  requests.push([4, 0, 8, 0, ...utf8('bad level')]);
  requests.push([1, 0, 8, 0]);

  const out: number[] = [];
  for (const request of requests) {
    const capacity = call('qr_output_capacity', request.length);
    const input = call('alloc', request.length);
    const output = call('alloc', capacity);
    new Uint8Array(memory.buffer, input, request.length).set(request);
    const status = call('qr_encode', input, request.length, output, capacity);
    out.push(status);
    if (status === 0) {
      const header = new Uint8Array(memory.buffer, output, 12);
      const size = header[4] | (header[5] << 8);
      const segments = header[6] | (header[7] << 8);
      const length = 12 + size * size + 13 * segments;
      for (const byte of new Uint8Array(memory.buffer, output, length)) out.push(byte);
    }
    call('free', output, capacity);
    call('free', input, request.length);
  }
  return Uint8Array.from(out);
}
