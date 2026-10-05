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
 * Generated decode corpus for the scanner (#1103).
 *
 * Every fixture is a synthetic camera frame (RGBA, 1280x720 by default, the size the
 * Camera Scanner Engine posts to its worker) built from a real QR matrix with the
 * degradations a phone camera adds: small modules, dense versions, every error
 * correction level, inverted polarity, rotation, perspective, blur, sensor noise and
 * glare. Frames with no code at all (plain and grainy) are included because they are
 * what the scanner sees most of the time while the user is still aiming.
 *
 * Fixtures are generated deterministically (seeded noise), so `pnpm run bench:scanner`
 * results are comparable between runs and between git refs. The corpus has no real
 * phone photos yet; add them under `tests/fixtures/scanner/` with their licence noted.
 */
import { qrEncoder as QRCode } from '../fixtures/qrEncoder';

export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H';

/** How a corpus frame is built. Every field is optional except the payload. */
export interface CorpusSpec {
  /** Text to encode, or null for a frame with no code. */
  text: string | null;
  /** QR version (1-40); chosen automatically from the text when omitted. */
  version?: number;
  errorCorrection?: ErrorCorrection;
  /** Pixels per module on the frame (default 4). */
  modulePx?: number;
  /** Light modules on dark when true. */
  invert?: boolean;
  /** Rotation in degrees around the frame centre. */
  rotateDeg?: number;
  /** Keystone strength in [0, 0.5): the top edge is narrowed by this fraction. */
  perspective?: number;
  /** Box-blur radius in pixels (0 = sharp). */
  blurPx?: number;
  /** Uniform sensor noise amplitude in grey levels (+/- this value). */
  noise?: number;
  /** Peak brightness added by a soft glare spot over the top-left of the code. */
  glare?: number;
  /** Contrast between light and dark modules, 0-1 (default 1): a washed-out screen has less. */
  contrast?: number;
  /** Grey levels added to every pixel (negative darkens): a dim or over-bright screen. */
  brightness?: number;
  /** Rolling-shutter tear: from this fraction of the frame height down, rows shift sideways. */
  tear?: { at: number; shiftPx: number };
  /** Frame size (default 1280x720). */
  width?: number;
  height?: number;
  /** Noise seed (default 1). */
  seed?: number;
}

export interface CorpusFrame {
  /** Stable, human-readable fixture id (category/detail). */
  id: string;
  /** Category used to group benchmark results. */
  category: string;
  /** The encoded text, or null for frames with no code. */
  expected: string | null;
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const LIGHT = 232;
const DARK = 28;
const BACKGROUND = 128;
const QUIET_ZONE = 4;

/** Deterministic PRNG (mulberry32) so noisy fixtures are identical between runs. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Separable box blur of a grey plane, in place. */
function boxBlur(grey: Float32Array, width: number, height: number, radius: number): void {
  if (radius <= 0) return;
  const tmp = new Float32Array(grey.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += grey[row + Math.min(width - 1, Math.max(0, x + k))];
      tmp[row + x] = sum / span;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += tmp[Math.min(height - 1, Math.max(0, y + k)) * width + x];
      grey[y * width + x] = sum / span;
    }
  }
}

/**
 * Renders one corpus frame.
 * @param spec How to build the frame.
 * @returns The RGBA pixels and their size.
 */
export function renderCorpusFrame(spec: CorpusSpec): { data: Uint8ClampedArray; width: number; height: number } {
  const width = spec.width ?? 1280;
  const height = spec.height ?? 720;
  const grey = new Float32Array(width * height).fill(BACKGROUND);

  if (spec.text !== null) {
    const qr = QRCode.create(spec.text, {
      errorCorrectionLevel: spec.errorCorrection ?? 'M',
      ...(spec.version ? { version: spec.version } : {}),
    });
    const count = qr.modules.size;
    const modulePx = spec.modulePx ?? 4;
    const side = (count + QUIET_ZONE * 2) * modulePx;
    const cx = width / 2;
    const cy = height / 2;
    const angle = ((spec.rotateDeg ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const keystone = spec.perspective ?? 0;
    const light = spec.invert ? DARK : LIGHT;
    const dark = spec.invert ? LIGHT : DARK;
    const reach = side * 0.75;
    const x0 = Math.max(0, Math.floor(cx - reach));
    const x1 = Math.min(width, Math.ceil(cx + reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const y1 = Math.min(height, Math.ceil(cy + reach));

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        // Inverse map the frame pixel into code space: undo rotation, then keystone.
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        let u = dx * cos + dy * sin;
        const v = -dx * sin + dy * cos;
        // Rows nearer the top are narrower: widen them back when sampling.
        const t = (v + side / 2) / side;
        const rowScale = 1 - keystone * (1 - t);
        u /= rowScale;
        const sx = u + side / 2;
        const sy = v + side / 2;
        if (sx < 0 || sy < 0 || sx >= side || sy >= side) continue;
        const mx = Math.floor(sx / modulePx) - QUIET_ZONE;
        const my = Math.floor(sy / modulePx) - QUIET_ZONE;
        const inside = mx >= 0 && my >= 0 && mx < count && my < count;
        grey[y * width + x] = inside && qr.modules.get(my, mx) ? dark : light;
      }
    }

    if (spec.glare) {
      const gx = cx - side * 0.2;
      const gy = cy - side * 0.2;
      const radius = side * 0.35;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const d = Math.hypot(x - gx, y - gy) / radius;
          if (d < 1) grey[y * width + x] += spec.glare * (1 - d * d);
        }
      }
    }
  }

  boxBlur(grey, width, height, spec.blurPx ?? 0);

  const contrast = spec.contrast ?? 1;
  const brightness = spec.brightness ?? 0;
  if (contrast !== 1 || brightness !== 0) {
    for (let i = 0; i < grey.length; i++) grey[i] = BACKGROUND + (grey[i] - BACKGROUND) * contrast + brightness;
  }
  if (spec.tear && spec.tear.shiftPx !== 0) {
    const first = Math.floor(spec.tear.at * height);
    for (let y = first; y < height; y++) {
      const row = grey.slice(y * width, (y + 1) * width);
      for (let x = 0; x < width; x++) {
        grey[y * width + x] = row[Math.min(width - 1, Math.max(0, x - spec.tear.shiftPx))];
      }
    }
  }

  const random = createRandom(spec.seed ?? 1);
  const noise = spec.noise ?? 0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < grey.length; i++) {
    const value = grey[i] + (noise ? (random() * 2 - 1) * noise : 0);
    const o = i * 4;
    data[o] = value;
    data[o + 1] = value;
    data[o + 2] = value;
    data[o + 3] = 255;
  }
  return { data, width, height };
}

const URL_TEXT = 'https://qrcraftly.com/scan?ref=corpus';

/** The longest corpus text that still fits the requested version at error correction M. */
function textForVersion(version: number): string {
  const base = 'qrcraftly corpus 0123456789 '.repeat(120);
  let low = 1;
  let high = base.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (QRCode.create(base.slice(0, mid), { errorCorrectionLevel: 'M' }).version <= version) low = mid;
    else high = mid - 1;
  }
  return base.slice(0, low);
}

/** The corpus as specs, so a caller can render only what it needs. */
export function corpusSpecs(): Array<{ id: string; category: string; spec: CorpusSpec }> {
  const entries: Array<{ id: string; category: string; spec: CorpusSpec }> = [];
  const add = (category: string, detail: string, spec: CorpusSpec) =>
    entries.push({ id: `${category}/${detail}`, category, spec });

  for (const modulePx of [2, 3, 4, 6, 10]) add('module-size', `${modulePx}px`, { text: URL_TEXT, modulePx });
  // A small code in a 1080p camera frame: readable only from the native-resolution region of
  // interest, since downscaling the whole frame to 1280 px leaves modules of 1.3 px (#1099).
  add('module-size', '2px-1080p', { text: URL_TEXT, modulePx: 2, width: 1920, height: 1080 });
  for (const version of [1, 5, 10, 15, 20, 25]) {
    add('version', `v${version}`, {
      text: textForVersion(version),
      version,
      modulePx: version >= 20 ? 3 : 4,
    });
  }
  for (const level of ['L', 'M', 'Q', 'H'] as const) {
    add('ecc', level, { text: URL_TEXT, errorCorrection: level });
  }
  add('inverted', '4px', { text: URL_TEXT, invert: true });
  add('inverted', '2px', { text: URL_TEXT, invert: true, modulePx: 2 });
  for (const rotateDeg of [15, 45, 90]) add('rotated', `${rotateDeg}deg`, { text: URL_TEXT, rotateDeg });
  for (const perspective of [0.1, 0.25]) add('perspective', `${perspective}`, { text: URL_TEXT, perspective });
  for (const blurPx of [1, 2]) add('blur', `${blurPx}px`, { text: URL_TEXT, blurPx, modulePx: 6 });
  for (const noise of [6, 10, 14, 20]) add('noise', `pm${noise}`, { text: URL_TEXT, noise });
  for (const glare of [60, 110]) add('glare', `${glare}`, { text: URL_TEXT, glare });
  for (const noise of [0, 10, 14, 20, 30]) add('no-code', `noise-pm${noise}`, { text: null, noise });
  return entries;
}

/**
 * Renders the whole corpus (or the entries whose id contains `filter`).
 * @param filter Optional substring of the fixture id.
 */
export function* generateCorpus(filter?: string): Generator<CorpusFrame> {
  for (const { id, category, spec } of corpusSpecs()) {
    if (filter && !id.includes(filter)) continue;
    const frame = renderCorpusFrame(spec);
    yield { id, category, expected: spec.text, ...frame };
  }
}
