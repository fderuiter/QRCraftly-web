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
 * The fiducial search's acquisition sets (#1161, ADR 0047), shared by `acquisition.test.ts` and
 * `pnpm run bench:optical-finder`.
 *
 * Positives are frames of the shipped 4-colour profiles (Steady, Wide, Ultra) and of the two
 * high-rate grids in black and white, captured with strong perspective (the far edge 15% to 25%
 * shorter than the near one), at 2.5 to 3 camera pixels per cell in the middle of the frame, turned
 * up to 4 degrees or upside down, through the studio or the typical channel. The strict search was
 * tuned on captures drawn from {@link DEV_SEED} only; {@link HELD_OUT_SEED} draws captures that
 * played no part in it, and the tests and the benchmark's default report those.
 *
 * Negatives are pictures with no frame a receiver may read: blank, gradient, noise and blocky
 * pictures, real fiducials among random data, and captured frames with their header scrambled,
 * their fiducials painted over or a grid size the receiver does not know.
 */
import { HIGH_RATE_PROFILES, MODEM_PROFILES, capturedPoints, constellationId, encodeModemFrame, frameCapacity, simulateCapture, type ChannelPreset, type ModemProfile, type RgbaImage } from '../index';

/** A point in camera pixels. */
export interface Point {
  x: number;
  y: number;
}

/** A grid size a receiver is told to look for. */
interface GridGeometry {
  cols: number;
  rows: number;
}

/** Cells on a side of a fiducial's block, its light margin included. */
const FIDUCIAL_SIZE = 9;

/** A seeded random source: Mulberry32, the generator the module's own simulator uses. */
interface Rng {
  nextUint32: () => number;
  nextFloat: () => number;
}

function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  return { nextUint32, nextFloat: () => nextUint32() / 4294967296 };
}

/** Seeds for the held-out captures: never used to choose a threshold. */
export const HELD_OUT_SEED = 0x4e1d_0000;
/** Seeds for captures a change to the search may be tuned on. */
export const DEV_SEED = 0x0de7_0000;
/** Session id of every positive frame. */
export const SET_SESSION = 0x1161;
/** Pixels per cell in the rendered frame. */
const PITCH = 2;

const [WIDE, ULTRA] = HIGH_RATE_PROFILES;
const STEADY = MODEM_PROFILES[0];
const mono = (profile: ModemProfile): ModemProfile => ({ ...profile, name: `${profile.name} mono`, constellation: constellationId(2, 'oklab') });

/** The shipped profiles with 4 colours: the bottom of the ladder and both high-rate ones. */
export const SHIPPED_FOUR_COLOUR: readonly ModemProfile[] = [STEADY, WIDE, ULTRA];
/** The high-rate grids in black and white, where random data forms the most rings. */
export const MONOCHROME_LARGE: readonly ModemProfile[] = [mono(WIDE), mono(ULTRA)];
/** Every grid size the positives use, which a receiver is told to look for. */
export const SET_GEOMETRIES: readonly GridGeometry[] = [STEADY, WIDE, ULTRA].map(({ cols, rows }) => ({ cols, rows }));

/** One positive capture. */
export interface AcquisitionCase {
  profile: ModemProfile;
  /** Camera pixels per cell in the middle of the frame. */
  pixelsPerCell: number;
  /** How much shorter the far edge is than the near one (0.2 is 20%). */
  shortening: number;
  /** In-plane rotation, degrees. */
  degrees: number;
  /** The camera upside down: the capture turned a half turn, so the near edge is on the right. */
  flipped: boolean;
  preset: ChannelPreset;
  seed: number;
}

/**
 * Draws positive captures: `count` per profile, parameters drawn from `seed`.
 * @param profiles - Profiles to draw frames of.
 * @param count - Captures per profile.
 * @param seed - {@link HELD_OUT_SEED} or {@link DEV_SEED}, plus anything.
 * @returns The cases, profile by profile.
 */
export function acquisitionCases(profiles: readonly ModemProfile[], count: number, seed: number): AcquisitionCase[] {
  const cases: AcquisitionCase[] = [];
  profiles.forEach((profile, p) => {
    for (let i = 0; i < count; i++) {
      const caseSeed = (seed + p * 1000 + i) >>> 0;
      const rng = createRng(caseSeed);
      cases.push({
        profile,
        pixelsPerCell: 2.5 + 0.5 * rng.nextFloat(),
        shortening: 0.15 + 0.1 * rng.nextFloat(),
        degrees: -4 + 8 * rng.nextFloat(),
        flipped: rng.nextFloat() < 0.5,
        preset: i % 2 === 0 ? 'typical' : 'studio',
        seed: caseSeed,
      });
    }
  });
  return cases;
}

/**
 * One profile's positive captures, with seeds no other profile in the sets shares.
 * @param profile - A profile of {@link SHIPPED_FOUR_COLOUR} or {@link MONOCHROME_LARGE}.
 * @param count - Captures.
 * @param seed - {@link HELD_OUT_SEED} or {@link DEV_SEED}.
 * @returns The cases.
 */
export function profileCases(profile: ModemProfile, count: number, seed: number): AcquisitionCase[] {
  return acquisitionCases([profile], count, seed + profile.id * 100_000 + (profile.constellation & 7) * 10_000);
}

/** A frame's sequence number in a set, from its seed. */
export function caseSeq(c: AcquisitionCase): number {
  return c.seed & 0xffff;
}

/** A positive capture and where its fiducials really are. */
export interface Capture {
  image: RgbaImage;
  /** The four fiducial centres in camera pixels: top-left, top-right, bottom-left, bottom-right. */
  fiducials: Point[];
}

/**
 * Renders and captures one positive case.
 * @param c - The case.
 * @returns The camera image and the true fiducial centres.
 */
export function captureCase(c: AcquisitionCase): Capture {
  const rng = createRng(c.seed ^ 0x5a5a5a5a);
  const payload = Uint8Array.from({ length: frameCapacity(c.profile).payloadBytes }, () => rng.nextUint32() & 255);
  const frame = encodeModemFrame(c.profile, payload, SET_SESSION, caseSeq(c), PITCH);
  // The capture keeps the left edge at the nominal size and takes `keystone` off the right edge at
  // the top and the bottom, so the middle of the frame is 1 - keystone of the nominal size.
  const keystone = c.shortening / 2;
  const options = {
    pixelsPerCell: c.pixelsPerCell / (1 - keystone),
    cellPitch: PITCH,
    seed: c.seed,
    keystone,
    tilt: Math.tan((c.degrees * Math.PI) / 360),
  };
  const captured = simulateCapture(frame, c.preset, options);
  const { cols, rows } = c.profile;
  const centres = [
    [4.5, 4.5],
    [cols - 4.5, 4.5],
    [4.5, rows - 4.5],
    [cols - 4.5, rows - 4.5],
  ].map(([u, v]): [number, number] => [u * PITCH, v * PITCH]);
  const fiducials = capturedPoints(frame, c.preset, options, centres);
  if (!c.flipped) return { image: captured, fiducials };
  // A half turn: pixel (x, y) moves to (width - 1 - x, height - 1 - y), a point to (width - x, height - y).
  const { width, height, data } = captured;
  const turned = new Uint8ClampedArray(data.length);
  for (let i = 0, j = data.length - 4; i < data.length; i += 4, j -= 4) turned.set(data.subarray(i, i + 4), j);
  return { image: { width, height, data: turned }, fiducials: fiducials.map((p) => ({ x: width - p.x, y: height - p.y })) };
}

/**
 * Whether a search found every fiducial: each true centre has a found one within `tolerance` pixels.
 * @param found - The centres a search returned, in any order.
 * @param truth - The true centres.
 * @param tolerance - Pixels.
 * @returns Whether all four were found.
 */
export function foundAll(found: readonly Point[] | undefined, truth: readonly Point[], tolerance: number): boolean {
  if (!found || found.length !== 4) return false;
  return truth.every((t) => found.some((p) => Math.hypot(p.x - t.x, p.y - t.y) <= tolerance));
}

/** One negative picture. */
export interface NegativeCase {
  kind: string;
  image: RgbaImage;
}

function blank(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

function setPixel(image: RgbaImage, x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const at = (y * image.width + x) * 4;
  image.data[at] = r;
  image.data[at + 1] = g;
  image.data[at + 2] = b;
}

function fillBlocks(image: RgbaImage, rng: Rng, block: number, colour: (rng: Rng) => [number, number, number]): void {
  for (let y0 = 0; y0 < image.height; y0 += block) {
    for (let x0 = 0; x0 < image.width; x0 += block) {
      const [r, g, b] = colour(rng);
      for (let y = y0; y < Math.min(image.height, y0 + block); y++) for (let x = x0; x < Math.min(image.width, x0 + block); x++) setPixel(image, x, y, r, g, b);
    }
  }
}

/** Copies a `side` x `side` square of `from`'s pixels, from (`fx`, `fy`), to (`x0`, `y0`) of `image`. */
function copySquare(image: RgbaImage, x0: number, y0: number, from: RgbaImage, fx: number, fy: number, side: number): void {
  for (let dy = 0; dy < side; dy++) {
    for (let dx = 0; dx < side; dx++) {
      const at = ((fy + dy) * from.width + fx + dx) * 4;
      setPixel(image, x0 + dx, y0 + dy, from.data[at], from.data[at + 1], from.data[at + 2]);
    }
  }
}

const SIZES: readonly (readonly [number, number])[] = [
  [640, 360],
  [800, 450],
  [960, 540],
];

/** Captures a Steady frame (the cheapest to simulate) after `edit` changes the rendered frame. */
function capturedSteady(rng: Rng, seq: number, edit: (frame: RgbaImage) => void, profile: ModemProfile = STEADY): RgbaImage {
  const payload = Uint8Array.from({ length: frameCapacity(profile).payloadBytes }, () => rng.nextUint32() & 255);
  const frame = encodeModemFrame(profile, payload, SET_SESSION, seq, PITCH);
  edit(frame);
  return simulateCapture(frame, rng.nextUint32() & 1 ? 'typical' : 'studio', { pixelsPerCell: 2.5 + rng.nextFloat(), cellPitch: PITCH, seed: rng.nextUint32() });
}

/** Overwrites cells `[col0, col1) x [row0, row1)` of a rendered frame with random black and white. */
function scramble(frame: RgbaImage, rng: Rng, col0: number, col1: number, row0: number, row1: number): void {
  for (let row = row0; row < row1; row++) {
    for (let col = col0; col < col1; col++) {
      const v = rng.nextUint32() & 1 ? 255 : 0;
      for (let y = row * PITCH; y < (row + 1) * PITCH; y++) for (let x = col * PITCH; x < (col + 1) * PITCH; x++) setPixel(frame, x, y, v, v, v);
    }
  }
}

const KINDS = ['grey', 'gradient', 'noise', 'mono-blocks', 'colour-blocks', 'loose-fiducials', 'scrambled-header', 'painted-fiducials', 'unknown-grid'] as const;

/**
 * Pictures with no frame a receiver given {@link SET_GEOMETRIES} may read, cycling through
 * every kind.
 * @param count - Pictures.
 * @param seed - Seed.
 * @param sizes - Picture sizes to cycle through for the synthetic kinds.
 * @yields The pictures.
 */
export function* negativeCases(count: number, seed: number, sizes: readonly (readonly [number, number])[] = SIZES): Generator<NegativeCase> {
  for (let i = 0; i < count; i++) {
    const rng = createRng((seed + i * 7919) >>> 0);
    const kind = KINDS[i % KINDS.length];
    const [width, height] = sizes[Math.floor(i / KINDS.length) % sizes.length];
    const image = blank(width, height);
    const level = (): number => rng.nextUint32() & 255;
    switch (kind) {
      case 'grey': {
        const v = level();
        image.data.fill(v);
        for (let p = 3; p < image.data.length; p += 4) image.data[p] = 255;
        break;
      }
      case 'gradient':
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) setPixel(image, x, y, (x * 255) / width, (y * 255) / height, 128);
        break;
      case 'noise':
        fillBlocks(image, rng, 1, (r) => [r.nextUint32() & 255, r.nextUint32() & 255, r.nextUint32() & 255]);
        break;
      case 'mono-blocks':
        fillBlocks(image, rng, 2 + (i % 5), (r) => (r.nextUint32() & 1 ? [255, 255, 255] : [0, 0, 0]));
        break;
      case 'colour-blocks': {
        const palette: [number, number, number][] = [
          [20, 20, 20],
          [230, 60, 60],
          [60, 200, 90],
          [70, 90, 230],
        ];
        fillBlocks(image, rng, 2 + (i % 4), (r) => palette[r.nextUint32() & 3]);
        break;
      }
      case 'loose-fiducials': {
        // The four fiducials of a frame drawn at one size, each with its light margin, in a
        // rectangle among random cells: rings the strict search accepts, around no header.
        const cell = 3 + (i % 4);
        fillBlocks(image, rng, cell, (r) => (r.nextUint32() & 1 ? [255, 255, 255] : [0, 0, 0]));
        const frame = encodeModemFrame(STEADY, new Uint8Array(frameCapacity(STEADY).payloadBytes), SET_SESSION, i, cell);
        const side = FIDUCIAL_SIZE * cell;
        const [right, bottom] = [frame.width - side, frame.height - side];
        const x1 = width - side - 10;
        const y1 = height - side - 10;
        copySquare(image, 10, 10, frame, 0, 0, side);
        copySquare(image, x1, 10, frame, right, 0, side);
        copySquare(image, 10, y1, frame, 0, bottom, side);
        copySquare(image, x1, y1, frame, right, bottom, side);
        break;
      }
      case 'scrambled-header':
        yield {
          kind,
          image: capturedSteady(rng, i, (frame) => {
            // The header's two strips; the fiducials and calibration patches stay.
            const { cols, rows } = STEADY;
            scramble(frame, rng, FIDUCIAL_SIZE, cols - FIDUCIAL_SIZE, 5, FIDUCIAL_SIZE);
            scramble(frame, rng, FIDUCIAL_SIZE, cols - FIDUCIAL_SIZE, rows - 4, rows);
          }),
        };
        continue;
      case 'painted-fiducials':
        yield {
          kind,
          image: capturedSteady(rng, i, (frame) => {
            const { cols, rows } = STEADY;
            for (const [col, row] of [
              [0, 0],
              [cols - FIDUCIAL_SIZE, 0],
              [0, rows - FIDUCIAL_SIZE],
              [cols - FIDUCIAL_SIZE, rows - FIDUCIAL_SIZE],
            ]) {
              scramble(frame, rng, col, col + FIDUCIAL_SIZE, row, row + FIDUCIAL_SIZE);
            }
          }),
        };
        continue;
      case 'unknown-grid':
        // A whole, readable frame of a grid size the receiver was not told about.
        yield { kind, image: capturedSteady(rng, i, () => undefined, { ...STEADY, cols: 112, rows: 63 }) };
        continue;
    }
    yield { kind, image };
  }
}
