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

import { constellationId, constellationShape } from './constellation';
import { drawFrame } from './frame';
import { BAND_ROWS, createLayout, type GridGeometry, type RgbaImage } from './layout';
import { createRng } from './prng';
import type { Rgb } from './colour';

/** Profile number carried by probe frames. */
export const PROBE_PROFILE = 15;
/** The probe frame is this many device pixels wide, whatever the cell size, so every screen can show it. */
export const PROBE_FRAME_WIDTH = 960;
/** The probe frame's height in device pixels. */
export const PROBE_FRAME_HEIGHT = 540;
/** Cell pitches the probe tries, in device pixels. */
export const PROBE_PITCHES: readonly number[] = [8, 6, 5, 4, 3, 2];
/** Display rates the flicker patterns try, in frames per second. */
export const PROBE_FLICKER_RATES: readonly number[] = [30, 60, 120];
/** Pitch of the flicker and edge frames. */
const AUX_PITCH = 4;
/** The slanted edge falls one pixel sideways for each this many pixels down (about 7 degrees). */
export const EDGE_RUN = 8;
/** Dark and light sides of the slanted edge. */
const EDGE_LEVELS: readonly [number, number] = [48, 208];

/**
 * Colour pairs for the flicker patterns. Both stay under the general flash threshold of WCAG 2.3.1
 * (a relative luminance step under 0.1); the first pair is equal in OKLab lightness and differs only
 * in hue, the second differs only in lightness, as the reference.
 */
export const FLICKER_PAIRS: readonly { label: string; colours: readonly [Rgb, Rgb] }[] = [
  {
    label: 'isoluminant colour',
    colours: [
      [200, 140, 150],
      [90, 176, 170],
    ],
  },
  {
    label: 'luminance',
    colours: [
      [120, 120, 120],
      [136, 136, 136],
    ],
  },
];

/** What a probe pattern shows. */
export interface ProbePattern {
  /** Position in the sequence; it travels in the frame header. */
  index: number;
  kind: 'grid' | 'flicker' | 'edge';
  label: string;
  /** Device pixels per cell. */
  pitch: number;
  constellation: number;
  cols: number;
  rows: number;
  /** For flicker patterns: the display rate to alternate at. */
  hz?: number;
  /** For flicker patterns: which colour pair. */
  pair?: number;
}

const GRID_CONSTELLATIONS: readonly { size: 2 | 4 | 8 | 16; space: 'rgb' | 'oklab'; label: string }[] = [
  { size: 2, space: 'rgb', label: 'monochrome' },
  { size: 4, space: 'rgb', label: '4 colours, RGB corners' },
  { size: 4, space: 'oklab', label: '4 colours, OKLab' },
  { size: 8, space: 'rgb', label: '8 colours, RGB corners' },
  { size: 8, space: 'oklab', label: '8 colours, OKLab' },
  { size: 16, space: 'rgb', label: '16 colours, RGB lattice' },
  { size: 16, space: 'oklab', label: '16 colours, OKLab' },
];

function geometryFor(pitch: number): GridGeometry {
  return { cols: Math.floor(PROBE_FRAME_WIDTH / pitch), rows: Math.floor(PROBE_FRAME_HEIGHT / pitch) };
}

let sequence: ProbePattern[] | null = null;

/**
 * The fixed probe sequence: every pitch with every constellation, then the slanted edge, then the
 * flicker patterns. It never depends on the screen, so the receiver can rebuild it.
 * @returns The patterns in play order.
 */
export function probeSequence(): readonly ProbePattern[] {
  if (sequence) return sequence;
  const list: ProbePattern[] = [];
  const add = (pattern: Omit<ProbePattern, 'index'>): void => {
    list.push({ index: list.length, ...pattern });
  };
  for (const pitch of PROBE_PITCHES) {
    for (const c of GRID_CONSTELLATIONS) {
      add({ kind: 'grid', label: `${pitch} px cells, ${c.label}`, pitch, constellation: constellationId(c.size, c.space), ...geometryFor(pitch) });
    }
  }
  add({ kind: 'edge', label: 'slanted edge', pitch: AUX_PITCH, constellation: constellationId(2, 'rgb'), ...geometryFor(AUX_PITCH) });
  FLICKER_PAIRS.forEach((pair, p) => {
    for (const hz of PROBE_FLICKER_RATES) {
      add({ kind: 'flicker', label: `${hz} Hz flicker, ${pair.label}`, pitch: AUX_PITCH, constellation: constellationId(2, 'rgb'), ...geometryFor(AUX_PITCH), hz, pair: p });
    }
  });
  sequence = list;
  return list;
}

/**
 * The grid sizes in the sequence, which a receiver tries when reading headers.
 * @returns Distinct geometries.
 */
export function probeGeometries(): GridGeometry[] {
  const seen = new Map<string, GridGeometry>();
  for (const p of probeSequence()) seen.set(`${p.cols}x${p.rows}`, { cols: p.cols, rows: p.rows });
  return [...seen.values()];
}

/**
 * Packs a pattern index and a display frame counter into a header sequence number.
 * @param patternIndex - Index in the sequence (12 bits).
 * @param counter - Display frame counter (20 bits); its lowest bit is the variant.
 * @returns The 32-bit sequence number.
 */
export function packProbeSeq(patternIndex: number, counter: number): number {
  return ((patternIndex << 20) | (counter & 0xfffff)) >>> 0;
}

/**
 * Splits a header sequence number.
 * @param seq - The 32-bit sequence number.
 * @returns The pattern index and the counter.
 */
export function unpackProbeSeq(seq: number): { patternIndex: number; counter: number } {
  return { patternIndex: seq >>> 20, counter: seq & 0xfffff };
}

/**
 * The symbols a grid pattern shows in one variant. Even and odd counters show different data, so a
 * receiver can tell a clean frame from a blend or a tear of two.
 * @param pattern - A grid pattern.
 * @param session - The run's session id.
 * @param variant - 0 or 1.
 * @returns One symbol per data cell.
 */
export function probeSymbols(pattern: ProbePattern, session: number, variant: number): Uint8Array {
  const { size } = constellationShape(pattern.constellation);
  const rng = createRng((session ^ Math.imul(pattern.index + 1, 0x9e3779b1) ^ Math.imul(variant + 1, 0x85ebca6b)) >>> 0);
  const count = createLayout(pattern.cols, pattern.rows, size).dataCells;
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = rng.nextUint32() % size;
  return out;
}

function fillRect(image: RgbaImage, x0: number, y0: number, x1: number, y1: number, colour: (x: number, y: number) => Rgb): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const [r, g, b] = colour(x, y);
      const at = (y * image.width + x) * 4;
      image.data[at] = r;
      image.data[at + 1] = g;
      image.data[at + 2] = b;
    }
  }
}

/**
 * Draws one frame of a pattern.
 * @param pattern - The pattern.
 * @param session - The run's session id.
 * @param counter - The display frame counter (the variant is its lowest bit).
 * @returns The frame at `pattern.pitch` device pixels per cell.
 */
export function drawProbeFrame(pattern: ProbePattern, session: number, counter: number): RgbaImage {
  const layout = createLayout(pattern.cols, pattern.rows, constellationShape(pattern.constellation).size);
  const header = {
    version: 1,
    profile: PROBE_PROFILE,
    constellation: pattern.constellation,
    packetBytes: 0,
    parity: 0,
    flags: 0,
    session,
    seq: packProbeSeq(pattern.index, counter),
    cols: pattern.cols,
    rows: pattern.rows,
  };
  const data = pattern.kind === 'grid' ? probeSymbols(pattern, session, counter & 1) : new Uint8Array(layout.dataCells);
  const image = drawFrame(header, data, pattern.pitch);
  const top = BAND_ROWS * pattern.pitch;
  const bottom = (pattern.rows - BAND_ROWS) * pattern.pitch;
  if (pattern.kind === 'flicker') {
    const colour = FLICKER_PAIRS[pattern.pair ?? 0].colours[counter & 1];
    fillRect(image, 0, top, image.width, bottom, () => colour);
  } else if (pattern.kind === 'edge') {
    const mid = image.width / 2;
    const centre = (top + bottom) / 2;
    fillRect(image, 0, top, image.width, bottom, (x, y) => {
      // A pixel is dark where it lies left of the edge line; 4 x 4 samples give the edge its soft step.
      let dark = 0;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (x + (i + 0.5) / 4 < mid + (y + (j + 0.5) / 4 - centre) / EDGE_RUN) dark++;
      const level = EDGE_LEVELS[1] + ((EDGE_LEVELS[0] - EDGE_LEVELS[1]) * dark) / 16;
      return [level, level, level];
    });
  }
  return image;
}
