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
 * A fixed workload for the optical kernels module (#1198) whose output must be identical, byte for
 * byte, in Node and in every browser engine: a sender on one device and a receiver on another must
 * read the same cells. Vitest pins its SHA-256 and Playwright compares each engine's hash with
 * Node's.
 */

/** SHA-256 of {@link runModemBattery}'s output for the committed `src/wasm/modem.wasm`. */
export const MODEM_BATTERY_SHA256 = '616312365282ccb72b2592a84e717488bdee9f4b8ebc5dcf73296d6c62050f57';

/**
 * Runs every kernel family once on seeded inputs: the constellations, the Reed-Solomon code, a
 * frame encoded, drawn through a homography with noise, sampled and decoded soft and hard, the
 * probe's per-frame analysis, the homography solve and the colour cross-talk model.
 *
 * Playwright copies this function's source into a worker, so it must stay self-contained: no
 * imports, helpers or values from outside its body.
 * @param exports - The raw exports of an instantiated `modem.wasm`.
 * @returns The concatenated results.
 */
export function runModemBattery(exports: WebAssembly.Exports): Uint8Array {
  const call = (name: string, ...args: number[]): number => {
    const target = exports[name];
    if (typeof target !== 'function') throw new Error(`modem.wasm has no ${name} export`);
    return Number(Reflect.apply(target, undefined, args));
  };
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('modem.wasm does not export its memory');

  // The same mulberry32 generator as tests/utils/scannerCorpus.ts, inlined.
  let state = 0x1198;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const below = (n: number): number => Math.floor(random() * n);

  const out: number[] = [];
  // A loop, not a spread: spreading a large array overflows the stack in Chromium.
  const pushBytes = (bytes: Uint8Array): void => {
    for (const byte of bytes) out.push(byte);
  };
  const pushI32 = (value: number): void => {
    out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  };
  const f64 = new Float64Array(1);
  const f64Bytes = new Uint8Array(f64.buffer);
  const pushF64 = (value: number): void => {
    f64[0] = value;
    pushBytes(f64Bytes);
  };

  const rx = call('modem_rx_new') >>> 0;
  const ioPtr = call('modem_rx_io', rx) >>> 0;
  // Fresh views each time: a call that allocates can grow, and so detach, the memory.
  const io = (): Float64Array => new Float64Array(memory.buffer, ioPtr, 256);
  const bytesAt = (ptr: number, len: number): Uint8Array => new Uint8Array(memory.buffer, ptr, len);
  const writeInput = (bytes: Uint8Array): void => {
    const ptr = call('modem_rx_input', rx, bytes.length) >>> 0;
    bytesAt(ptr, bytes.length).set(bytes);
  };
  const output = (len: number): Uint8Array => bytesAt(call('modem_rx_output', rx) >>> 0, len).slice();

  // Constellations: every id, the colours and the smallest gap.
  let fourColours = -1;
  for (let id = 0; id < 32; id++) {
    const size = call('modem_constellation', rx, id);
    pushI32(size);
    if (size === 0) continue;
    if (size === 4 && fourColours < 0) fourColours = id;
    for (let i = 0; i < size * 3; i++) out.push(io()[72 + i]);
    pushF64(io()[120]);
  }
  if (fourColours < 0) throw new Error('modem.wasm has no four-colour constellation');

  // Reed-Solomon: seeded codewords with errors and erasures, some beyond the code.
  for (let round = 0; round < 60; round++) {
    const parity = 2 + below(60);
    const messageLength = 1 + below(255 - parity);
    const message = new Uint8Array(messageLength).map(() => below(256));
    writeInput(message);
    pushI32(call('modem_rs_encode', rx, parity));
    const n = messageLength + parity;
    const word = output(n);
    pushBytes(word);
    const erasures: number[] = [];
    const erasureCount = below(parity + 1);
    while (erasures.length < erasureCount) {
      const at = below(n);
      if (!erasures.includes(at)) erasures.push(at);
    }
    for (const at of erasures) word[at] ^= below(256);
    for (let e = below(parity); e > 0; e--) word[below(n)] ^= 1 + below(255);
    writeInput(new Uint8Array([...word, ...erasures]));
    const repaired = call('modem_rs_decode', rx, n, parity);
    pushI32(repaired);
    if (repaired >= 0) pushBytes(output(messageLength));
  }

  // A frame: 104 x 58 cells, four colours, 80 data and 80 check bytes per block.
  const [cols, rows, packetBytes, parity, bits] = [104, 58, 80, 80, 2];
  const dataRows = rows - 18;
  const cells = cols * dataRows;
  const blocks = Math.floor((cells * bits) / 8 / (packetBytes + parity));
  const payload = new Uint8Array(blocks * packetBytes).map(() => below(256));
  writeInput(payload);
  pushI32(call('modem_frame_encode', rx, bits, cols, rows, packetBytes, parity, 0x1198, 7));
  const sent = output(cells);
  pushBytes(sent);

  // Drawn at about four pixels a cell through a slight perspective, with noise.
  const h = [4.01, 0.02, 3.3, -0.015, 3.99, 2.7, 0.00002, -0.00003, 1];
  const width = cols * 4 + 8;
  const height = rows * 4 + 8;
  call('modem_constellation', rx, fourColours);
  const colours = Array.from(io().subarray(72, 84));
  const imagePtr = call('modem_rx_image', rx, width, height) >>> 0;
  const image = bytesAt(imagePtr, width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const col = Math.floor((x + 0.5 - h[2]) / h[0]);
      const row = Math.floor((y + 0.5 - h[5]) / h[4]);
      const inData = col >= 0 && col < cols && row >= 9 && row < 9 + dataRows;
      const symbol = inData ? sent[(row - 9) * cols + col] : -1;
      for (let c = 0; c < 3; c++) {
        const level = symbol < 0 ? 128 : colours[symbol * 3 + c];
        image[(y * width + x) * 4 + c] = Math.max(0, Math.min(255, level + below(121) - 60));
      }
      image[(y * width + x) * 4 + 3] = 255;
    }
  }
  // No fiducials in this picture: acquiring it must fail the same way everywhere.
  io().set([cols, rows], 128);
  pushI32(call('modem_rx_acquire', rx, 1));
  io().set(h, 12);
  io().set(colours, 21);
  pushI32(call('modem_rx_sample', rx, cols, dataRows, 9, 4));
  const gridPtr = call('modem_rx_grid', rx, cells) >>> 0;
  pushBytes(bytesAt(gridPtr, cells * 5));
  for (const threshold of [32, 160, -1]) {
    pushI32(call('modem_rx_decode', rx, bits, cols, rows, packetBytes, parity, 0x1198, 7, threshold));
    pushBytes(output(blocks + blocks * packetBytes));
    for (let i = 0; i < 3; i++) pushF64(io()[72 + i]);
  }

  // The probe: a grid frame against the sent symbols and a shuffled variant, then the rest.
  const other = sent.map((s, i) => (i % 3 === 0 ? (s + 1) & 3 : s));
  writeInput(new Uint8Array([...sent, ...other]));
  const totals = 2 + 16 + 4 * 7;
  new Float64Array(memory.buffer, call('modem_rx_state', rx, totals) >>> 0, totals).fill(0);
  pushI32(call('modem_probe_grid', rx, cols, dataRows, 4));
  pushF64(io()[72]);
  for (const value of new Float64Array(memory.buffer, call('modem_rx_state', rx, totals) >>> 0, totals)) pushF64(value);
  pushF64(call('modem_probe_mutual_information', rx, 4));
  pushI32(call('modem_probe_flicker', rx, cells));
  for (let i = 0; i < 3; i++) pushF64(io()[72 + i]);
  pushI32(call('modem_probe_edge', rx, cols, rows));
  pushF64(call('modem_probe_cell_size', rx, cols, rows));

  // The homography through four seeded points.
  for (let round = 0; round < 8; round++) {
    const points = [4.5, 4.5, 99.5, 4.5, 4.5, 53.5, 99.5, 53.5];
    for (let i = 0; i < 8; i++) points.push(points[i] * 4 + 20 + random() * 40);
    io().set(points, 128);
    pushI32(call('modem_homography', rx));
    for (let i = 0; i < 9; i++) pushF64(io()[72 + i]);
  }

  // Colour cross-talk: a fit to seeded swatches, a rescale to a dimmer white and a split.
  // The swatches in the module's order: black, red, green, blue, cyan, magenta, yellow, white.
  const emitted = [0b000, 0b100, 0b010, 0b001, 0b011, 0b101, 0b110, 0b111];
  const swatches: number[] = [];
  for (const on of emitted) {
    const ideal = [on & 4 ? 230 : 20, on & 2 ? 230 : 20, on & 1 ? 230 : 20];
    for (let c = 0; c < 3; c++) swatches.push(ideal[c] * 0.8 + ideal[(c + 1) % 3] * 0.1 + 10 + random() * 6);
  }
  io().set(swatches, 128);
  const fitted = call('modem_crosstalk_fit', rx);
  pushI32(fitted);
  const model = Array.from(io().subarray(72, 97));
  for (const value of model) pushF64(value);
  if (fitted === 1) {
    io().set([...model.slice(0, 12), ...model.slice(21, 25), ...model.slice(21, 24).map((w) => w * 0.9)], 128);
    pushI32(call('modem_crosstalk_rescale', rx));
    for (let i = 0; i < 25; i++) pushF64(io()[72 + i]);
    const pixels = new Uint8Array(64 * 4).map(() => below(256));
    writeInput(pixels);
    io().set([...model.slice(12, 21), ...model.slice(9, 12), 255], 128);
    pushI32(call('modem_crosstalk_split', rx, 64));
    pushBytes(output(64 * 3));
  }

  call('modem_rx_free', rx);
  pushI32(call('abi_version'));
  return new Uint8Array(out);
}
