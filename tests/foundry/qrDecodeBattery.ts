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
 * A fixed workload for the QR decoder module whose output must be identical, byte for byte, in
 * Node and in every browser engine (#1178). Vitest pins its SHA-256 and Playwright compares each
 * engine's hash with Node's.
 */

/** SHA-256 of {@link runQrDecodeBattery}'s output for the committed `src/wasm/qr-decode.wasm`. */
export const QR_DECODE_BATTERY_SHA256 = 'd06eaa0dc3873d7eeb370b3af32fa45ffb3b59f982e9dc4949ef00c6fadb6a11';

/**
 * Draws two fixed symbols (version 2 and version 7) into frames: plain, RGBA in colour, sheared,
 * scaled unevenly, noisy, light on dark, mirrored, two in one frame, blank and random. Decodes
 * each and returns every status and result as one byte string. Only integer arithmetic draws the
 * frames, so every engine builds the same pixels.
 *
 * Playwright copies this function's source into a worker, so it must stay self-contained: no
 * imports, helpers or values from outside its body.
 * @param exports - The raw exports of an instantiated `qr-decode.wasm`.
 * @param counts - Receives each request's code count, or -1 when it was refused.
 * @returns The concatenated results.
 */
export function runQrDecodeBattery(exports: WebAssembly.Exports, counts: number[] = []): Uint8Array {
  const call = (name: string, ...args: number[]): number => {
    const target = exports[name];
    if (typeof target !== 'function') throw new Error(`qr-decode.wasm has no ${name} export`);
    return Number(Reflect.apply(target, undefined, args));
  };
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('qr-decode.wasm does not export its memory');

  // Rows of each symbol, base 36, most significant module first.
  const symbols = [
    ['jvvr3', 'a7i2p', 'el8bh', 'ejqe5', 'ekxnh', 'a6ekh', 'jvfy7', 'r28', 'cgk2f', '94ibi', 'bfg8p', '7km8f', '2g2f5', 'eojki', 'g4tpb', 'bvk4t', 'ebjzq', '2rrq', 'jvuxd', 'a6qs3', 'el62b', 'el1ab', 'ejpjz', 'a58mv', 'jw3nt'],
    ['ce86qbgcf', '6cvgk7l1d', '93y3nhy71', '92fvc0i1p', '93kve0dp9', '6dkysc3ep', 'cenaj8hhb', 'hy8m4n4', '3n25rhewk', '18a1j2bum', '99mhpfjlq', '20ntt8kz5', '4t6wvzs8h', '96aytkmhq', '8y7npd9oq', '3kcyukzdv', '3vn3hlmw0', '80qa776gp', 'bshii53i', '6h1y7ifid', '70h1iunsk', 'ak51srytx', 'bfyoqn7tc', '7fxobyj9u', '8kibyvzzz', '7m3ic1nos', '7w95qf8ve', 'bl9i624qa', '9nkrtdl4j', '1154bnkj0', '1vervi2hu', '267xt6nhs', 'a22hrz663', 'aqz2qx3e4', 'hw1lup76', '5x434bf68', '7jjoa0ohn', '1q1c44cy', 'cdqbjp74i', '6c5ejeq6r', '93pdfxjhv', '92slt3jyc', '928z5vk28', '6cvm07mp4', 'cdhqzs7t9'],
  ].map((rows) => {
    const size = rows.length;
    const dark = new Uint8Array(size * size);
    rows.forEach((row, r) => {
      let value = 0n;
      for (const ch of row) value = value * 36n + BigInt(parseInt(ch, 36));
      for (let c = 0; c < size; c++) dark[r * size + c] = Number((value >> BigInt(size - 1 - c)) & 1n);
    });
    return { size, dark };
  });

  let seed = 0x1178;
  const random = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed >>> 16;
  };

  interface Frame {
    width: number;
    height: number;
    channels: 1 | 4;
    pixels: Uint8Array;
  }

  /**
   * A grey frame. `place` maps a pixel to module coordinates times `unit` (integers), or null for
   * background; the symbol has a four-module quiet zone around it.
   */
  const grey = (width: number, height: number, place: (x: number, y: number) => [number, number, number] | null): Frame => {
    const pixels = new Uint8Array(width * height).fill(230);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = place(x, y);
        if (!at) continue;
        const [s, col, row] = at;
        const { size, dark } = symbols[s];
        if (row >= 0 && col >= 0 && row < size && col < size && dark[row * size + col]) pixels[y * width + x] = 25;
      }
    }
    return { width, height, channels: 1, pixels };
  };
  const scaled = (s: number, scale: number, left: number, top: number) => (x: number, y: number): [number, number, number] | null =>
    x < left || y < top ? null : [s, Math.floor((x - left) / scale), Math.floor((y - top) / scale)];

  const frames: Array<{ frame: Frame; flags: number; maxCodes: number }> = [];
  const add = (frame: Frame, flags = 0, maxCodes = 1) => frames.push({ frame, flags, maxCodes });

  add(grey(160, 160, scaled(0, 4, 30, 30)));
  add(grey(360, 360, scaled(1, 6, 45, 45)));
  // RGBA in colour: dark navy on cream.
  {
    const g = grey(160, 160, scaled(0, 4, 30, 30));
    const rgba = new Uint8Array(g.pixels.length * 4);
    g.pixels.forEach((v, i) => rgba.set(v < 128 ? [20, 30, 90, 255] : [250, 240, 210, 255], i * 4));
    add({ width: 160, height: 160, channels: 4, pixels: rgba });
  }
  // Sheared: each row shifts by a quarter of its distance from the top.
  add(grey(220, 200, (x, y) => {
    const sx = x - 30 - Math.floor((y - 30) / 4);
    return y < 30 || sx < 0 ? null : [0, Math.floor(sx / 5), Math.floor((y - 30) / 5)];
  }));
  // Scaled unevenly: 7 pixels a module across, 5 down.
  add(grey(380, 300, (x, y) => (x < 40 || y < 40 ? null : [1, Math.floor((x - 40) / 7), Math.floor((y - 40) / 5)])));
  // Noise of +/-40 grey levels.
  {
    const g = grey(200, 200, scaled(0, 5, 40, 40));
    for (let i = 0; i < g.pixels.length; i++) g.pixels[i] = Math.max(0, Math.min(255, g.pixels[i] + (random() % 81) - 40));
    add(g);
  }
  // Light on dark, read only with the inverted pass.
  {
    const g = grey(160, 160, scaled(0, 4, 30, 30));
    for (let i = 0; i < g.pixels.length; i++) g.pixels[i] = 255 - g.pixels[i];
    add(g);
    add(g, 2);
  }
  // Mirrored: columns and rows swapped.
  add(grey(160, 160, (x, y) => (x < 30 || y < 30 ? null : [0, Math.floor((y - 30) / 4), Math.floor((x - 30) / 4)])));
  // Two symbols in one frame.
  add(
    grey(520, 300, (x, y) => (x < 260 ? scaled(0, 4, 40, 40)(x, y) : scaled(1, 4, 290, 40)(x, y))),
    0,
    4
  );
  // Blank, then random, with every pass.
  add({ width: 320, height: 240, channels: 1, pixels: new Uint8Array(320 * 240).fill(128) }, 15, 8);
  add({ width: 320, height: 240, channels: 1, pixels: new Uint8Array(320 * 240).map(() => random() & 0xff) }, 15, 8);

  const out: number[] = [];
  const request = (frame: Frame, flags: number, maxCodes: number, header = true): number[] => {
    const { width, height, channels, pixels } = frame;
    const head = header
      ? [width & 0xff, (width >>> 8) & 0xff, 0, 0, height & 0xff, (height >>> 8) & 0xff, 0, 0, channels, flags, maxCodes, 0]
      : [];
    return [...head, ...pixels];
  };
  const run = (bytes: number[], maxCodes: number) => {
    const capacity = call('qr_decode_capacity', maxCodes);
    const input = call('alloc', bytes.length);
    const output = call('alloc', capacity);
    new Uint8Array(memory.buffer, input, bytes.length).set(bytes);
    const status = call('qr_decode', input, bytes.length, output, capacity);
    out.push(status);
    counts.push(status === 0 ? new Uint8Array(memory.buffer, output, 1)[0] : -1);
    if (status === 0) {
      // Walk the result to its end (the layout is in crates/qr-decode/src/lib.rs).
      const view = new DataView(memory.buffer, output, capacity);
      let end = 4;
      for (let i = 0; i < view.getUint8(0); i++) {
        const segments = view.getUint16(end + 74, true);
        const length = view.getUint32(end + 76, true);
        end += 80 + 16 * segments + length;
      }
      for (const byte of new Uint8Array(memory.buffer, output, end)) out.push(byte);
    }
    call('free', output, capacity);
    call('free', input, bytes.length);
  };
  for (const { frame, flags, maxCodes } of frames) run(request(frame, flags, maxCodes), maxCodes);
  // Refused requests: no pixels, a bad channel count, a bad flag, too many codes.
  const small = frames[0].frame;
  run(request(small, 0, 1).slice(0, 12), 1);
  run([...request(small, 0, 1).slice(0, 8), 3, 0, 1, 0, ...small.pixels], 1);
  run([...request(small, 0, 1).slice(0, 8), 1, 64, 1, 0, ...small.pixels], 1);
  run([...request(small, 0, 1).slice(0, 8), 1, 0, 9, 0, ...small.pixels], 1);
  return Uint8Array.from(out);
}
