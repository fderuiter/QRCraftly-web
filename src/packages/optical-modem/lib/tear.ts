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
 * Torn captures (ADR 0049): a screen refresh during the camera's readout shows one frame above a
 * camera row and the next below it. The receiver decodes each side against its own frame sequence
 * with the other side's bytes erased, and keeps the cells of a frame it saw only in part for the
 * next capture, which shows the rest of it. Nothing in the frame format changes; the block tag
 * (ADR 0043) refuses every block read under the wrong sequence.
 */
import type { FrameHeader } from './header';
import type { CarriedCells, ModemKernels, TornSide } from './kernels';
import { BAND_ROWS } from './layout';

/**
 * The cells of a frame a torn capture showed only in part, kept for the next capture to finish. Pass
 * it back as the next decode's `carry` option; it is used only for the same session, shape and
 * frame.
 */
export interface TearCarry extends CarriedCells {
  session: number;
  cols: number;
  rows: number;
  constellation: number;
  packetBytes: number;
  parity: number;
}

/** Blocks of another frame than the header's, recovered from a torn capture. */
export interface TornBlocks {
  /** That frame's sequence: name its blocks by it, not by the header's. */
  seq: number;
  /** The data of each block, or null. */
  blocks: (Uint8Array | null)[];
  blocksOk: number;
}

/** What the tear recovery did with a capture. */
export interface TearReport {
  /** The sequence the top and the bottom header strip each gave when read alone, or null. */
  strips: [number | null, number | null];
  /** The frame sequence above and below the cut that gave blocks, or the last pair tried. */
  seqs: [number, number];
  /** Each side's cut, in grid rows across the camera's rows, or null when that side gave nothing. */
  cuts: [number | null, number | null];
  /** Blocks each side gave that the plain decode had not. */
  blocksOk: [number, number];
  /**
   * Blocks whose first repair the tag refused in the full decode of a side, over every pair of
   * sequences tried. The trial blocks of the cut search are not counted.
   */
  refused: number;
  /** Pairs of sequences tried. */
  tried: number;
}

/** What {@link recoverTear} adds to a frame's decode. */
interface TearRecovery {
  report: TearReport;
  /** Blocks of the header's frame that the plain decode had not repaired. */
  blocks: (Uint8Array | null)[];
  erasures: number;
  corrected: number;
  others: TornBlocks[];
  carry?: TearCarry;
}

/**
 * The pairs of frame sequences (above the cut, below it) a capture may be torn between. Two strips
 * that agree leave no tear to find. Two that differ name the pair. When a strip did not decode
 * alone, a tear may run through it, so its side is guessed as the next or the previous frame
 * (`seq ± 1`): the tag refuses a wrong guess.
 * @param seq - The header's sequence.
 * @param strips - What the top and the bottom strip gave alone.
 * @returns Pairs to try, most likely first.
 */
function tearHypotheses(seq: number, strips: readonly [number | null, number | null]): [number, number][] {
  const [top, bottom] = strips;
  const next = (seq + 1) >>> 0;
  const previous = (seq - 1) >>> 0;
  if (top !== null && bottom !== null) return top === bottom ? [] : [[top, bottom]];
  // A camera reading its rows from the top shows the earlier frame above the tear and the later one below.
  if (top !== null) return [[seq, next], [seq, previous]];
  if (bottom !== null) return [[previous, seq], [next, seq]];
  return [
    [seq, next],
    [previous, seq],
    [seq, previous],
    [next, seq],
  ];
}

/** Whether a carry belongs to this frame's session and shape, and holds a cell per data cell. */
function carryFits(carry: TearCarry | undefined, header: FrameHeader): carry is TearCarry {
  const cells = header.cols * (header.rows - 2 * BAND_ROWS);
  return (
    carry !== undefined &&
    carry.session === header.session &&
    carry.cols === header.cols &&
    carry.rows === header.rows &&
    carry.constellation === header.constellation &&
    carry.packetBytes === header.packetBytes &&
    carry.parity === header.parity &&
    (carry.side === 0 || carry.side === 1) &&
    carry.homography.length >= 9 &&
    carry.symbols.length >= cells &&
    carry.confidence.length >= cells
  );
}

/** Whether `later` is the frame after `earlier`. */
const follows = (later: number, earlier: number): boolean => later === ((earlier + 1) >>> 0);

/**
 * Recovers what a torn capture holds beyond the plain decode. Call it after the plain decode of the
 * grid in the module, with that decode's block flags. Tries each pair of sequences from
 * {@link tearHypotheses} until one gives blocks.
 * @param kernels - The module, holding the capture's sampled grid.
 * @param bits - Bits per cell.
 * @param header - The frame's header.
 * @param blocks - Blocks in a frame.
 * @param strips - The sequence each header strip gave alone.
 * @param threshold - Confidence under which bytes are erasures, or null.
 * @param decoded - Per block, 1 when the plain decode repaired it.
 * @param carry - Cells an earlier torn capture kept, if any.
 * @param homography - This capture's homography, which places the cut and is kept in a new carry.
 * @returns What it recovered, or null when the capture shows no sign of a tear.
 */
export function recoverTear(
  kernels: ModemKernels,
  bits: number,
  header: FrameHeader,
  blocks: number,
  strips: readonly [number | null, number | null],
  threshold: number | null,
  decoded: Uint8Array,
  carry: TearCarry | undefined,
  homography: Float32Array
): TearRecovery | null {
  const pairs = tearHypotheses(header.seq, strips);
  if (pairs.length === 0) return null;
  const usable = carryFits(carry, header) ? carry : undefined;
  // A pair with the carried frame on one side goes first: the carry was kept for it.
  if (usable) pairs.sort((a, b) => Number(b.includes(usable.seq)) - Number(a.includes(usable.seq)));
  const report: TearReport = { strips: [strips[0], strips[1]], seqs: pairs[0], cuts: [null, null], blocksOk: [0, 0], refused: 0, tried: 0 };
  let sides: [TornSide, TornSide] | null = null;
  for (const seqs of pairs) {
    const known: [Uint8Array | null, Uint8Array | null] = [seqs[0] === header.seq ? decoded : null, seqs[1] === header.seq ? decoded : null];
    const result = kernels.decodeTorn(homography, bits, header, header.session, seqs, threshold, known, usable && seqs.includes(usable.seq) ? usable : null);
    report.tried++;
    report.refused += result[0].refused + result[1].refused;
    report.seqs = seqs;
    report.cuts = [result[0].cut, result[1].cut];
    report.blocksOk = [result[0].blocksOk, result[1].blocksOk];
    if (result[0].blocksOk + result[1].blocksOk > 0) {
      sides = result;
      break;
    }
  }
  const recovery: TearRecovery = { report, blocks: new Array<Uint8Array | null>(blocks).fill(null), erasures: 0, corrected: 0, others: [] };
  const seqs = report.seqs;
  if (sides) {
    sides.forEach((side, s) => {
      const list = seqs[s] === header.seq ? recovery.blocks : new Array<Uint8Array | null>(blocks).fill(null);
      for (let b = 0; b < blocks; b++) if (side.ok[b]) list[b] = side.data.slice(b * header.packetBytes, (b + 1) * header.packetBytes);
      if (seqs[s] === header.seq) {
        recovery.erasures += side.erasures;
        recovery.corrected += side.corrected;
      } else if (side.blocksOk > 0) {
        recovery.others.push({ seq: seqs[s], blocks: list, blocksOk: side.blocksOk });
      }
    });
  }
  // Keep the later frame's cells when both frames are known to be in the capture and the later one
  // is not yet complete: the next capture shows it on the other side of the tear. A frame is known
  // by the header, by its own strip or by blocks of its side. A guessed sequence that gave nothing
  // may name no frame of this capture, and its cells, carried under that sequence, would put
  // confident errors where the next capture's decode would have had erasures.
  const known = (s: 0 | 1): boolean => seqs[s] === header.seq || strips[s] === seqs[s] || (sides !== null && sides[s].blocksOk > 0);
  if (known(0) && known(1)) {
    const later: 0 | 1 | null = follows(seqs[1], seqs[0]) ? 1 : follows(seqs[0], seqs[1]) ? 0 : null;
    const done = later === null ? blocks : (sides ? sides[later].blocksOk : 0) + (seqs[later] === header.seq ? decoded.reduce((n, f) => n + f, 0) : 0);
    if (later !== null && done < blocks) {
      const cells = header.cols * (header.rows - 2 * BAND_ROWS);
      const grid = kernels.grid(cells);
      recovery.carry = {
        session: header.session,
        cols: header.cols,
        rows: header.rows,
        constellation: header.constellation,
        packetBytes: header.packetBytes,
        parity: header.parity,
        seq: seqs[later],
        side: later,
        homography: homography.slice(0, 9),
        symbols: grid.slice(0, cells),
        confidence: grid.slice(cells, 2 * cells),
      };
    }
  }
  return recovery;
}
