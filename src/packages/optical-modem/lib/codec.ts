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

import { getConstellation } from './constellation';
import { acquireFrame, drawFrame, readDataCells, type AcquireFailure } from './frame';
import { MODEM_VERSION, type FrameHeader } from './header';
import { BAND_ROWS, type GridGeometry, type RgbaImage } from './layout';
import { createRng } from './prng';
import { MODEM_GEOMETRIES, type ModemProfile } from './profile';
import { rsDecode, rsEncode, type RsResult } from './rs';

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
  const bitsPerCell = getConstellation(shape.constellation).bitsPerCell;
  const blockBytes = shape.packetBytes + shape.parity;
  if (shape.packetBytes < 1 || shape.parity < 0 || blockBytes > 255) throw new Error('A block is 1 to 255 bytes, data and check bytes together');
  const dataCells = shape.cols * (shape.rows - 2 * BAND_ROWS);
  const streamBytes = Math.floor((dataCells * bitsPerCell) / 8);
  const blocks = Math.floor(streamBytes / blockBytes);
  if (blocks < 1) throw new Error('The grid is too small for one block');
  return { dataCells, bitsPerCell, streamBytes, blockBytes, blocks, payloadBytes: blocks * shape.packetBytes };
}

/** XORs a byte stream with a pseudo-random one, so long runs of one colour do not occur. */
function whiten(stream: Uint8Array, session: number, seq: number): void {
  const rng = createRng((session ^ Math.imul(seq + 1, 0x9e3779b1)) >>> 0);
  for (let i = 0; i < stream.length; i += 4) {
    const word = rng.nextUint32();
    for (let k = 0; k < 4 && i + k < stream.length; k++) stream[i + k] ^= (word >>> (8 * k)) & 255;
  }
}

/**
 * Encodes one frame. Each block is a Reed-Solomon codeword; bytes of different blocks alternate
 * across the grid, so a stripe lost to a screen refresh or a smudge costs every block a few bytes
 * rather than one block all of its bytes.
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
  const stream = new Uint8Array(capacity.streamBytes);
  const message = new Uint8Array(capacity.payloadBytes);
  message.set(payload);
  for (let b = 0; b < capacity.blocks; b++) {
    const word = rsEncode(message.subarray(b * profile.packetBytes, (b + 1) * profile.packetBytes), profile.parity);
    for (let i = 0; i < capacity.blockBytes; i++) stream[i * capacity.blocks + b] = word[i];
  }
  whiten(stream, session, seq);
  const symbols = new Uint8Array(capacity.dataCells);
  for (let c = 0; c < capacity.dataCells; c++) {
    let value = 0;
    for (let k = 0; k < capacity.bitsPerCell; k++) {
      const bit = c * capacity.bitsPerCell + k;
      const byte = bit >> 3;
      value = (value << 1) | (byte < stream.length ? (stream[byte] >> (7 - (bit & 7))) & 1 : 0);
    }
    symbols[c] = value;
  }
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
 * fail gives no data for those blocks; the outer code asks for more.
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
  const grid = readDataCells(image, acquired.frame);
  const bits = capacity.bitsPerCell;
  const stream = new Uint8Array(capacity.streamBytes);
  const sure = new Uint8Array(capacity.streamBytes).fill(255);
  for (let byte = 0; byte < stream.length; byte++) {
    let value = 0;
    for (let k = 0; k < 8; k++) {
      const bit = byte * 8 + k;
      const cell = Math.floor(bit / bits);
      value = (value << 1) | ((grid.symbols[cell] >> (bits - 1 - (bit % bits))) & 1);
    }
    stream[byte] = value;
    const first = Math.floor((byte * 8) / bits);
    const last = Math.floor((byte * 8 + 7) / bits);
    for (let cell = first; cell <= last; cell++) sure[byte] = Math.min(sure[byte], grid.confidence[cell]);
  }
  whiten(stream, header.session, header.seq);
  const soft = options.soft ?? true;
  const threshold = options.threshold ?? DEFAULT_ERASURE_THRESHOLD;
  const blocks: (Uint8Array | null)[] = [];
  let erasureTotal = 0;
  let corrected = 0;
  for (let b = 0; b < capacity.blocks; b++) {
    const word = new Uint8Array(capacity.blockBytes);
    const unsure: { at: number; confidence: number }[] = [];
    for (let i = 0; i < capacity.blockBytes; i++) {
      word[i] = stream[i * capacity.blocks + b];
      const confidence = sure[i * capacity.blocks + b];
      if (soft && confidence < threshold) unsure.push({ at: i, confidence });
    }
    // Spend at most all the check bytes on erasures, the least sure first; if that fails, half, then none.
    unsure.sort((x, y) => x.confidence - y.confidence || x.at - y.at);
    let result: RsResult = { ok: false };
    let used = 0;
    for (const limit of [header.parity, header.parity >> 1, 0]) {
      const marked = unsure.slice(0, limit).map((u) => u.at);
      result = rsDecode(word, header.parity, marked);
      if (result.ok) {
        used = marked.length;
        break;
      }
      if (marked.length === 0) break;
    }
    if (result.ok) {
      blocks.push(result.message);
      erasureTotal += used;
      corrected += result.corrected;
    } else {
      blocks.push(null);
    }
  }
  return { ok: true, header, blocks, blocksOk: blocks.filter((x) => x !== null).length, erasures: erasureTotal, corrected };
}
