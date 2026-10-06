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

import { constellationShape } from './constellation';
import { acquireFrame, drawFrame, type AcquireFailure } from './frame';
import { MODEM_VERSION, type FrameHeader } from './header';
import { kernelUniforms, type KernelUniforms, type SampledGrid } from './kernel';
import { modemKernels } from './kernels';
import { BAND_ROWS, type GridGeometry, type RgbaImage } from './layout';
import { MODEM_GEOMETRIES, type ModemProfile } from './profile';

/** What a profile can carry in one frame. */
export interface FrameCapacity {
  /** Cells in the data grid. */
  dataCells: number;
  bitsPerCell: number;
  /** Whole bytes the grid holds. */
  streamBytes: number;
  /** Bytes in one inner code block: data plus check bytes. */
  blockBytes: number;
  /** Inner code blocks in one frame. */
  blocks: number;
  /** Data bytes in one frame: `blocks * packetBytes`. */
  payloadBytes: number;
}

/** The part of a profile that decides the frame's capacity. */
export type FrameShape = Pick<ModemProfile, 'constellation' | 'cols' | 'rows' | 'packetBytes' | 'parity'>;

/**
 * How many blocks and bytes a frame holds.
 * @param shape - Constellation, grid and inner code.
 * @returns The capacity.
 * @throws Error when a block would not fit a Reed-Solomon codeword or no block fits the grid.
 */
export function frameCapacity(shape: FrameShape): FrameCapacity {
  const { bitsPerCell } = constellationShape(shape.constellation);
  const blockBytes = shape.packetBytes + shape.parity;
  if (shape.packetBytes < 1 || shape.parity < 0 || blockBytes > 255) throw new Error('A block is 1 to 255 bytes, data and check bytes together');
  const dataCells = shape.cols * (shape.rows - 2 * BAND_ROWS);
  const streamBytes = Math.floor((dataCells * bitsPerCell) / 8);
  const blocks = Math.floor(streamBytes / blockBytes);
  if (blocks < 1) throw new Error('The grid is too small for one block');
  return { dataCells, bitsPerCell, streamBytes, blockBytes, blocks, payloadBytes: blocks * shape.packetBytes };
}

/**
 * Encodes one frame. Each block is a Reed-Solomon codeword; bytes of different blocks alternate
 * across the grid, so a stripe lost to a screen refresh or a smudge costs every block a few bytes
 * rather than one block all of its bytes. The stream is whitened so long runs of one colour do not
 * occur. The coding runs in the modem module.
 * @param profile - The profile, or any custom shape with a grid and an inner code.
 * @param payload - Up to `payloadBytes` bytes; the rest of the frame is zero padded.
 * @param session - Session id, 32 bits.
 * @param seq - Frame number, 32 bits.
 * @param pitch - Pixels per cell.
 * @returns The frame image.
 */
export function encodeModemFrame(profile: Pick<ModemProfile, 'id'> & FrameShape, payload: Uint8Array, session: number, seq: number, pitch: number): RgbaImage {
  const capacity = frameCapacity(profile);
  if (payload.length > capacity.payloadBytes) throw new Error(`A frame of this profile carries at most ${capacity.payloadBytes} bytes`);
  const symbols = modemKernels().encodeFrame(capacity.bitsPerCell, profile, payload, session, seq);
  const header: FrameHeader = {
    version: MODEM_VERSION,
    profile: profile.id,
    constellation: profile.constellation,
    packetBytes: profile.packetBytes,
    parity: profile.parity,
    flags: 0,
    session,
    seq,
    cols: profile.cols,
    rows: profile.rows,
  };
  return drawFrame(header, symbols, pitch);
}

/** Options for {@link decodeModemFrame}. */
export interface DecodeOptions {
  /** Grid sizes to look for. Defaults to those of the provisional profiles. */
  geometries?: readonly GridGeometry[];
  /** Treat unsure bytes as erasures (default). Off, the code has to find every wrong byte itself. */
  soft?: boolean;
  /** A cell with a confidence below this (0 to 255) marks the bytes it carries as unsure. */
  threshold?: number;
  /**
   * Samples the data cells in place of the reference kernel (a GPU kernel, for example). It gets the
   * same inputs and has to give the same bytes; return null to have the reference kernel do it.
   */
  sampleGrid?: (image: RgbaImage, uniforms: KernelUniforms) => SampledGrid | null;
}

/** Confidence under which a cell's bytes count as erasures, unless told otherwise. */
export const DEFAULT_ERASURE_THRESHOLD = 32;

/** Why a frame was not decoded. */
export type DecodeFailure = AcquireFailure | 'invalid-header';

/** Result of {@link decodeModemFrame}. */
export type DecodedFrame =
  | {
      ok: true;
      header: FrameHeader;
      /** The data of each block, or null for a block the code could not repair. */
      blocks: (Uint8Array | null)[];
      blocksOk: number;
      /** Bytes handed to the code as erasures, over all blocks. */
      erasures: number;
      /** Bytes the code repaired, over the blocks it could decode. */
      corrected: number;
    }
  | { ok: false; reason: DecodeFailure };

/**
 * Reads a captured frame: finds it, reads its header, classifies the cells against the live
 * calibration patches, and decodes every block. A frame whose header is damaged or whose blocks
 * fail gives no data for those blocks; the outer code asks for more. Each block spends at most
 * all its check bytes on erasures, the least sure bytes first; if that fails, half, then none.
 * @param image - The captured image.
 * @param options - Geometries to try and how to use confidence.
 * @returns The decoded blocks or why the frame was unreadable.
 */
export function decodeModemFrame(image: RgbaImage, options: DecodeOptions = {}): DecodedFrame {
  const acquired = acquireFrame(image, options.geometries ?? MODEM_GEOMETRIES);
  if (!acquired.ok) return { ok: false, reason: acquired.reason };
  const { header } = acquired.frame;
  let capacity: FrameCapacity;
  try {
    capacity = frameCapacity(header);
  } catch {
    return { ok: false, reason: 'invalid-header' };
  }
  const kernels = modemKernels();
  const uniforms = kernelUniforms(acquired.frame);
  const cells = capacity.dataCells;
  const external = options.sampleGrid?.(image, uniforms) ?? null;
  if (external) {
    const grid = kernels.grid(cells);
    grid.fill(0);
    grid.set(external.symbols.subarray(0, cells), 0);
    grid.set(external.confidence.subarray(0, cells), cells);
    grid.set(external.means.subarray(0, 3 * cells), 2 * cells);
  } else {
    if (options.sampleGrid) {
      // The sampler may have used the module's image and uniforms for something else.
      kernels.setImage(image);
      kernels.setUniforms(uniforms.homography, uniforms.palette);
    }
    kernels.sample(uniforms.cols, uniforms.dataRows, uniforms.rowOffset, uniforms.palette.length / 3);
  }
  const soft = options.soft ?? true;
  const decoded = kernels.decode(capacity.bitsPerCell, header, header.session, header.seq, soft ? (options.threshold ?? DEFAULT_ERASURE_THRESHOLD) : null);
  const blocks: (Uint8Array | null)[] = [];
  for (let b = 0; b < capacity.blocks; b++) {
    blocks.push(decoded.ok[b] ? decoded.data.slice(b * header.packetBytes, (b + 1) * header.packetBytes) : null);
  }
  return { ok: true, header, blocks, blocksOk: decoded.blocksOk, erasures: decoded.erasures, corrected: decoded.corrected };
}
