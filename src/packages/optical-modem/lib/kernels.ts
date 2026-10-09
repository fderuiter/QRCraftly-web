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
 * The modem's kernels (#1198): Reed-Solomon, the frame codec, fiducial search, cell sampling, the
 * constellations, the probe analysis and the colour cross-talk model, all in the Rust module
 * `crates/modem`, built to `src/wasm/modem.wasm`. This file loads it and moves data across.
 *
 * One receiver (`Rx`) lives in the module for the life of the page. It owns every buffer the
 * kernels use (the image, the grid, the probe state, the scratch of the fiducial search), so a
 * frame allocates nothing in the module once the buffers have grown to the frame size. Small
 * arguments and results travel through its `io` block of 256 doubles.
 */
import { WasmModuleError, checkStatus, compileWasmBytes, compileWasmUrl, instantiateWasm, type WasmInstance } from '@/packages/wasm-runtime';
import type { GridGeometry, RgbaImage } from './layout';

/**
 * Bytes of the CRC-32 tag after each block's data, inside the Reed-Solomon codeword. It covers the
 * session, the frame sequence, the block's index and its data, so a wrong repair or a block read
 * under the wrong identity is refused (ADR 0043). Must match `TAG_BYTES` in `crates/modem/src/codec.rs`.
 */
export const BLOCK_TAG_BYTES = 4;

/** Slots of the `io` block, in doubles. Must match `crates/modem/src/lib.rs`. */
const IO_FIDUCIALS = 0;
const IO_CORES = 8;
const IO_HOMOGRAPHY = 12;
const IO_PALETTE = 21;
const IO_OUT = 72;
const IO_IN = 128;
const IO_LENGTH = 256;
/** Geometries one acquisition can try. */
const MAX_GEOMETRIES = 64;
/** Bytes of a header message. */
const HEADER_MESSAGE_BYTES = 18;

/** Why the module could not find a frame, by the code `modem_rx_acquire` returns. */
export const ACQUIRE_FAILURES = ['no-fiducials', 'no-header', 'low-contrast', 'unsupported-version', 'unknown-constellation'] as const;

/** Why a frame could not be acquired. */
export type AcquireFailure = (typeof ACQUIRE_FAILURES)[number];

/** A point in image pixels; pixel `(i, j)` covers `[i, i + 1) x [j, j + 1)`. */
export interface Point {
  x: number;
  y: number;
}

/** Four fiducial centres in clockwise order, the one with the biggest core mark first. */
export interface FiducialSearch {
  /** Centres, clockwise on screen. Index 0 is the fiducial the core marks suggest is top-left. */
  points: Point[];
  /** Dark core area of each fiducial in pixels, in the same order. */
  coreAreas: number[];
}

/** What one inner-code decode of a frame gave. Views into the module: read them before the next call. */
export interface BlockDecode {
  /** 1 for each block the code repaired. */
  ok: Uint8Array;
  /** The data bytes of every block, `packetBytes` each. */
  data: Uint8Array;
  blocksOk: number;
  erasures: number;
  corrected: number;
  /** Blocks whose tag refused the code's first repair. */
  refused: number;
}

/** The fitted cross-talk model as the module returns it: 9 + 3 + 9 + 3 + 1 numbers. */
export interface CrossTalkNumbers {
  matrix: number[];
  offset: number[];
  inverse: number[];
  white: number[];
  residual: number;
}

type Fn = (...args: number[]) => number;

/** Typed access to the module's exports and the receiver it keeps. */
export class ModemKernels {
  private readonly wasm: WasmInstance;
  private readonly rx: number;
  private readonly ioPtr: number;
  private readonly headerPtr: number;
  private readonly rxImage: Fn;
  private readonly rxInput: Fn;
  private readonly rxOutput: Fn;
  private readonly rxGrid: Fn;
  private readonly rxState: Fn;
  private readonly rxAcquire: Fn;
  private readonly rxSample: Fn;
  private readonly rxDecode: Fn;
  private readonly frameEncode: Fn;
  private readonly rsEncodeFn: Fn;
  private readonly constellationFn: Fn;
  private readonly homographyFn: Fn;
  private readonly probeGridFn: Fn;
  private readonly probeFlickerFn: Fn;
  private readonly probeEdgeFn: Fn;
  private readonly probeCellSizeFn: Fn;
  private readonly probeMutualInformationFn: Fn;
  private readonly crosstalkFitFn: Fn;
  private readonly crosstalkRescaleFn: Fn;
  private readonly crosstalkSplitFn: Fn;

  constructor(wasm: WasmInstance) {
    this.wasm = wasm;
    this.rx = wasm.fn('modem_rx_new')();
    if (this.rx === 0) throw new WasmModuleError('memory', 'The modem module could not make its receiver.');
    this.ioPtr = wasm.fn('modem_rx_io')(this.rx);
    this.headerPtr = wasm.fn('modem_rx_header')(this.rx);
    this.rxImage = wasm.fn('modem_rx_image');
    this.rxInput = wasm.fn('modem_rx_input');
    this.rxOutput = wasm.fn('modem_rx_output');
    this.rxGrid = wasm.fn('modem_rx_grid');
    this.rxState = wasm.fn('modem_rx_state');
    this.rxAcquire = wasm.fn('modem_rx_acquire');
    this.rxSample = wasm.fn('modem_rx_sample');
    this.rxDecode = wasm.fn('modem_rx_decode');
    this.frameEncode = wasm.fn('modem_frame_encode');
    this.rsEncodeFn = wasm.fn('modem_rs_encode');
    this.constellationFn = wasm.fn('modem_constellation');
    this.homographyFn = wasm.fn('modem_homography');
    this.probeGridFn = wasm.fn('modem_probe_grid');
    this.probeFlickerFn = wasm.fn('modem_probe_flicker');
    this.probeEdgeFn = wasm.fn('modem_probe_edge');
    this.probeCellSizeFn = wasm.fn('modem_probe_cell_size');
    this.probeMutualInformationFn = wasm.fn('modem_probe_mutual_information');
    this.crosstalkFitFn = wasm.fn('modem_crosstalk_fit');
    this.crosstalkRescaleFn = wasm.fn('modem_crosstalk_rescale');
    this.crosstalkSplitFn = wasm.fn('modem_crosstalk_split');
  }

  /** The `io` block. A fresh view each time, since memory may have grown. */
  private io(): Float64Array {
    return new Float64Array(this.wasm.memory.buffer, this.ioPtr, IO_LENGTH);
  }

  private bytes(ptr: number, length: number): Uint8Array {
    if (ptr === 0 && length > 0) throw new WasmModuleError('status', 'The modem module refused a buffer of this size.');
    return new Uint8Array(this.wasm.memory.buffer, ptr, length);
  }

  /** Sizes the receiver's input to `length` bytes and returns a view to fill. */
  private input(length: number): Uint8Array {
    return this.bytes(this.rxInput(this.rx, length), length);
  }

  private output(length: number): Uint8Array {
    return this.bytes(this.rxOutput(this.rx), length);
  }

  /**
   * Copies a camera frame into the receiver; the acquisition, sampling and probe kernels read it.
   * @param image - RGBA pixels.
   */
  public setImage(image: RgbaImage): void {
    const length = image.width * image.height * 4;
    const ptr = this.rxImage(this.rx, image.width, image.height);
    if (ptr === 0) throw new WasmModuleError('status', `The modem module cannot take a ${image.width} x ${image.height} frame.`);
    this.bytes(ptr, length).set(new Uint8Array(image.data.buffer, image.data.byteOffset, length));
  }

  /**
   * Finds a frame in the image last set: the fiducials, then the header against each geometry.
   * @param geometries - Grid sizes to try.
   * @returns 0 when a frame was found, or the 1-based index of its failure in {@link ACQUIRE_FAILURES}.
   */
  public acquire(geometries: readonly GridGeometry[]): number {
    if (geometries.length === 0 || geometries.length > MAX_GEOMETRIES) throw new Error(`Give 1 to ${MAX_GEOMETRIES} geometries`);
    const io = this.io();
    geometries.forEach((g, i) => {
      io[IO_IN + 2 * i] = g.cols;
      io[IO_IN + 2 * i + 1] = g.rows;
    });
    const status = this.rxAcquire(this.rx, geometries.length);
    if (status < 0) throw new WasmModuleError('status', 'The modem module refused these geometries.');
    return status;
  }

  /** The fiducials the last acquisition found, or null. */
  public fiducials(): FiducialSearch | null {
    const io = this.io();
    if (io[IO_CORES] < 0) return null;
    return {
      points: [0, 1, 2, 3].map((i) => ({ x: io[IO_FIDUCIALS + 2 * i], y: io[IO_FIDUCIALS + 2 * i + 1] })),
      coreAreas: [0, 1, 2, 3].map((i) => io[IO_CORES + i]),
    };
  }

  /** The header message of the frame last acquired, 18 bytes. */
  public headerMessage(): Uint8Array {
    return this.bytes(this.headerPtr, HEADER_MESSAGE_BYTES).slice();
  }

  /** The homography of the frame last acquired, as nine 32-bit floats. */
  public homography(): Float32Array {
    return Float32Array.from(this.io().subarray(IO_HOMOGRAPHY, IO_HOMOGRAPHY + 9));
  }

  /** The palette of the frame last acquired, three integers per symbol. */
  public palette(symbols: number): Int32Array {
    return Int32Array.from(this.io().subarray(IO_PALETTE, IO_PALETTE + symbols * 3));
  }

  /**
   * Sets the homography and palette the sampler reads, in place of those an acquisition left.
   * @param homography - Nine 32-bit floats.
   * @param palette - Three integers per symbol, at most 16 symbols.
   */
  public setUniforms(homography: Float32Array, palette: Int32Array): void {
    const io = this.io();
    io.set(homography.subarray(0, 9), IO_HOMOGRAPHY);
    io.set(palette, IO_PALETTE);
  }

  /**
   * Samples and classifies the data cells of the image into the receiver's grid.
   * @param cols - Cells across.
   * @param dataRows - Data rows.
   * @param rowOffset - Frame row of the first data row.
   * @param symbols - Symbols in the palette.
   */
  public sample(cols: number, dataRows: number, rowOffset: number, symbols: number): void {
    checkStatus(this.rxSample(this.rx, cols, dataRows, rowOffset, symbols), 'modem_rx_sample');
  }

  /**
   * The receiver's grid: symbols, then confidences, then three mean bytes per cell. A view to read
   * a sampled grid or to fill with one sampled elsewhere.
   * @param cells - Data cells; resizes the grid when it differs.
   * @returns The view.
   */
  public grid(cells: number): Uint8Array {
    return this.bytes(this.rxGrid(this.rx, cells), cells * 5);
  }

  /**
   * Decodes the receiver's grid: de-interleaves, de-whitens, repairs every block and checks its tag.
   * @param bits - Bits per cell.
   * @param shape - Grid and inner code.
   * @param session - Session id.
   * @param seq - Frame number.
   * @param threshold - Confidence under which bytes are erasures, or null for hard decoding.
   * @returns Views of the blocks and the counts.
   */
  public decode(
    bits: number,
    shape: { cols: number; rows: number; packetBytes: number; parity: number },
    session: number,
    seq: number,
    threshold: number | null
  ): BlockDecode {
    checkStatus(this.rxDecode(this.rx, bits, shape.cols, shape.rows, shape.packetBytes, shape.parity, session, seq, threshold ?? -1), 'modem_rx_decode');
    const io = this.io();
    const blocks = Math.floor(Math.floor((shape.cols * (shape.rows - 18) * bits) / 8) / (shape.packetBytes + BLOCK_TAG_BYTES + shape.parity));
    const out = this.output(blocks + blocks * shape.packetBytes);
    return { ok: out.subarray(0, blocks), data: out.subarray(blocks), blocksOk: io[IO_OUT], erasures: io[IO_OUT + 1], corrected: io[IO_OUT + 2], refused: io[IO_OUT + 3] };
  }

  /**
   * Encodes a frame's data cells: Reed-Solomon blocks, interleaved and whitened.
   * @returns One symbol per data cell (a copy).
   */
  public encodeFrame(bits: number, shape: { cols: number; rows: number; packetBytes: number; parity: number }, payload: Uint8Array, session: number, seq: number): Uint8Array {
    this.input(payload.length).set(payload);
    checkStatus(this.frameEncode(this.rx, bits, shape.cols, shape.rows, shape.packetBytes, shape.parity, session >>> 0, seq >>> 0), 'modem_frame_encode');
    return this.output(shape.cols * (shape.rows - 18)).slice();
  }

  /**
   * Appends `parity` Reed-Solomon check bytes to a message.
   * @returns The codeword (a copy).
   */
  public rsEncode(message: Uint8Array, parity: number): Uint8Array {
    this.input(message.length).set(message);
    checkStatus(this.rsEncodeFn(this.rx, parity), 'modem_rs_encode');
    return this.output(message.length + parity).slice();
  }

  /**
   * A constellation's colours and the smallest OKLab gap between two of them.
   * @param id - Constellation id.
   * @returns The colours, or null when the id names none.
   */
  public constellation(id: number): { symbols: [number, number, number][]; minDistance: number } | null {
    const size = this.constellationFn(this.rx, id);
    if (size === 0) return null;
    const io = this.io();
    const symbols: [number, number, number][] = [];
    for (let s = 0; s < size; s++) symbols.push([io[IO_OUT + 3 * s], io[IO_OUT + 3 * s + 1], io[IO_OUT + 3 * s + 2]]);
    return { symbols, minDistance: io[IO_OUT + 48] };
  }

  /**
   * The homography taking four source points to four targets.
   * @returns Nine numbers (the last is 1), or null when the points are degenerate.
   */
  public solveHomography(source: readonly (readonly [number, number])[], target: readonly Point[]): Float64Array | null {
    const io = this.io();
    for (let i = 0; i < 4; i++) {
      io[IO_IN + 2 * i] = source[i][0];
      io[IO_IN + 2 * i + 1] = source[i][1];
      io[IO_IN + 8 + 2 * i] = target[i].x;
      io[IO_IN + 8 + 2 * i + 1] = target[i].y;
    }
    if (this.homographyFn(this.rx) === 0) return null;
    return Float64Array.from(this.io().subarray(IO_OUT, IO_OUT + 9));
  }

  /**
   * Sorts the grid last sampled into clean, torn or blended against the two variants, and adds a
   * clean one to the pattern's running totals.
   * @param own - Symbols of the variant the header names.
   * @param other - Symbols of the other variant.
   * @param state - The pattern's totals; updated in place.
   * @returns The verdict (0 clean, 1 torn, 2 blended) and a clean frame's mean confidence.
   */
  public probeGrid(own: Uint8Array, other: Uint8Array, state: Float64Array, cols: number, dataRows: number, size: number): { status: number; confidence: number } {
    const cells = cols * dataRows;
    const input = this.input(cells * 2);
    input.set(own);
    input.set(other, cells);
    const statePtr = this.rxState(this.rx, state.length);
    new Float64Array(this.wasm.memory.buffer, statePtr, state.length).set(state);
    const status = this.probeGridFn(this.rx, cols, dataRows, size);
    if (status < 0) throw new WasmModuleError('status', 'modem_probe_grid refused its input.');
    state.set(new Float64Array(this.wasm.memory.buffer, statePtr, state.length));
    return { status, confidence: this.io()[IO_OUT] };
  }

  /** The mean colour of the grid last sampled, in OKLab. */
  public probeFlicker(cells: number): [number, number, number] {
    checkStatus(this.probeFlickerFn(this.rx, cells), 'modem_probe_flicker');
    const io = this.io();
    return [io[IO_OUT], io[IO_OUT + 1], io[IO_OUT + 2]];
  }

  /** The slanted edge's line spread and MTF50 in the image last set, through the homography in place. */
  public probeEdge(cols: number, rows: number): { sigmaCells: number; mtf50CyclesPerCell: number } | null {
    if (this.probeEdgeFn(this.rx, cols, rows) === 0) return null;
    const io = this.io();
    return { sigmaCells: io[IO_OUT], mtf50CyclesPerCell: io[IO_OUT + 1] };
  }

  /** Size of a cell in camera pixels around the middle of the frame, from the homography in place. */
  public probeCellSize(cols: number, rows: number): number {
    return this.probeCellSizeFn(this.rx, cols, rows);
  }

  /**
   * Mutual information per cell of a pattern's confusion counts.
   * @param state - Totals as {@link probeGrid} keeps them, or two zeros and the counts.
   * @param size - Symbols.
   * @returns Bits per cell.
   */
  public mutualInformation(state: Float64Array, size: number): number {
    const statePtr = this.rxState(this.rx, state.length);
    new Float64Array(this.wasm.memory.buffer, statePtr, state.length).set(state);
    return this.probeMutualInformationFn(this.rx, size);
  }

  private model(): CrossTalkNumbers {
    const io = this.io();
    const at = (from: number, count: number): number[] => Array.from(io.subarray(IO_OUT + from, IO_OUT + from + count));
    return { matrix: at(0, 9), offset: at(9, 3), inverse: at(12, 9), white: at(21, 3), residual: io[IO_OUT + 24] };
  }

  /**
   * Fits the cross-talk model to the eight calibration swatches.
   * @param observed - 24 levels, the swatches in order, red first.
   * @returns The model, or null when the patch cannot be trusted.
   */
  public crossTalkFit(observed: readonly number[]): CrossTalkNumbers | null {
    this.io().set(observed, IO_IN);
    return this.crosstalkFitFn(this.rx) === 0 ? null : this.model();
  }

  /**
   * Scales a model so that white lands on a new white.
   * @returns The new model, or null when the new white cannot be used.
   */
  public crossTalkRescale(model: CrossTalkNumbers, white: readonly number[]): CrossTalkNumbers | null {
    const io = this.io();
    io.set(model.matrix, IO_IN);
    io.set(model.offset, IO_IN + 9);
    io.set(model.white, IO_IN + 12);
    io[IO_IN + 15] = model.residual;
    io.set(white, IO_IN + 16);
    return this.crosstalkRescaleFn(this.rx) === 0 ? null : this.model();
  }

  /**
   * Undoes the cross-talk on RGBA pixels and splits them into three planes.
   * @param count - Pixels.
   * @param fill - Writes the RGBA pixels, `count * 4` bytes, into the module's input.
   * @param inverse - Inverse matrix, row by row.
   * @param offset - Black level.
   * @param scale - 255 to give bytes from a model, 1 for raw channels.
   * @returns The three planes one after another, a view into the module.
   */
  public crossTalkSplit(count: number, fill: (input: Uint8Array) => void, inverse: readonly number[], offset: readonly number[], scale: number): Uint8Array {
    fill(this.input(count * 4));
    const io = this.io();
    io.set(inverse, IO_IN);
    io.set(offset, IO_IN + 9);
    io[IO_IN + 12] = scale;
    checkStatus(this.crosstalkSplitFn(this.rx, count), 'modem_crosstalk_split');
    return this.output(count * 3);
  }
}

/** The module's URL in a build: Vite emits the file as an asset next to the bundle. */
const MODEM_WASM_URL = new URL('../../../wasm/modem.wasm', import.meta.url);

/** Under Node (tests, scripts) this file has a `file:` URL and the module is read from `src/wasm/`. */
function moduleUrl(): URL {
  const here = import.meta.url;
  return here.startsWith('file:') ? new URL('../../../wasm/modem.wasm', here) : MODEM_WASM_URL;
}

let kernels: ModemKernels | null = null;
let loading: Promise<void> | null = null;

/**
 * Loads the modem module once per page or worker. Everything that decodes, encodes or analyses a
 * frame needs it; call this first and await it. A failed load can be retried.
 * @param bytes - The module's bytes, for a page that cannot fetch it from its own origin (a test
 * harness); by default it is fetched from the site.
 * @returns Resolves when the kernels are ready.
 */
export function loadModemKernels(bytes?: BufferSource): Promise<void> {
  if (kernels) return Promise.resolve();
  loading ??= (bytes ? compileWasmBytes(bytes) : compileWasmUrl(moduleUrl()))
    .then(instantiateWasm)
    .then((instance) => {
      kernels = new ModemKernels(instance);
    })
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

/**
 * The loaded kernels.
 * @returns The kernels.
 * @throws WasmModuleError when {@link loadModemKernels} has not finished.
 */
export function modemKernels(): ModemKernels {
  if (!kernels) throw new WasmModuleError('load', 'The optical modem module is not loaded: await loadOpticalModem() first.');
  return kernels;
}
