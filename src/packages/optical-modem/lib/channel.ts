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

import { createRng } from './prng';
import { modemKernels, type Point } from './kernels';
import type { RgbaImage } from './layout';

/** How a screen becomes a camera frame in the simulator. Everything is optional except the placement. */
export interface ChannelParams {
  /** Camera frame size in pixels. */
  width: number;
  height: number;
  /** Where the screen's top-left, top-right, bottom-right and bottom-left corners land in the camera frame. */
  corners: readonly [Point, Point, Point, Point];
  /** Passes of a [1 2 1] / 4 blur: 1 is a deviation of 0.7 px, 2 is 1.0 px, 4 is 1.4 px. */
  blurPasses?: number;
  /** Deviation of sensor noise in 8-bit levels, added before demosaicing. */
  noise?: number;
  /** Fraction of each colour that leaks into its neighbours (0 to 0.3). */
  crosstalk?: number;
  /** White-balance gain per channel. */
  gain?: readonly [number, number, number];
  /** Added to every channel, in 8-bit levels. */
  lift?: number;
  /** Illumination fall-off from the left edge to the right edge (0 to 1). */
  gradient?: number;
  /** Sample through an RGGB Bayer mosaic and demosaic bilinearly, which halves colour resolution. */
  bayer?: boolean;
  /** JPEG quality 1 to 100 (4:2:0 chroma, 8 x 8 blocks); 0 or missing leaves it out. */
  jpegQuality?: number;
  /** Camera rows from this one down show the `next` frame (a screen refresh during readout). */
  tearRow?: number;
  /** Seed for the noise. */
  seed?: number;
}

/** Colour of the bezel around the screen. */
const BEZEL = 16;

/**
 * Corners that put a frame in the middle of a camera image.
 * @param frame - Frame size in pixels.
 * @param camera - Camera size in pixels.
 * @param scale - Camera pixels per frame pixel.
 * @param keystone - Fraction of the frame height the right edge loses from top and bottom, for perspective.
 * @param tilt - tan(angle / 2) of an in-plane rotation, positive clockwise.
 * @returns The four corners, clockwise from the top-left.
 */
export function placeFrame(
  frame: { width: number; height: number },
  camera: { width: number; height: number },
  scale: number,
  keystone = 0,
  tilt = 0
): [Point, Point, Point, Point] {
  const w = frame.width * scale;
  const h = frame.height * scale;
  const cos = (1 - tilt * tilt) / (1 + tilt * tilt);
  const sin = (2 * tilt) / (1 + tilt * tilt);
  const cx = camera.width / 2;
  const cy = camera.height / 2;
  const place = (dx: number, dy: number): Point => ({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos });
  const k = keystone * h;
  return [place(-w / 2, -h / 2), place(w / 2, -h / 2 + k), place(w / 2, h / 2 - k), place(-w / 2, h / 2)];
}

function bilinear(image: RgbaImage, sx: number, sy: number, out: number[]): void {
  const { width, height, data } = image;
  const fx = sx - 0.5;
  const fy = sy - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const xa = Math.max(0, x0);
  const ya = Math.max(0, y0);
  for (let c = 0; c < 3; c++) {
    const top = data[(ya * width + xa) * 4 + c] * (1 - tx) + data[(ya * width + x1) * 4 + c] * tx;
    const bottom = data[(y1 * width + xa) * 4 + c] * (1 - tx) + data[(y1 * width + x1) * 4 + c] * tx;
    out[c] = top * (1 - ty) + bottom * ty;
  }
}

function warp(frame: RgbaImage, next: RgbaImage | undefined, params: ChannelParams): Float32Array[] {
  const { width, height } = params;
  const source = params.corners.map((p): [number, number] => [p.x, p.y]);
  const target: Point[] = [
    { x: 0, y: 0 },
    { x: frame.width, y: 0 },
    { x: frame.width, y: frame.height },
    { x: 0, y: frame.height },
  ];
  const inverse = modemKernels().solveHomography(source, target);
  if (!inverse) throw new Error('Degenerate screen placement');
  const planes = [new Float32Array(width * height), new Float32Array(width * height), new Float32Array(width * height)];
  const sample = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    const image = next && params.tearRow !== undefined && y >= params.tearRow ? next : frame;
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < 3; j++) {
        for (let i = 0; i < 3; i++) {
          const px = x + (i + 0.5) / 3;
          const py = y + (j + 0.5) / 3;
          const w = inverse[6] * px + inverse[7] * py + 1;
          const sx = (inverse[0] * px + inverse[1] * py + inverse[2]) / w;
          const sy = (inverse[3] * px + inverse[4] * py + inverse[5]) / w;
          if (sx < 0 || sy < 0 || sx >= frame.width || sy >= frame.height) {
            r += BEZEL;
            g += BEZEL;
            b += BEZEL;
          } else {
            bilinear(image, sx, sy, sample);
            r += sample[0];
            g += sample[1];
            b += sample[2];
          }
        }
      }
      planes[0][y * width + x] = r / 9;
      planes[1][y * width + x] = g / 9;
      planes[2][y * width + x] = b / 9;
    }
  }
  return planes;
}

function blurPlane(plane: Float32Array, width: number, height: number, passes: number): void {
  const tmp = new Float32Array(plane.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = y * width + x;
        tmp[at] = 0.25 * plane[at - (x > 0 ? 1 : 0)] + 0.5 * plane[at] + 0.25 * plane[at + (x < width - 1 ? 1 : 0)];
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = y * width + x;
        plane[at] = 0.25 * tmp[at - (y > 0 ? width : 0)] + 0.5 * tmp[at] + 0.25 * tmp[at + (y < height - 1 ? width : 0)];
      }
    }
  }
}

function demosaic(planes: Float32Array[], width: number, height: number): void {
  const mosaic = new Float32Array(width * height);
  const site = (x: number, y: number): number => ((x & 1) === 0 && (y & 1) === 0 ? 0 : (x & 1) === 1 && (y & 1) === 1 ? 2 : 1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) mosaic[y * width + x] = planes[site(x, y)][y * width + x];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || site(nx, ny) !== c) continue;
            sum += mosaic[ny * width + nx];
            count++;
          }
        }
        planes[c][y * width + x] = sum / count;
      }
    }
  }
}

const LUMA_TABLE = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104,
  113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMA_TABLE = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, ...new Array<number>(32).fill(99),
];

let dctBasis: Float64Array | null = null;

function basis(): Float64Array {
  if (!dctBasis) {
    // cos(k * pi / 16) from a recurrence: engines may differ in Math.cos, never in * and -.
    const cosines = [1, 0.9807852804032304];
    for (let k = 2; k < 32; k++) cosines.push(2 * cosines[1] * cosines[k - 1] - cosines[k - 2]);
    dctBasis = new Float64Array(64);
    for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) dctBasis[u * 8 + x] = (u === 0 ? Math.sqrt(0.5) : 1) * 0.5 * cosines[((2 * x + 1) * u) % 32];
  }
  return dctBasis;
}

function codePlane(plane: Float32Array, width: number, height: number, table: number[], scale: number): void {
  const a = basis();
  const quant = table.map((t) => Math.min(255, Math.max(1, Math.floor((t * scale + 50) / 100))));
  const block = new Float64Array(64);
  const tmp = new Float64Array(64);
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[y * 8 + x] = plane[Math.min(height - 1, by + y) * width + Math.min(width - 1, bx + x)] - 128;
      for (let u = 0; u < 8; u++) {
        for (let x = 0; x < 8; x++) {
          let s = 0;
          for (let y = 0; y < 8; y++) s += a[u * 8 + y] * block[y * 8 + x];
          tmp[u * 8 + x] = s;
        }
      }
      for (let u = 0; u < 8; u++) {
        for (let v = 0; v < 8; v++) {
          let s = 0;
          for (let x = 0; x < 8; x++) s += tmp[u * 8 + x] * a[v * 8 + x];
          const q = quant[u * 8 + v];
          block[u * 8 + v] = Math.round(s / q) * q;
        }
      }
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          let s = 0;
          for (let u = 0; u < 8; u++) s += a[u * 8 + y] * block[u * 8 + x];
          tmp[y * 8 + x] = s;
        }
      }
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (by + y >= height || bx + x >= width) continue;
          let s = 0;
          for (let v = 0; v < 8; v++) s += tmp[y * 8 + v] * a[v * 8 + x];
          plane[(by + y) * width + bx + x] = s + 128;
        }
      }
    }
  }
}

function jpeg(planes: Float32Array[], width: number, height: number, quality: number): void {
  const q = Math.min(100, Math.max(1, quality));
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  const size = width * height;
  const y = new Float32Array(size);
  const cbFull = new Float32Array(size);
  const crFull = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const [r, g, b] = [planes[0][i], planes[1][i], planes[2][i]];
    y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    cbFull[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    crFull[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const cw = Math.ceil(width / 2);
  const ch = Math.ceil(height / 2);
  const cb = new Float32Array(cw * ch);
  const cr = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      let sb = 0;
      let sr = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const at = Math.min(height - 1, 2 * j + dy) * width + Math.min(width - 1, 2 * i + dx);
          sb += cbFull[at];
          sr += crFull[at];
        }
      }
      cb[j * cw + i] = sb / 4;
      cr[j * cw + i] = sr / 4;
    }
  }
  codePlane(y, width, height, LUMA_TABLE, scale);
  codePlane(cb, cw, ch, CHROMA_TABLE, scale);
  codePlane(cr, cw, ch, CHROMA_TABLE, scale);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const at = py * width + px;
      const ci = (py >> 1) * cw + (px >> 1);
      const cbv = cb[ci] - 128;
      const crv = cr[ci] - 128;
      planes[0][at] = y[at] + 1.402 * crv;
      planes[1][at] = y[at] - 0.344136 * cbv - 0.714136 * crv;
      planes[2][at] = y[at] + 1.772 * cbv;
    }
  }
}

/**
 * Passes a frame through a model of a phone camera pointed at a screen: perspective, lens blur,
 * colour cross-talk, white balance and illumination, sensor noise, Bayer sampling, JPEG and a
 * screen refresh in the middle of the readout. Only additions, multiplications and divisions are
 * used (no `Math.sin`, `Math.exp` or similar), so a seed always gives the same capture.
 * @param frame - The rendered frame.
 * @param params - The channel.
 * @param next - The following frame, shown from `tearRow` down.
 * @returns The captured image.
 */
export function applyChannel(frame: RgbaImage, params: ChannelParams, next?: RgbaImage): RgbaImage {
  const { width, height } = params;
  const planes = warp(frame, next, params);
  const size = width * height;
  if (params.blurPasses) for (const plane of planes) blurPlane(plane, width, height, params.blurPasses);
  const x = params.crosstalk ?? 0;
  const gain = params.gain ?? [1, 1, 1];
  const lift = params.lift ?? 0;
  const gradient = params.gradient ?? 0;
  const rng = createRng(params.seed ?? 1);
  const sigma = params.noise ?? 0;
  for (let i = 0; i < size; i++) {
    const [r, g, b] = [planes[0][i], planes[1][i], planes[2][i]];
    const light = 1 - gradient * ((i % width) / width);
    const mixed = [(1 - x) * r + x * g, (1 - 2 * x) * g + x * (r + b), (1 - x) * b + x * g];
    for (let c = 0; c < 3; c++) planes[c][i] = mixed[c] * gain[c] * light + lift + (sigma > 0 ? sigma * rng.nextGaussian() : 0);
  }
  for (const plane of planes) for (let i = 0; i < size; i++) plane[i] = Math.min(255, Math.max(0, plane[i]));
  if (params.bayer) demosaic(planes, width, height);
  if (params.jpegQuality) jpeg(planes, width, height, params.jpegQuality);
  const out = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < size; i++) {
    out[i * 4] = Math.round(planes[0][i]);
    out[i * 4 + 1] = Math.round(planes[1][i]);
    out[i * 4 + 2] = Math.round(planes[2][i]);
    out[i * 4 + 3] = 255;
  }
  return { width, height, data: out };
}

/** Named channels: a propped phone, a typical handheld one and an old one. */
export type ChannelPreset = 'studio' | 'typical' | 'poor';

const PRESETS: Record<ChannelPreset, Omit<ChannelParams, 'width' | 'height' | 'corners' | 'seed' | 'tearRow'> & { keystone: number; tilt: number }> = {
  studio: { blurPasses: 1, noise: 1.5, crosstalk: 0.04, bayer: true, jpegQuality: 92, keystone: 0.005, tilt: 0.005, gain: [1, 0.98, 0.97], lift: 2 },
  typical: { blurPasses: 2, noise: 3, crosstalk: 0.08, bayer: true, jpegQuality: 82, keystone: 0.02, tilt: 0.02, gain: [1.05, 0.98, 0.9], lift: 4, gradient: 0.1 },
  poor: { blurPasses: 3, noise: 6, crosstalk: 0.12, bayer: true, jpegQuality: 65, keystone: 0.04, tilt: 0.04, gain: [1.1, 0.95, 0.85], lift: 8, gradient: 0.2 },
};

/** Options for {@link simulateCapture}. */
export interface CaptureOptions {
  /** Camera pixels per cell. */
  pixelsPerCell: number;
  /** Pixels per cell in the rendered frame. */
  cellPitch: number;
  seed?: number;
  /** The next frame, shown below `tearFraction` of the camera height. */
  next?: RgbaImage;
  tearFraction?: number;
}

/**
 * Captures a rendered frame through a named channel, with the screen filling about 80% of the
 * camera frame, as a handheld phone would frame it.
 * @param frame - The rendered frame.
 * @param preset - The channel.
 * @param options - Cell size on the camera and the seed.
 * @returns The camera image.
 */
export function simulateCapture(frame: RgbaImage, preset: ChannelPreset, options: CaptureOptions): RgbaImage {
  const { keystone, tilt, ...params } = PRESETS[preset];
  const scale = options.pixelsPerCell / options.cellPitch;
  const camera = { width: Math.ceil(frame.width * scale * 1.2), height: Math.ceil(frame.height * scale * 1.2) };
  return applyChannel(
    frame,
    {
      ...params,
      ...camera,
      corners: placeFrame(frame, camera, scale, keystone, tilt),
      seed: options.seed ?? 1,
      tearRow: options.next ? Math.floor(camera.height * (options.tearFraction ?? 0.5)) : undefined,
    },
    options.next
  );
}
