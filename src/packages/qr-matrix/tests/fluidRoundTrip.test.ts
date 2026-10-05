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
 * Real pixel round-trip for the Fluid Ink style (issue #919).
 *
 * The production renderer draws into a tiny software canvas defined below, which
 * flattens the recorded paths (lines, quadratic curves, arcs) and fills them with
 * the canvas default non-zero winding rule into an RGBA buffer. That buffer is then
 * decoded with our real decoder (#1178).
 */

import { describe, it, expect } from 'vitest';
import { qrEncoder as QRCode } from '../../../../tests/fixtures/qrEncoder';
import { qrReader } from '../../../../tests/fixtures/qrReader';
import {
  QRConfig,
  QRStyle,
  QRType,
  QRErrorCorrectionLevel,
  SocialFormat,
  TemplateStyle,
} from '@/types';
import { drawQRInternal, calculateLayout, clearFluidCache, isFinderSeparatorZone } from '../index';

interface Point {
  x: number;
  y: number;
}

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface FillOp {
  edges: Edge[];
  rgb: [number, number, number];
  evenOdd: boolean;
}

const parseColor = (style: unknown): [number, number, number] => {
  if (typeof style === 'string') {
    const hex = /^#([0-9a-f]{6})$/i.exec(style.trim());
    if (hex) {
      const n = parseInt(hex[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
  }
  return [0, 0, 0];
};

/**
 * Minimal CanvasRenderingContext2D implementation that rasterizes filled paths.
 * Only the drawing calls the matrix renderer uses are implemented.
 */
class RasterContext {
  readonly canvas: { width: number; height: number };
  readonly data: Uint8ClampedArray;
  readonly fills: FillOp[] = [];
  fillStyle: unknown = '#000000';
  strokeStyle: unknown = '#000000';
  globalAlpha = 1;
  lineWidth = 1;

  private subpaths: Point[][] = [];
  private current: Point[] | null = null;

  constructor(width: number, height: number) {
    this.canvas = { width, height };
    this.data = new Uint8ClampedArray(width * height * 4).fill(255);
  }

  beginPath(): void {
    this.subpaths = [];
    this.current = null;
  }

  moveTo(x: number, y: number): void {
    this.current = [{ x, y }];
    this.subpaths.push(this.current);
  }

  lineTo(x: number, y: number): void {
    if (!this.current) {
      this.moveTo(x, y);
      return;
    }
    this.current.push({ x, y });
  }

  closePath(): void {
    if (this.current && this.current.length > 0) {
      const start = this.current[0];
      this.moveTo(start.x, start.y);
    }
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    const p0 = this.lastPoint() ?? { x: cpx, y: cpy };
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      this.lineTo(
        mt * mt * p0.x + 2 * mt * t * cpx + t * t * x,
        mt * mt * p0.y + 2 * mt * t * cpy + t * t * y
      );
    }
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const p0 = this.lastPoint() ?? { x: c1x, y: c1y };
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      this.lineTo(
        mt ** 3 * p0.x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t ** 3 * x,
        mt ** 3 * p0.y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t ** 3 * y
      );
    }
  }

  arc(x: number, y: number, r: number, start: number, end: number, ccw = false): void {
    let sweep = end - start;
    if (!ccw && sweep < 0) sweep += 2 * Math.PI;
    if (ccw && sweep > 0) sweep -= 2 * Math.PI;
    if (Math.abs(end - start) >= 2 * Math.PI) sweep = ccw ? -2 * Math.PI : 2 * Math.PI;
    const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 32)));
    for (let i = 0; i <= steps; i++) {
      const a = start + (sweep * i) / steps;
      this.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const saved = this.subpaths;
    this.subpaths = [];
    this.rect(x, y, w, h);
    this.fill();
    this.subpaths = saved;
  }

  fill(rule?: unknown): void {
    const edges: Edge[] = [];
    for (const sp of this.subpaths) {
      for (let i = 0; i < sp.length; i++) {
        const a = sp[i];
        const b = sp[(i + 1) % sp.length];
        if (a.y !== b.y) edges.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
      }
    }
    const op: FillOp = { edges, rgb: parseColor(this.fillStyle), evenOdd: rule === 'evenodd' };
    this.fills.push(op);
    this.rasterize(op);
  }

  private lastPoint(): Point | null {
    if (!this.current || this.current.length === 0) return null;
    return this.current[this.current.length - 1];
  }

  private rasterize(op: FillOp): void {
    const { width, height } = this.canvas;
    for (let py = 0; py < height; py++) {
      const y = py + 0.5;
      const xs: Array<{ x: number; dir: number }> = [];
      for (const e of op.edges) {
        const minY = Math.min(e.y0, e.y1);
        const maxY = Math.max(e.y0, e.y1);
        if (y < minY || y >= maxY) continue;
        const t = (y - e.y0) / (e.y1 - e.y0);
        xs.push({ x: e.x0 + t * (e.x1 - e.x0), dir: e.y1 > e.y0 ? 1 : -1 });
      }
      if (xs.length === 0) continue;
      xs.sort((a, b) => a.x - b.x);
      let winding = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        winding += op.evenOdd ? 1 : xs[i].dir;
        const inside = op.evenOdd ? winding % 2 === 1 : winding !== 0;
        if (!inside) continue;
        const from = Math.max(0, Math.ceil(xs[i].x - 0.5));
        const to = Math.min(width - 1, Math.floor(xs[i + 1].x - 0.5));
        for (let px = from; px <= to; px++) {
          const idx = (py * width + px) * 4;
          this.data[idx] = op.rgb[0];
          this.data[idx + 1] = op.rgb[1];
          this.data[idx + 2] = op.rgb[2];
          this.data[idx + 3] = 255;
        }
      }
    }
  }

  /**
   * Exact (resolution-independent) colour at a point: the last fill that covers it.
   */
  colorAt(x: number, y: number): [number, number, number] {
    for (let f = this.fills.length - 1; f >= 0; f--) {
      const op = this.fills[f];
      let winding = 0;
      for (const e of op.edges) {
        const minY = Math.min(e.y0, e.y1);
        const maxY = Math.max(e.y0, e.y1);
        if (y < minY || y >= maxY) continue;
        const ix = e.x0 + ((y - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0);
        if (ix > x) winding += op.evenOdd ? 1 : e.y1 > e.y0 ? 1 : -1;
      }
      if (op.evenOdd ? winding % 2 === 1 : winding !== 0) return op.rgb;
    }
    return [255, 255, 255];
  }

  // Unused state calls: kept as no-ops so the renderer runs unchanged.
  save(): void {}
  restore(): void {}
  stroke(): void {}
  clip(): void {}
  clearRect(): void {}
  setTransform(): void {}
  resetTransform(): void {}
}

const toContext = (raster: RasterContext): CanvasRenderingContext2D =>
  new Proxy(raster, {
    get(target, prop, receiver) {
      if (prop in target) {
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      // Any drawing call the renderer adds later fails loudly instead of silently passing.
      throw new Error(`RasterContext does not implement ${String(prop)}`);
    },
  }) as unknown as CanvasRenderingContext2D;

const baseConfig: QRConfig = {
  value: '',
  type: QRType.TEXT,
  fgColor: '#000000',
  bgColor: '#ffffff',
  eyeColor: '#000000',
  errorCorrectionLevel: QRErrorCorrectionLevel.M,
  style: QRStyle.FLUID,
  isMazeEnabled: false,
  mazeColor: '#3b82f6',
  isMazeBridgesEnabled: false,
  showMazeSolution: false,
  logoUrl: null,
  logoSize: 0.2,
  logoPaddingStyle: 'square',
  logoPadding: 0,
  logoBackgroundColor: '#ffffff',
  isBorderEnabled: false,
  borderSize: 0.05,
  borderColor: '#000000',
  borderStyle: 'solid',
  borderText: '',
  borderTextPosition: 'bottom-center',
  borderTextColor: '#ffffff',
  borderLogoUrl: null,
  borderLogoPosition: 'bottom-center',
  socialFormat: SocialFormat.SQUARE_1_1,
  templateStyle: TemplateStyle.NONE,
};

const payloads: Array<{ name: string; value: string }> = [
  { name: 'short URL', value: 'https://qrcraftly.com' },
  { name: 'Wi-Fi', value: 'WIFI:T:WPA;S:Home Network;P:correct horse battery staple;;' },
  {
    name: 'vCard',
    value: 'BEGIN:VCARD\nVERSION:3.0\nN:Lovelace;Ada\nORG:Analytical Engines\nTEL:+15551234567\nEND:VCARD',
  },
  {
    name: 'long URL',
    value:
      'https://qrcraftly.com/fluid-scannability-verification-long-payload-with-extended-parameters-and-extra-data-for-stress-testing-density',
  },
];

const ecLevels = [
  QRErrorCorrectionLevel.L,
  QRErrorCorrectionLevel.M,
  QRErrorCorrectionLevel.Q,
  QRErrorCorrectionLevel.H,
];

interface QRModulesLike {
  size: number;
  get: (row: number, col: number) => number | boolean;
}

const QUIET_MODULES = 4;

// Software rasterising is slow on shared CI runners, so each (payload, EC, size)
// is drawn once and the result reused by every test that inspects it.
const renderCache = new Map<string, ReturnType<typeof renderFluidUncached>>();
const renderFluid = (value: string, ecLevel: QRErrorCorrectionLevel, pxPerModule = 8) => {
  const key = `${ecLevel}|${pxPerModule}|${value}`;
  let rendered = renderCache.get(key);
  if (!rendered) {
    rendered = renderFluidUncached(value, ecLevel, pxPerModule);
    renderCache.set(key, rendered);
  }
  return rendered;
};

function renderFluidUncached(value: string, ecLevel: QRErrorCorrectionLevel, pxPerModule: number) {
  const qr = QRCode.create(value, { errorCorrectionLevel: ecLevel });
  const modules = qr.modules as unknown as QRModulesLike;
  const moduleCount = modules.size;
  const size = (moduleCount + QUIET_MODULES * 2) * pxPerModule;
  const raster = new RasterContext(size, size);
  clearFluidCache();
  drawQRInternal(
    toContext(raster),
    modules as never,
    { ...baseConfig, value, errorCorrectionLevel: ecLevel },
    null,
    null,
    size,
    moduleCount
  );
  const { drawX, cellSize } = calculateLayout(baseConfig, size, moduleCount);
  return { raster, modules, moduleCount, size, origin: drawX, cell: cellSize };
}

const isDark = (rgb: [number, number, number]): boolean => rgb[0] + rgb[1] + rgb[2] < 384;

describe('Fluid Ink round-trip (real pixels)', { timeout: 60_000 }, () => {
  // Two module sizes: before the fluid eyeball became a squircle, a round eyeball made
  // jsQR (the decoder before #1178) miss the finder patterns at 8 and 16 px per module for some payloads.
  for (const { name, value } of payloads) {
    for (const ec of ecLevels) {
      it(`decodes ${name} at EC ${ec}`, () => {
        for (const px of [8, 16]) {
          const { raster, size } = renderFluid(value, ec, px);
          expect(qrReader.read(raster.data, size, size)[0]?.text, `could not decode ${name} at EC ${ec}, ${px}px/module`).toBe(value);
        }
      });
    }
  }

  for (const ec of ecLevels) {
    it(`renders every module centre with the colour of the encoded matrix at EC ${ec}`, () => {
      const { raster, modules, moduleCount, origin, cell } = renderFluid(payloads[3].value, ec);
      for (let r = 0; r < moduleCount; r++) {
        for (let c = 0; c < moduleCount; c++) {
          const inked = isDark(raster.colorAt(origin + (c + 0.5) * cell, origin + (r + 0.5) * cell));
          if (inked !== Boolean(modules.get(r, c))) {
            expect.fail(`module (${r},${c}) at EC ${ec} rendered ${inked ? 'dark' : 'light'}`);
          }
        }
      }
    });
  }

  it('actually renders fluid geometry (curves and diagonal bridges), not plain squares', () => {
    const { raster, modules, moduleCount, origin, cell } = renderFluid(payloads[3].value, QRErrorCorrectionLevel.H);
    const dark = (r: number, c: number) => Boolean(modules.get(r, c));
    let bridges = 0;
    let rounded = 0;
    for (let r = 9; r < moduleCount - 9; r++) {
      for (let c = 9; c < moduleCount - 9; c++) {
        // An isolated dark module renders as a dot: its corner is left light.
        if (dark(r, c) && !dark(r - 1, c) && !dark(r, c - 1) && !dark(r - 1, c - 1)) {
          if (!isDark(raster.colorAt(origin + (c + 0.03) * cell, origin + (r + 0.03) * cell))) rounded++;
        }
        // Two diagonal dark modules are joined by a neck through the shared corner.
        if (dark(r - 1, c - 1) && dark(r, c) && !dark(r - 1, c) && !dark(r, c - 1)) {
          if (isDark(raster.colorAt(origin + (c + 0.05) * cell, origin + (r - 0.05) * cell))) bridges++;
        }
      }
    }
    expect(rounded).toBeGreaterThan(0);
    expect(bridges).toBeGreaterThan(0);
  });

  for (const ec of ecLevels) {
    it(`keeps finder patterns intact and unbridged at EC ${ec}`, () => {
      const { raster, moduleCount, origin, cell } = renderFluid(payloads[3].value, ec);
      const at = (r: number, c: number, fr = 0.5, fc = 0.5) =>
        isDark(raster.colorAt(origin + (c + fc) * cell, origin + (r + fr) * cell));

      // 1. Every separator module is entirely light, including its corners, so no
      //    fluid neck from the data area reaches into the finder buffer.
      const fractions = [0.08, 0.3, 0.5, 0.7, 0.92];
      for (let r = 0; r < moduleCount; r++) {
        for (let c = 0; c < moduleCount; c++) {
          if (!isFinderSeparatorZone(r, c, moduleCount)) continue;
          for (const fr of fractions) {
            for (const fc of fractions) {
              expect(at(r, c, fr, fc), `separator (${r},${c}) inked at ${fr},${fc}`).toBe(false);
            }
          }
        }
      }

      // 2. Each finder keeps the 1:1:3:1:1 dark/light/dark/light/dark ratio along the
      //    horizontal and vertical centre lines that decoders scan.
      const corners: Array<[number, number]> = [
        [0, 0],
        [0, moduleCount - 7],
        [moduleCount - 7, 0],
      ];
      for (const [r0, c0] of corners) {
        const pattern = [true, false, true, true, true, false, true];
        for (let i = 0; i < 7; i++) {
          expect(at(r0 + 3, c0 + i), `finder row module (${r0 + 3},${c0 + i})`).toBe(pattern[i]);
          expect(at(r0 + i, c0 + 3), `finder column module (${r0 + i},${c0 + 3})`).toBe(pattern[i]);
        }
      }
    });
  }
});
