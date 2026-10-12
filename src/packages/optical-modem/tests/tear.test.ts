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

import { beforeAll, describe, expect, it } from 'vitest';
import {
  HIGH_RATE_PROFILES,
  MODEM_PROFILES,
  decodeModemFrame,
  encodeModemFrame,
  frameCapacity,
  loadOpticalModem,
  runReferenceKernel,
  simulateCapture,
  type DecodedFrame,
  type RgbaImage,
  type TearCarry,
} from '../index';

// P6 Wide on a 1080p camera, as in the ceiling benchmark: about 4.2 camera pixels per cell.
const PROFILE = HIGH_RATE_PROFILES[0];
const PITCH = 2;
const CELL_PX = 1920 / 1.2 / PROFILE.cols;
const SESSION = 0x7ea2;
const CAPACITY = frameCapacity(PROFILE);

function payloadFor(seq: number): Uint8Array {
  return Uint8Array.from({ length: CAPACITY.payloadBytes }, (_, i) => (i * 37 + seq * 101 + (i >> 8)) & 255);
}

const frames = new Map<number, RgbaImage>();
function frameOf(seq: number): RgbaImage {
  let frame = frames.get(seq);
  if (!frame) {
    frame = encodeModemFrame(PROFILE, payloadFor(seq), SESSION, seq, PITCH);
    frames.set(seq, frame);
  }
  return frame;
}

/** A studio capture of frame `seq` with frame `below` (by default `seq + 1`) from `tear` of the camera height down. */
function torn(seq: number, tear: number, seed = seq, below = seq + 1): RgbaImage {
  return simulateCapture(frameOf(seq), 'studio', { pixelsPerCell: CELL_PX, cellPitch: PITCH, seed, next: frameOf(below), tearFraction: tear });
}

/** The capture with its top or bottom header strip greyed out between the fiducials, past the calibration patches. */
function withoutStrip(image: RgbaImage, bottom: boolean): RgbaImage {
  const data = image.data.slice();
  const screen = image.height / 1.2;
  const rowY = (row: number): number => image.height / 2 - screen / 2 + (row / PROFILE.rows) * screen;
  const cellX = image.width / 1.2 / PROFILE.cols;
  const left = Math.floor((image.width - image.width / 1.2) / 2 + 23 * cellX);
  const right = Math.ceil((image.width + image.width / 1.2) / 2 - 10 * cellX);
  const first = bottom ? PROFILE.rows - 4 : 5;
  for (let y = Math.floor(rowY(first) - 3); y < Math.ceil(rowY(first + 4) + 3); y++) {
    for (let x = left; x < right; x++) data.fill(128, (y * image.width + x) * 4, (y * image.width + x) * 4 + 3);
  }
  return { ...image, data };
}

/** The image turned clockwise by `turns` quarters. */
function rotate(image: RgbaImage, turns: number): RgbaImage {
  const { width, height, data } = image;
  const quarter = turns % 2 === 1;
  const out = new Uint8ClampedArray(data.length);
  const w = quarter ? height : width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [nx, ny] = turns === 1 ? [height - 1 - y, x] : turns === 2 ? [width - 1 - x, height - 1 - y] : [y, width - 1 - x];
      out.set(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (ny * w + nx) * 4);
    }
  }
  return { width: w, height: quarter ? width : height, data: out };
}

/** Blocks a decode gave, by frame sequence; every block must be the one that was sent. */
class Tally {
  public readonly blocks = new Map<number, Set<number>>();
  public wrong = 0;

  public add(result: DecodedFrame): void {
    if (!result.ok) return;
    this.addFrame(result.header.seq, result.blocks);
    for (const other of result.others ?? []) this.addFrame(other.seq, other.blocks);
  }

  public count(seq: number): number {
    return this.blocks.get(seq)?.size ?? 0;
  }

  private addFrame(seq: number, blocks: (Uint8Array | null)[]): void {
    const sent = payloadFor(seq);
    blocks.forEach((block, b) => {
      if (!block) return;
      const want = sent.subarray(b * PROFILE.packetBytes, (b + 1) * PROFILE.packetBytes);
      if (!block.every((v, i) => v === want[i])) this.wrong++;
      const set = this.blocks.get(seq) ?? new Set<number>();
      set.add(b);
      this.blocks.set(seq, set);
    });
  }
}

const decode = (image: RgbaImage, options: { tears?: boolean; carry?: TearCarry } = {}): DecodedFrame => decodeModemFrame(image, { geometries: [PROFILE], ...options });

beforeAll(() => loadOpticalModem());

describe('torn captures (ADR 0048)', () => {
  it('recovers a P6 frame torn at 0.70 to 0.80 of the camera height, where the plain decoder loses most of them', { timeout: 120_000 }, () => {
    const plain: number[] = [];
    for (const tear of [0.7, 0.75, 0.8]) {
      const image = torn(10, tear);
      const before = decode(image, { tears: false });
      plain.push(before.ok ? before.blocksOk : -1);
      const tally = new Tally();
      const result = decode(image);
      tally.add(result);
      expect(result.ok && result.header.seq).toBe(10);
      expect(tally.count(10), `tear at ${tear}`).toBe(CAPACITY.blocks);
      expect(tally.wrong).toBe(0);
    }
    // The plain decoder, which reads the torn rows as confident errors.
    expect(plain).toEqual([0, 0, CAPACITY.blocks]);
  });

  it('finishes frames torn near the middle from two consecutive captures, each giving blocks of two frames', { timeout: 180_000 }, () => {
    for (const tear of [0.5, 0.6]) {
      const tally = new Tally();
      let plain = 0;
      let carry: TearCarry | undefined;
      for (let k = 0; k < 3; k++) {
        const image = torn(20 + k, tear, 40 + k);
        const before = decode(image, { tears: false });
        plain += before.ok ? before.blocksOk : 0;
        const result = decode(image, { carry });
        tally.add(result);
        if (!result.ok) throw new Error('unreadable capture');
        if (k === 1 && carry) {
          // A carry from another session is not used.
          const foreign = decode(image, { carry: { ...carry, session: carry.session + 1 } });
          expect(foreign.ok && foreign.blocksOk).toBe(0);
        }
        // Each capture keeps the frame below the tear for the next one.
        expect(result.carry?.seq).toBe(21 + k);
        carry = result.carry;
      }
      expect(plain).toBe(0);
      // Frames 21 and 22 were seen below the tear in one capture and above it in the next.
      expect([tally.count(21), tally.count(22)], `tear at ${tear}`).toEqual([CAPACITY.blocks, CAPACITY.blocks]);
      expect(tally.wrong).toBe(0);
    }
  });

  it('finds the tear in a capture turned a quarter or upside down', { timeout: 120_000 }, () => {
    const quarter = new Tally();
    quarter.add(decode(rotate(torn(10, 0.75), 1)));
    expect(quarter.count(10)).toBe(CAPACITY.blocks);
    // Upside down, the next frame fills most of the picture: its blocks come back under its own sequence.
    const upsideDown = rotate(torn(10, 0.25), 2);
    const result = decode(upsideDown);
    const flipped = new Tally();
    flipped.add(result);
    expect(result.ok && result.others?.map((o) => o.seq)).toEqual([11]);
    expect(flipped.count(11)).toBe(CAPACITY.blocks);
    expect(quarter.wrong + flipped.wrong).toBe(0);
  });

  it('guesses the sequence of a side whose header strip is unreadable, the likelier neighbour first', { timeout: 120_000 }, () => {
    const image = torn(10, 0.75);
    const intact = decode(image);
    expect(intact.ok && intact.tear?.strips).toEqual([10, 11]);
    const result = decode(withoutStrip(image, true));
    if (!result.ok) throw new Error('unreadable capture');
    // The bottom strip no longer reads, so its side is guessed as the next frame first.
    expect(result.tear?.strips).toEqual([10, null]);
    expect(result.tear?.seqs).toEqual([10, 11]);
    const tally = new Tally();
    tally.add(result);
    expect(tally.count(10)).toBe(CAPACITY.blocks);
    // With the top strip unreadable instead, the header is the bottom strip's frame 10, and the top side is guessed
    // as the previous frame first: frame 9 over three quarters of the picture comes back from the first pair tried.
    const above = decode(withoutStrip(torn(9, 0.75), false));
    if (!above.ok) throw new Error('unreadable capture');
    expect(above.header.seq).toBe(10);
    expect(above.tear?.strips).toEqual([null, 10]);
    expect(above.tear?.seqs).toEqual([9, 10]);
    expect(above.tear?.tried).toBe(1);
    expect(above.others?.map((o) => [o.seq, o.blocksOk])).toEqual([[9, CAPACITY.blocks]]);
    tally.add(above);
    expect(tally.wrong).toBe(0);
  });

  it('gives no block of a frame the guesses do not name, though its side holds enough of it', { timeout: 120_000 }, () => {
    // Frame 10 above a quarter of the picture and frame 12 below: not a neighbour, so neither guess (11, 9) is right.
    const image = torn(10, 0.25, 10, 12);
    // With both strips readable, they name frame 12 and its blocks come back under its own sequence.
    const named = decode(image);
    const control = new Tally();
    control.add(named);
    expect(named.ok && named.tear?.strips).toEqual([10, 12]);
    expect(control.count(12)).toBe(CAPACITY.blocks);
    // With the bottom strip unreadable, both guesses are tried and the tag refuses every block they read.
    const guessed = decode(withoutStrip(image, true));
    if (!guessed.ok) throw new Error('unreadable capture');
    expect(guessed.tear?.strips).toEqual([10, null]);
    expect(guessed.tear?.tried).toBe(2);
    expect(guessed.others).toBeUndefined();
    expect(guessed.blocksOk).toBe(0);
    const tally = new Tally();
    tally.add(guessed);
    expect(tally.wrong + control.wrong).toBe(0);
  });

  it('keeps no carry for a frame it only guessed, which would spoil the next capture', { timeout: 120_000 }, () => {
    // Frame 10 over most of the picture and frame 15, not 11, below it, with the bottom strip unreadable: frame 10
    // decodes, and the guess that the rest is frame 11 is wrong.
    const first = decode(withoutStrip(torn(10, 0.75, 10, 15), true));
    if (!first.ok) throw new Error('unreadable capture');
    expect(first.tear?.strips).toEqual([10, null]);
    expect(first.blocksOk).toBe(CAPACITY.blocks);
    expect(first.carry).toBeUndefined();
    // Frame 11 torn at 0.75 decodes in full from its own capture, also given whatever the first one returned.
    const tally = new Tally();
    tally.add(decode(torn(11, 0.75), { carry: first.carry }));
    expect(tally.count(11)).toBe(CAPACITY.blocks);
    expect(tally.wrong).toBe(0);
  });

  it('places the cut by the capture homography when an external sampler used the module for something else', { timeout: 60_000 }, () => {
    const image = torn(10, 0.75);
    // A shear: under it, the camera's rows would run diagonally across the grid.
    const sheared = Float32Array.from([1, 0, 0, 0.5, 1, 0, 0, 0, 1]);
    const result = decodeModemFrame(image, {
      geometries: [PROFILE],
      sampleGrid: (capture, uniforms) => {
        const grid = runReferenceKernel(capture, uniforms);
        // Sampling something else leaves another homography in the module.
        runReferenceKernel(capture, { ...uniforms, homography: sheared });
        return grid;
      },
    });
    const tally = new Tally();
    tally.add(result);
    expect(tally.count(10)).toBe(CAPACITY.blocks);
    expect(tally.wrong).toBe(0);
  });

  it('decodes a capture that is not torn exactly as with the recovery off', { timeout: 60_000 }, () => {
    const fast = MODEM_PROFILES[1];
    const payload = Uint8Array.from({ length: frameCapacity(fast).payloadBytes }, (_, i) => i & 255);
    const capture = simulateCapture(encodeModemFrame(fast, payload, SESSION, 3, 4), 'typical', { pixelsPerCell: 3.5, cellPitch: 4, seed: 1 });
    const on = decodeModemFrame(capture);
    expect(on).toEqual(decodeModemFrame(capture, { tears: false }));
    if (!on.ok) throw new Error('unreadable capture');
    // Blocks fail at this cell size, but both header strips agree, so no tear is looked for.
    expect(on.blocksOk).toBeLessThan(on.blocks.length);
    expect(on.tear).toBeUndefined();
  });
});
