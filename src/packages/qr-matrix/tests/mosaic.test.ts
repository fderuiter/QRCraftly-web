/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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
 * Mosaic QR engine tests (issues #1014, #1017, #1018; ADR 0019).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  planMosaic,
  renderMosaic,
  rasterizeMosaic,
  sampleMosaicGrid,
  resolveMosaicThresholds,
  isMosaicFunctionModule,
  DEFAULT_MOSAIC_OPTIONS,
  getMosaicSource,
  storeMosaicSource,
  clearMosaicSourceCache,
  loadMosaicSource,
  type MosaicPlan,
  type MosaicMode,
  type MosaicSource,
} from '../mosaic';
import { drawQRInternal } from '../index';
import { getLuminanceFromRgb } from '@/utils/colorUtils';
import { DEFAULT_CONFIG } from '@/constants';
import { SvgContext } from '@/packages/qr-export';
import jsQR from 'jsqr';
import { qrReader } from '../../../../tests/fixtures/qrReader';
import { qrEncoder as QRCode } from '../../../../tests/fixtures/qrEncoder';
import type { QRConfig, QRModules, QRErrorCorrectionLevel } from '@/types';

/** Encodes a payload with the real `qrcode` encoder. */
function encode(payload: string, ecl: QRErrorCorrectionLevel | 'L' | 'M' | 'Q' | 'H' = 'H'): QRModules {
  return QRCode.create(payload, { errorCorrectionLevel: ecl }).modules as unknown as QRModules;
}

/** Deterministic PRNG (mulberry32) so image fixtures never change between runs. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type FixtureImage = 'gradient' | 'noise' | 'black' | 'white' | 'checker' | 'stripes';

const FIXTURE_IMAGES: FixtureImage[] = ['gradient', 'noise', 'black', 'white', 'checker', 'stripes'];

/** Builds a synthetic RGBA test image (non-square on purpose, to exercise the cover crop). */
function makeImage(kind: FixtureImage, width = 240, height = 160): MosaicSource {
  const data = new Uint8ClampedArray(width * height * 4);
  const rand = prng(1013);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = 255;
      let g = 255;
      let b = 255;
      if (kind === 'gradient') {
        r = (x * 255) / width;
        g = (y * 255) / height;
        b = 128;
      } else if (kind === 'noise') {
        r = rand() * 255;
        g = rand() * 255;
        b = rand() * 255;
      } else if (kind === 'black') {
        r = g = b = 0;
      } else if (kind === 'checker') {
        r = g = b = ((x >> 3) + (y >> 3)) & 1 ? 255 : 0;
      } else if (kind === 'stripes') {
        const v = (x >> 4) & 1 ? 230 : 20;
        r = v;
        g = 255 - v;
        b = v / 2;
      }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Box-blurs an RGBA image, a simple model of camera defocus. */
function boxBlur(source: MosaicSource, radius: number): MosaicSource {
  const { width, height, data } = source;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          const j = (yy * width + xx) * 4;
          r += data[j];
          g += data[j + 1];
          b += data[j + 2];
          n++;
        }
      }
      const i = (y * width + x) * 4;
      out[i] = r / n;
      out[i + 1] = g / n;
      out[i + 2] = b / n;
      out[i + 3] = 255;
    }
  }
  return { width, height, data: out };
}

const lumAt = (plan: MosaicPlan, gy: number, gx: number) => {
  const grid = plan.moduleCount * plan.subdivisions;
  const o = (gy * grid + gx) * 3;
  return getLuminanceFromRgb(plan.colors[o] / 255, plan.colors[o + 1] / 255, plan.colors[o + 2] / 255);
};

describe('resolveMosaicThresholds', () => {
  it('widens the dark/light gap as contrast rises and clamps out-of-range input', () => {
    const low = resolveMosaicThresholds(0);
    const high = resolveMosaicThresholds(1);
    expect(high.darkMax).toBeLessThan(low.darkMax);
    expect(high.lightMin).toBeGreaterThan(low.lightMin);
    expect(resolveMosaicThresholds(-5)).toEqual(low);
    expect(resolveMosaicThresholds(9)).toEqual(high);
    // Core contrast ratio stays at least about 5:1 even at the lowest setting.
    expect((low.lightMin + 0.05) / (low.darkMax + 0.05)).toBeGreaterThan(4.9);
    // Outer halftone cells are always looser than the core.
    expect(low.softDarkMax).toBeGreaterThan(low.darkMax);
    expect(low.softLightMin).toBeLessThan(low.lightMin);
  });
});

describe('isMosaicFunctionModule', () => {
  it('covers finders, format info, timing, alignment and version info', () => {
    const n = 45; // version 7
    expect(isMosaicFunctionModule(0, 0, n)).toBe(true);
    expect(isMosaicFunctionModule(8, 8, n)).toBe(true); // format info
    expect(isMosaicFunctionModule(0, n - 1, n)).toBe(true);
    expect(isMosaicFunctionModule(n - 1, 0, n)).toBe(true);
    expect(isMosaicFunctionModule(6, 20, n)).toBe(true); // timing row
    expect(isMosaicFunctionModule(20, 6, n)).toBe(true); // timing column
    expect(isMosaicFunctionModule(22, 22, n)).toBe(true); // alignment centre
    expect(isMosaicFunctionModule(0, n - 10, n)).toBe(true); // version info
    expect(isMosaicFunctionModule(n - 10, 0, n)).toBe(true);
    expect(isMosaicFunctionModule(14, 14, n)).toBe(false);
    expect(isMosaicFunctionModule(0, 41 - 11, 41)).toBe(false); // no version info below v7
  });
});

describe('sampleMosaicGrid', () => {
  it('centre-crops to a square and composites transparent pixels over white', () => {
    // 4x2 image: left and right columns red, middle columns blue; bottom row transparent.
    const data = new Uint8ClampedArray(4 * 2 * 4);
    for (let x = 0; x < 4; x++) {
      const top = x * 4;
      const [r, g, b] = x === 0 || x === 3 ? [255, 0, 0] : [0, 0, 255];
      data.set([r, g, b, 255], top);
      data.set([0, 0, 0, 0], (4 + x) * 4);
    }
    const out = sampleMosaicGrid({ width: 4, height: 2, data }, 2);
    // The crop keeps only the blue middle columns.
    expect(Array.from(out.slice(0, 6))).toEqual([0, 0, 255, 0, 0, 255]);
    // Transparent pixels read as white.
    expect(Array.from(out.slice(6, 12))).toEqual([255, 255, 255, 255, 255, 255]);
  });

  it('returns white for an empty image', () => {
    const out = sampleMosaicGrid({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, 3);
    expect(out.every((v) => v === 255)).toBe(true);
  });
});

describe('planMosaic', () => {
  const modules = encode('https://qrcraftly.com/mosaic', 'H');
  const n = modules.size;

  for (const kind of FIXTURE_IMAGES) {
    it(`keeps every core on the right side of its limit (${kind})`, () => {
      for (const contrast of [0, 0.5, 1]) {
        const th = resolveMosaicThresholds(contrast);
        for (const mode of ['tiles', 'halftone'] as const) {
          const plan = planMosaic(modules, makeImage(kind), { mode, contrast });
          const s = plan.subdivisions;
          const core = Math.floor(s / 2);
          for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
              const lum = lumAt(plan, r * s + core, c * s + core);
              if (modules.get(r, c)) expect(lum).toBeLessThanOrEqual(th.darkMax + 1e-9);
              else expect(lum).toBeGreaterThanOrEqual(th.lightMin - 1e-9);
            }
          }
        }
      }
    });
  }

  it('keeps the looser limit on halftone outer cells', () => {
    const th = resolveMosaicThresholds(DEFAULT_MOSAIC_OPTIONS.contrast);
    const plan = planMosaic(modules, makeImage('gradient'), DEFAULT_MOSAIC_OPTIONS);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const lum = lumAt(plan, r * 3, c * 3);
        if (modules.get(r, c)) expect(lum).toBeLessThanOrEqual(th.softDarkMax + 1e-9);
        else expect(lum).toBeGreaterThanOrEqual(th.softLightMin - 1e-9);
      }
    }
  });

  it('draws function patterns as solid tiles in halftone mode', () => {
    const plan = planMosaic(modules, makeImage('noise'), { mode: 'halftone', contrast: 0 });
    const grid = n * 3;
    for (const [r, c] of [[0, 0], [3, 3], [6, 12], [n - 1, 0]]) {
      const first = ((r * 3) * grid + c * 3) * 3;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const o = ((r * 3 + i) * grid + (c * 3 + j)) * 3;
          expect(Array.from(plan.colors.slice(o, o + 3))).toEqual(Array.from(plan.colors.slice(first, first + 3)));
        }
      }
    }
  });

  it('keeps the image hue', () => {
    // A saturated red image must stay red-dominant in both dark and light modules.
    const data = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < 64; i++) data.set([220, 30, 30, 255], i * 4);
    const plan = planMosaic(modules, { width: 8, height: 8, data }, { mode: 'tiles', contrast: 0.5 });
    for (let i = 0; i < plan.colors.length; i += 3) {
      expect(plan.colors[i]).toBeGreaterThanOrEqual(plan.colors[i + 1]);
      expect(plan.colors[i]).toBeGreaterThanOrEqual(plan.colors[i + 2]);
    }
  });

  it('uses the defaults when no options are given', () => {
    expect(planMosaic(modules, makeImage('white')).subdivisions).toBe(3);
  });
});

describe('renderMosaic', () => {
  const recorder = () => {
    const rects: number[][] = [];
    const fills: string[] = [];
    const ctx = {
      fillStyle: '',
      beginPath: vi.fn(),
      rect: vi.fn((...args: number[]) => rects.push(args)),
      fill: vi.fn(function (this: { fillStyle: string }) {
        fills.push(this.fillStyle);
      }),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, fills };
  };

  it('covers the whole module area exactly once and fills each colour once', () => {
    const modules = encode('hello', 'M');
    const plan = planMosaic(modules, makeImage('gradient'), DEFAULT_MOSAIC_OPTIONS);
    const { ctx, rects, fills } = recorder();
    renderMosaic(ctx, plan, 10, 10, 3);
    const area = rects.reduce((sum, [, , w, h]) => sum + w * h, 0);
    expect(area).toBeCloseTo((modules.size * 3) ** 2, 6);
    expect(new Set(fills).size).toBe(fills.length);
  });

  it('merges same-colour runs', () => {
    const modules = encode('hello', 'M');
    const plan = planMosaic(modules, makeImage('black'), { mode: 'tiles', contrast: 1 });
    const { ctx, rects } = recorder();
    renderMosaic(ctx, plan, 0, 0, 1);
    expect(rects.length).toBeLessThan(modules.size * modules.size);
  });

  it('leaves skipped modules empty', () => {
    const modules = encode('hello', 'M');
    const plan = planMosaic(modules, makeImage('gradient'), { mode: 'tiles', contrast: 0.5 });
    const { ctx, rects } = recorder();
    renderMosaic(ctx, plan, 0, 0, 1, (r, c) => r === 10 && c === 10);
    const area = rects.reduce((sum, [, , w, h]) => sum + w * h, 0);
    expect(area).toBeCloseTo(modules.size ** 2 - 1, 6);
    expect(rects.some(([x, y]) => x === 10 && y === 10)).toBe(false);
  });
});

describe('rasterizeMosaic', () => {
  it('adds a white quiet zone around the modules', () => {
    const modules = encode('hello', 'M');
    const plan = planMosaic(modules, makeImage('black'), { mode: 'tiles', contrast: 1 });
    const img = rasterizeMosaic(plan, 2, 4);
    expect(img.width).toBe((modules.size + 8) * 2);
    expect(Array.from(img.data.slice(0, 4))).toEqual([255, 255, 255, 255]);
    // The top-left finder corner is dark.
    const o = (8 * img.width + 8) * 4;
    expect(img.data[o]).toBeLessThan(64);
  });
});

describe('mosaic source cache', () => {
  beforeEach(() => clearMosaicSourceCache());

  it('stores, returns and evicts the oldest decoded image', async () => {
    const img = makeImage('white', 2, 2);
    for (let i = 0; i < 5; i++) storeMosaicSource(`data:image/png;base64,${i}`, img);
    expect(getMosaicSource('data:image/png;base64,0')).toBeUndefined();
    expect(getMosaicSource('data:image/png;base64,4')).toBe(img);
    expect(getMosaicSource(null)).toBeUndefined();
    await expect(loadMosaicSource('data:image/png;base64,4')).resolves.toBe(img);
  });

  it('resolves null when the image cannot be decoded', async () => {
    await expect(loadMosaicSource('data:image/png;base64,broken')).resolves.toBeNull();
  });
});

describe('drawQRInternal with a mosaic', () => {
  const url = 'data:image/png;base64,mosaic-test';
  const config: QRConfig = { ...(DEFAULT_CONFIG as QRConfig), mosaicImageUrl: url, mosaicMode: 'tiles', mosaicContrast: 1 };
  const modules = encode('https://qrcraftly.com/', 'H');

  beforeEach(() => clearMosaicSourceCache());

  it('renders the mosaic instead of the pattern and eyes once the image is decoded', () => {
    storeMosaicSource(url, makeImage('stripes'));
    const svg = new SvgContext(300, 300);
    drawQRInternal(svg as unknown as CanvasRenderingContext2D, modules, config, null, null, 300, modules.size, true);
    const out = svg.serialize();
    const fills = new Set(Array.from(out.matchAll(/fill="(#[0-9a-f]{6})"/g), (m) => m[1]));
    // Stripes produce several tinted colours rather than the plain two-colour pattern.
    expect(fills.size).toBeGreaterThan(3);
  });

  it('falls back to the normal pattern while the image is not decoded', () => {
    const svg = new SvgContext(300, 300);
    drawQRInternal(svg as unknown as CanvasRenderingContext2D, modules, config, null, null, 300, modules.size, true);
    const fills = new Set(Array.from(svg.serialize().matchAll(/fill="(#[0-9a-f]{6})"/g), (m) => m[1]));
    expect(fills.size).toBeLessThanOrEqual(3);
  });
});

/**
 * Scannability verification for Mosaic QR (issue #1017).
 *
 * Mosaics are planned with the production engine, rasterised without a canvas and
 * decoded with the real jsQR decoder, clean and after a blur that models camera defocus.
 */
const PAYLOADS = [
  'https://qrcraftly.com/',
  'WIFI:T:WPA;S:Studio Guest;P:correct horse battery staple;;',
  'Mosaic QR keeps every module polarity. '.repeat(8),
];

const decode = (img: MosaicSource) => jsQR(new Uint8ClampedArray(img.data), img.width, img.height)?.data ?? null;
/** Our decoder (#1178), run beside jsQR until it replaces it. */
const decodeOurs = (img: MosaicSource) => qrReader.read(new Uint8ClampedArray(img.data), img.width, img.height)[0]?.text ?? null;

describe('Mosaic QR decodes with jsQR', () => {
  const modes: MosaicMode[] = ['tiles', 'halftone'];
  const contrasts = [DEFAULT_MOSAIC_OPTIONS.contrast, 1];

  for (const mode of modes) {
    for (const contrast of contrasts) {
      it(`${mode} at contrast ${contrast}: every payload, EC level and image decodes`, () => {
        const failures: string[] = [];
        for (const payload of PAYLOADS) {
          for (const ecl of ['M', 'H'] as const) {
            const modules = encode(payload, ecl);
            for (const kind of FIXTURE_IMAGES) {
              const plan = planMosaic(modules, makeImage(kind), { mode, contrast });
              const raster = rasterizeMosaic(plan, 6);
              if (decode(raster) !== payload) failures.push(`clean ${kind} ${ecl} v${(modules.size - 17) / 4}`);
              const blurred = boxBlur(raster, 1);
              if (decode(blurred) !== payload) failures.push(`blurred ${kind} ${ecl} v${(modules.size - 17) / 4}`);
              if (decodeOurs(raster) !== payload) failures.push(`qr-decode clean ${kind} ${ecl} v${(modules.size - 17) / 4}`);
              if (decodeOurs(blurred) !== payload) failures.push(`qr-decode blurred ${kind} ${ecl} v${(modules.size - 17) / 4}`);
            }
          }
        }
        expect(failures).toEqual([]);
      }, 60_000);
    }
  }

  it('decodes at the smallest halftone raster (one pixel per sub-cell)', () => {
    const payload = PAYLOADS[0];
    for (const kind of FIXTURE_IMAGES) {
      const plan = planMosaic(encode(payload), makeImage(kind), DEFAULT_MOSAIC_OPTIONS);
      const raster = rasterizeMosaic(plan, 3);
      expect(decode(raster)).toBe(payload);
      expect(decodeOurs(raster)).toBe(payload);
    }
  });
});
