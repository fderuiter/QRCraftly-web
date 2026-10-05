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
 * The hard decode corpus from the decoder comparison in #1104, kept in the repo so the
 * zxing parity gate of #1178 can be measured again: `pnpm run bench:scanner --corpus hard`.
 *
 * Each subset holds seeded synthetic camera frames (640x480 and 1280x720) of a real QR
 * code on a cluttered background, drawn through a pinhole projection with 3x3
 * supersampling and then degraded: small modules, sensor noise, box and gaussian blur,
 * strong perspective, low contrast and uneven lighting, light on dark, and everything at
 * once. `negatives` holds frames with no code (pure noise and blurred scenes). The frames
 * match #1104's except that the codes come from our encoder rather than the `qrcode`
 * package, so mask choices can differ.
 */
import { qrEncoder } from '../fixtures/qrEncoder';
import type { CorpusFrame } from './scannerCorpus';

export const HARD_SUBSETS = ['clean', 'small_modules', 'noise', 'blur', 'perspective', 'low_contrast', 'inverted', 'combined_hard', 'negatives'] as const;
export type HardSubset = (typeof HARD_SUBSETS)[number];

/** A hard corpus frame, with where its symbol was drawn (for diagnosing a miss). */
export interface HardFrame extends CorpusFrame {
  symbol: { corners: Point[]; version: number } | null;
}

/** The subsets #1178's parity gate is measured on: every one with a code in it. */
export const GATE_SUBSETS: readonly HardSubset[] = HARD_SUBSETS.filter((subset) => subset !== 'negatives');

interface Random {
  u: () => number;
  gauss: () => number;
  range: (lo: number, hi: number) => number;
  int: (lo: number, hi: number) => number;
}

/** mulberry32 with a Box-Muller gaussian, as in #1104. */
function makeRandom(seed: number): Random {
  let a = seed;
  const u = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  const gauss = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let x: number;
    let y: number;
    let s: number;
    do {
      x = u() * 2 - 1;
      y = u() * 2 - 1;
      s = x * x + y * y;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = y * m;
    return x * m;
  };
  return { u, gauss, range: (lo, hi) => lo + (hi - lo) * u(), int: (lo, hi) => lo + Math.floor(u() * (hi - lo + 1)) };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ALNUM = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const token = (r: Random, n: number) => Array.from({ length: n }, () => ALNUM[Math.floor(r.u() * ALNUM.length)]).join('');

function payload(kind: 'url' | 'wifi' | 'vcard', r: Random): string {
  if (kind === 'url') return `https://example.com/m/${token(r, 6)}?t=${r.int(1, 99)}&ref=${token(r, 5)}`;
  if (kind === 'wifi') return `WIFI:T:WPA;S:CafeNet-${token(r, 4)};P:${token(r, 14)};H:false;;`;
  return `BEGIN:VCARD\nVERSION:3.0\nN:Doe;Jane\nFN:Jane Doe\nORG:Example Corp\nTEL;TYPE=CELL:+1 555 01${r.int(10, 99)}\nEMAIL;TYPE=INTERNET:jane.${token(r, 4)}@example.com\nADR:;;1 Main St;Springfield;IL;62701;USA\nURL:https://example.com\nEND:VCARD`;
}

export type Point = [number, number];
type Matrix3 = [number, number, number, number, number, number, number, number, number];

/** The homography mapping each `src` point to its `dst` point. */
function solveHomography(src: Point[], dst: Point[]): Matrix3 {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [X, Y] = dst[i];
    a.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    a.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 8; k++) a[r][k] -= f * a[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / a[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function invert3([a, b, c, d, e, f, g, h, i]: Matrix3): Matrix3 {
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/**
 * Corners of a square of side `size` pixels centred at `cx`, `cy`, tilted out of plane by `tilt`
 * degrees about an in-plane axis at `axis` degrees, pinhole-projected, then rotated by `rot`.
 */
function projectedCorners(width: number, height: number, size: number, tilt: number, axis: number, rot: number, cx: number, cy: number): Point[] {
  const f = 1.1 * Math.max(width, height);
  const t = (tilt * Math.PI) / 180;
  const ax = (axis * Math.PI) / 180;
  const r = (rot * Math.PI) / 180;
  const ux = Math.cos(ax);
  const uy = Math.sin(ax);
  const corners: Point[] = [
    [-size / 2, -size / 2],
    [size / 2, -size / 2],
    [size / 2, size / 2],
    [-size / 2, size / 2],
  ];
  return corners.map(([x, y]) => {
    // Rodrigues rotation of (x, y, 0) about the unit axis (ux, uy, 0).
    const dot = x * ux + y * uy;
    const crossZ = ux * y - uy * x;
    const ct = Math.cos(t);
    const rx = x * ct + ux * dot * (1 - ct);
    const ry = y * ct + uy * dot * (1 - ct);
    const s = f / (f + crossZ * Math.sin(t));
    const px = rx * s;
    const py = ry * s;
    return [cx + px * Math.cos(r) - py * Math.sin(r), cy + px * Math.sin(r) + py * Math.cos(r)];
  });
}

/** A gently shaded background with a few flat rectangles for clutter. */
function background(width: number, height: number, r: Random, base = 150): Float32Array {
  const g = new Float32Array(width * height);
  const fx = r.range(80, 300);
  const fy = r.range(80, 300);
  const px = r.range(0, 6);
  const py = r.range(0, 6);
  const amp = r.range(10, 35);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) g[y * width + x] = base + amp * Math.sin(x / fx + px) * Math.cos(y / fy + py);
  const objects = r.int(3, 8);
  for (let k = 0; k < objects; k++) {
    const w = r.int(20, width / 4);
    const h = r.int(20, height / 4);
    const x0 = r.int(0, width - w);
    const y0 = r.int(0, height - h);
    const v = r.range(40, 230);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g[y * width + x] = v;
  }
  return g;
}

interface Drawing {
  modulePx: number;
  tilt: number;
  axis: number;
  rot: number;
  dark: number;
  light: number;
  cx: number;
  cy: number;
}

/**
 * Draws the symbol with a four-module quiet zone, each pixel the mean of 3 x 3 samples.
 * @returns The symbol's top-left, top-right, bottom-right and bottom-left corners in the frame.
 */
function drawCode(g: Float32Array, width: number, height: number, modules: { size: number; data: ArrayLike<number> }, d: Drawing): Point[] {
  const n = modules.size;
  const q = 4;
  const side = n + 2 * q;
  const corners = projectedCorners(width, height, side * d.modulePx, d.tilt, d.axis, d.rot, d.cx, d.cy);
  const toFrame = solveHomography(
    [
      [0, 0],
      [side, 0],
      [side, side],
      [0, side],
    ],
    corners
  );
  const toModule = invert3(toFrame);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const SS = 3;
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = toModule;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let acc = 0;
      let inside = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const X = x + (sx + 0.5) / SS;
          const Y = y + (sy + 0.5) / SS;
          const w = h6 * X + h7 * Y + h8;
          const u = (h0 * X + h1 * Y + h2) / w;
          const v = (h3 * X + h4 * Y + h5) / w;
          if (u < 0 || v < 0 || u >= side || v >= side) continue;
          inside++;
          const mx = Math.floor(u) - q;
          const my = Math.floor(v) - q;
          const on = mx >= 0 && my >= 0 && mx < n && my < n && modules.data[my * n + mx] === 1;
          acc += on ? d.dark : d.light;
        }
      }
      if (inside) {
        const i = y * width + x;
        g[i] = (acc + g[i] * (SS * SS - inside)) / (SS * SS);
      }
    }
  }
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = toFrame;
  const project = ([u, v]: Point): Point => {
    const w = a6 * u + a7 * v + a8;
    return [(a0 * u + a1 * v + a2) / w, (a3 * u + a4 * v + a5) / w];
  };
  return [project([q, q]), project([q + n, q]), project([q + n, q + n]), project([q, q + n])];
}

function boxBlur(g: Float32Array, width: number, height: number, radius: number): Float32Array {
  return separable(g, width, height, Array.from({ length: 2 * radius + 1 }, () => 1 / (2 * radius + 1)));
}

function gaussBlur(g: Float32Array, width: number, height: number, sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  return separable(
    g,
    width,
    height,
    kernel.map((v) => v / sum)
  );
}

/** Convolves rows then columns with `kernel`, clamping at the edges. */
function separable(g: Float32Array, width: number, height: number, kernel: number[]): Float32Array {
  const radius = (kernel.length - 1) / 2;
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let d = -radius; d <= radius; d++) s += kernel[d + radius] * g[y * width + Math.min(width - 1, Math.max(0, x + d))];
      tmp[y * width + x] = s;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let d = -radius; d <= radius; d++) s += kernel[d + radius] * tmp[Math.min(height - 1, Math.max(0, y + d)) * width + x];
      out[y * width + x] = s;
    }
  }
  return out;
}

/** Grey to RGBA with gaussian sensor noise of `sigma` levels. */
function toRgba(g: Float32Array, r: Random, sigma: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(g.length * 4);
  for (let i = 0; i < g.length; i++) {
    const v = g[i] + (sigma ? r.gauss() * sigma : 0);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return data;
}

const SIZES: Array<[number, number]> = [
  [640, 480],
  [1280, 720],
];
const KINDS = ['url', 'wifi', 'vcard'] as const;
const LEVELS = ['L', 'M', 'H'] as const;

/** Fixture `i` of a subset with a code. */
function sample(subset: Exclude<HardSubset, 'negatives'>, i: number): HardFrame {
  const r = makeRandom(hashString(`${subset}:${i}`));
  const [width, height] = SIZES[i % 2];
  const text = payload(KINDS[Math.floor(i / 2) % 3], r);
  const symbol = qrEncoder.create(text, { errorCorrectionLevel: LEVELS[Math.floor(i / 6) % 3] });
  const modules = symbol.modules;
  const fitMax = (Math.min(width, height) * 0.85) / (modules.size + 8);
  const pickModule = (lo: number, hi: number) => Math.min(fitMax, r.range(lo, hi));
  let dark = r.range(20, 45);
  let light = r.range(200, 235);
  let modulePx = 0;
  let noise = 2;
  let blur: { type: 'box'; radius: number } | { type: 'gauss'; sigma: number } | null = null;
  let tilt = 0;
  let axis = 0;
  let rot = r.range(-8, 8);
  let invert = false;
  let lighting: 'low_contrast' | 'gradient' | 'dark_frame' | null = null;
  switch (subset) {
    case 'clean':
      modulePx = pickModule(4, 8);
      break;
    case 'small_modules':
      modulePx = r.range(1.5, 3);
      noise = 3;
      break;
    case 'noise':
      modulePx = pickModule(3, 6);
      noise = [10, 14, 20, 30][i % 4];
      break;
    case 'blur':
      modulePx = pickModule(3, 6);
      blur = i % 2 === 0 ? { type: 'box', radius: [1, 2, 3][Math.floor(i / 2) % 3] } : { type: 'gauss', sigma: [1, 2, 3][Math.floor(i / 2) % 3] };
      break;
    case 'perspective':
      modulePx = pickModule(3, 6);
      tilt = r.range(15, 40);
      axis = r.range(0, 180);
      rot = r.range(0, 360);
      break;
    case 'low_contrast': {
      modulePx = pickModule(3, 6);
      lighting = (['low_contrast', 'gradient', 'dark_frame'] as const)[i % 3];
      if (lighting === 'low_contrast') {
        const mid = r.range(110, 150);
        const amp = r.range(18, 35);
        dark = mid - amp;
        light = mid + amp;
        noise = 3;
      }
      if (lighting === 'dark_frame') noise = 4;
      break;
    }
    case 'inverted':
      modulePx = pickModule(3, 6);
      invert = true;
      break;
    case 'combined_hard':
      modulePx = pickModule(3, 5);
      noise = [10, 14, 20][i % 3];
      blur = { type: 'gauss', sigma: [1, 1.5, 2][Math.floor(i / 3) % 3] };
      tilt = r.range(15, 35);
      axis = r.range(0, 180);
      rot = r.range(0, 360);
      break;
  }
  let g = background(width, height, r);
  const cx = width / 2 + r.range(-0.1, 0.1) * width;
  const cy = height / 2 + r.range(-0.08, 0.08) * height;
  const drawing: Drawing = { modulePx, tilt, axis, rot, dark: invert ? light : dark, light: invert ? dark : light, cx, cy };
  const corners = drawCode(g, width, height, modules, drawing);
  if (invert) {
    // A light-on-dark code on a dark surface: invert the surroundings, then redraw the code.
    for (let k = 0; k < g.length; k++) g[k] = 255 - g[k];
    drawCode(g, width, height, modules, { ...drawing, dark: light, light: dark });
  }
  if (lighting === 'gradient') {
    // Strong directional shading, 0.25 to 1 of full brightness across the frame.
    const a = r.range(0, 2 * Math.PI);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = ((x - width / 2) * Math.cos(a) + (y - height / 2) * Math.sin(a)) / Math.hypot(width / 2, height / 2);
        g[y * width + x] *= 0.625 + 0.375 * t;
      }
    }
  }
  if (lighting === 'dark_frame') {
    const s = r.range(0.15, 0.3);
    for (let k = 0; k < g.length; k++) g[k] = g[k] * s + 5;
  }
  if (blur) g = blur.type === 'box' ? boxBlur(g, width, height, blur.radius) : gaussBlur(g, width, height, blur.sigma);
  return { id: `${subset}/${i}`, category: subset, expected: text, data: toRgba(g, r, noise), width, height, symbol: { corners, version: symbol.version } };
}

/** Fixture `i` of the negatives: pure noise or a blurred scene, with no code. */
function negative(i: number): HardFrame {
  const r = makeRandom(hashString(`negatives:${i}`));
  const [width, height] = SIZES[i % 2];
  const mode = Math.floor(i / 2) % 2 === 0 ? 'pure_noise' : 'scene';
  const sigma = [10, 14, 20, 30][Math.floor(i / 4) % 4];
  const g = mode === 'pure_noise' ? new Float32Array(width * height).fill(128) : gaussBlur(background(width, height, r), width, height, 1);
  return { id: `negatives/${mode}/${i}`, category: 'negatives', expected: null, data: toRgba(g, r, sigma), width, height, symbol: null };
}

/**
 * Generates `count` frames per subset, subset by subset.
 * @param filter - Only fixtures whose id contains this text.
 */
export function* generateHardCorpus(count = 60, filter?: string): Generator<HardFrame> {
  for (const subset of HARD_SUBSETS) {
    for (let i = 0; i < count; i++) {
      if (filter && !`${subset}/${i}`.includes(filter) && !subset.includes(filter)) continue;
      yield subset === 'negatives' ? negative(i) : sample(subset, i);
    }
  }
}
