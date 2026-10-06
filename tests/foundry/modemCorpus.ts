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
 * The seeded inputs of the optical modem's differential test (#1198). The golden outputs in
 * `tests/fixtures/modem-golden.json.gz` were recorded once by running these inputs through the
 * TypeScript kernels the Rust module `crates/modem` replaced; `modem.test.ts` runs the same inputs
 * through the module. Everything here is deterministic: seeded generators and integer maths.
 */
import { createRandom } from '../utils/scannerCorpus';

/** 32-bit FNV-1a of some bytes, as eight hex digits: pins an output without storing it. */
export function fnv1a(bytes: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ (bytes[i] & 0xff), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** One Reed-Solomon case: a message, its check bytes, and the damage done to the codeword. */
export interface RsCase {
  message: Uint8Array;
  parity: number;
  /** Positions handed to the decoder as erasures; some hold the right byte. */
  erasures: number[];
  /** Positions of unknown errors and the values XORed into them. */
  errors: Array<[number, number]>;
  /** Positions of erasures whose byte is changed too. */
  erasedWrong: Array<[number, number]>;
}

/**
 * Seeded Reed-Solomon cases: within the code's bound and beyond it, with and without erasures,
 * with no check bytes and with a full 255-byte codeword.
 */
export function rsCases(count = 3000): RsCase[] {
  const random = createRandom(1198);
  const int = (n: number): number => Math.floor(random() * n);
  const cases: RsCase[] = [];
  for (let c = 0; c < count; c++) {
    const parity = c % 50 === 0 ? 0 : 1 + int(c % 7 === 0 ? 120 : 64);
    const k = c % 97 === 0 ? 255 - parity : 1 + int(Math.min(200, 255 - parity));
    const message = Uint8Array.from({ length: k }, () => int(256));
    const n = k + parity;
    const used = new Set<number>();
    const pick = (): number => {
      let at = int(n);
      while (used.has(at)) at = (at + 1) % n;
      used.add(at);
      return at;
    };
    // A quarter of the cases go past the bound (2 errors + erasures > parity).
    const beyond = c % 4 === 3;
    const erasureCount = Math.min(n, int(parity + 1));
    const errorBudget = Math.max(0, Math.floor((parity - erasureCount) / 2));
    const errorCount = Math.min(n - erasureCount, beyond ? errorBudget + 1 + int(4) : int(errorBudget + 1));
    const erasures: number[] = [];
    const erasedWrong: Array<[number, number]> = [];
    for (let i = 0; i < erasureCount; i++) {
      const at = pick();
      erasures.push(at);
      if (random() < 0.7) erasedWrong.push([at, 1 + int(255)]);
    }
    const errors: Array<[number, number]> = [];
    for (let i = 0; i < errorCount; i++) errors.push([pick(), 1 + int(255)]);
    cases.push({ message, parity, erasures, errors, erasedWrong });
  }
  return cases;
}

/** Applies a case's damage to a clean codeword, in a copy. */
export function damage(codeword: Uint8Array, c: RsCase): Uint8Array {
  const word = codeword.slice();
  for (const [at, value] of [...c.errors, ...c.erasedWrong]) word[at] ^= value;
  return word;
}

/** Seeded point pairs for the homography solver, some of them degenerate. */
export function homographyCases(count = 400): Array<{ source: Array<[number, number]>; target: Array<{ x: number; y: number }> }> {
  const random = createRandom(0x4011);
  const cases = [];
  for (let c = 0; c < count; c++) {
    const cols = 104 + Math.floor(random() * 200);
    const rows = 40 + Math.floor(random() * 120);
    const source: Array<[number, number]> = [
      [4.5, 4.5],
      [cols - 4.5, 4.5],
      [cols - 4.5, rows - 4.5],
      [4.5, rows - 4.5],
    ];
    const jitter = (): number => (random() - 0.5) * 80;
    const scale = 1 + random() * 6;
    let target = source.map(([u, v]) => ({ x: 20 + u * scale + jitter(), y: 20 + v * scale + jitter() }));
    if (c % 25 === 0) target = target.map(() => ({ x: 7, y: 9 }));
    cases.push({ source, target });
  }
  return cases;
}

/** RGBA pixels, as a canvas holds them. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** Turns an image by a quarter turn clockwise `turns` times, so frames are seen upside down and sideways. */
export function rotate(image: Pixels, turns: number): Pixels {
  let out = image;
  for (let t = 0; t < turns % 4; t++) {
    const { width, height, data } = out;
    const next = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const from = (y * width + x) * 4;
        const to = (x * height + (height - 1 - y)) * 4;
        next.set(data.subarray(from, from + 4), to);
      }
    }
    out = { width: height, height: width, data: next };
  }
  return out;
}

/** One frame of the simulation corpus: which profile, how it is captured and how it is decoded. */
export interface FrameSpec {
  /** Index into `MODEM_PROFILES`. */
  profile: number;
  /** Check bytes taken from the block's data bytes (0 keeps the profile's code). */
  parityShift: number;
  preset: 'studio' | 'typical' | 'poor';
  pixelsPerCell: number;
  seed: number;
  /** Quarter turns of the captured image. */
  turns: number;
  /** A second frame torn in at half height. */
  torn: boolean;
}

/**
 * The simulation corpus: every profile in every channel at an easy and a hard camera cell size
 * (from the benchmark's range), a thinner code at the stress point, and turned and torn captures.
 */
export function frameSpecs(): FrameSpec[] {
  const specs: FrameSpec[] = [];
  const pxByProfile = [
    [5, 3.5, 3],
    [5, 4, 3.5],
    [5, 5, 4],
  ];
  for (let profile = 0; profile < 3; profile++) {
    const [easy, stress, hard] = pxByProfile[profile];
    for (const preset of ['studio', 'typical', 'poor'] as const) {
      for (const pixelsPerCell of [easy, hard]) {
        specs.push({ profile, parityShift: 0, preset, pixelsPerCell, seed: specs.length + 1, turns: 0, torn: false });
      }
    }
    specs.push({ profile, parityShift: 16, preset: 'typical', pixelsPerCell: stress, seed: 90 + profile, turns: 0, torn: false });
    specs.push({ profile, parityShift: 0, preset: 'studio', pixelsPerCell: 4, seed: 100 + profile, turns: profile + 1, torn: false });
    specs.push({ profile, parityShift: 0, preset: 'studio', pixelsPerCell: 4, seed: 110 + profile, turns: 0, torn: true });
  }
  return specs;
}

/** One probe run of the corpus: a pattern captured a few times through one channel. */
export interface ProbeSpec {
  preset: 'studio' | 'typical' | 'poor';
  /** Kind and position of the pattern among those of its kind and pitch. */
  kind: 'grid' | 'edge' | 'flicker';
  pitch: number;
  nth: number;
  cameraPx: number;
  /** Also feed the run a blank frame, which has no fiducials. */
  blank: boolean;
}

/** Frames per probe run; the last is torn into the next display frame. */
export const PROBE_RUN_FRAMES = 3;

/**
 * The probe corpus: every constellation at 8 px cells, a 4 px grid, the slanted edge and two
 * flicker patterns, across the three channels.
 */
export function probeSpecs(): ProbeSpec[] {
  const presets = ['studio', 'typical', 'poor'] as const;
  const specs: ProbeSpec[] = [];
  for (let nth = 0; nth < 7; nth++) specs.push({ preset: presets[nth % 3], kind: 'grid', pitch: 8, nth, cameraPx: nth % 2 ? 3.5 : 5, blank: nth % 2 === 0 });
  specs.push({ preset: 'typical', kind: 'grid', pitch: 4, nth: 3, cameraPx: 3.5, blank: false });
  specs.push({ preset: 'studio', kind: 'edge', pitch: 4, nth: 0, cameraPx: 3.5, blank: false });
  specs.push({ preset: 'typical', kind: 'edge', pitch: 4, nth: 0, cameraPx: 3, blank: false });
  for (const nth of [0, 4]) specs.push({ preset: 'typical', kind: 'flicker', pitch: 4, nth, cameraPx: 3, blank: true });
  return specs;
}

/** Payload bytes for a frame of the corpus. */
export function framePayload(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 31 + seed * 7 + 5) & 255);
}

/** Session id of every corpus frame. */
export const CORPUS_SESSION = 0x1198;

/** Seeded calibration patches for the cross-talk fit: clean, noisy, weak, mixed and glaring. */
export function crosstalkPatches(count = 300): Array<Array<[number, number, number]>> {
  const random = createRandom(0x1147);
  const swatches = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 0],
    [1, 1, 1],
  ];
  const patches = [];
  for (let c = 0; c < count; c++) {
    const kind = c % 6;
    const m = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 120 + random() * 120 : random() * (kind === 3 ? 160 : 50))));
    if (kind === 4) m[1][1] = 10 + random() * 30;
    const offset = [0, 1, 2].map(() => random() * 30);
    const noise = kind === 2 ? 30 : kind === 5 ? 80 : 4;
    patches.push(
      swatches.map((e) => {
        const level = (i: number): number => m[i][0] * e[0] + m[i][1] * e[1] + m[i][2] * e[2] + offset[i] + (random() - 0.5) * noise;
        // Whole levels, as a camera reports them, except every seventh patch keeps the fractions of a mean.
        const value = (i: number): number => (c % 7 === 0 ? level(i) : Math.round(level(i)));
        return [value(0), value(1), value(2)] as [number, number, number];
      })
    );
  }
  return patches;
}

/** A seeded RGBA image for the channel split. */
export function splitImage(seed: number, width: number, height: number): Pixels {
  const random = createRandom(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i & 3) === 3 ? 255 : Math.floor(random() * 256);
  return { width, height, data };
}

/** Seeded confusion matrices (sent by row) for the mutual information. */
export function confusionMatrices(count = 200): number[][][] {
  const random = createRandom(0x27);
  const out = [];
  for (let c = 0; c < count; c++) {
    const size = [2, 4, 8, 16][c % 4];
    const sharp = random();
    out.push(
      Array.from({ length: size }, (_, x) =>
        Array.from({ length: size }, (_, y) => (c % 13 === 0 && x === 1 ? 0 : Math.floor(random() * (x === y ? 1000 : 1000 * (1 - sharp) * 0.1))))
      )
    );
  }
  return out;
}
