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
 * A tiny software canvas for real-pixel round-trip tests: it flattens the recorded
 * paths and fills them into an RGBA buffer that the real decoder can read.
 */

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

const parseColor = (style: unknown): [number, number, number] | null => {
  if (style === 'transparent') return null;
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
export class RasterContext {
  readonly canvas: { width: number; height: number };
  readonly data: Uint8ClampedArray;
  readonly fills: FillOp[] = [];
  fillStyle: unknown = '#000000';
  strokeStyle: unknown = '#000000';
  globalAlpha = 1;
  lineWidth = 1;

  private subpaths: Point[][] = [];
  private current: Point[] | null = null;
  private offset: Point = { x: 0, y: 0 };
  private readonly offsets: Point[] = [];

  constructor(width: number, height: number) {
    this.canvas = { width, height };
    this.data = new Uint8ClampedArray(width * height * 4).fill(255);
  }

  beginPath(): void {
    this.subpaths = [];
    this.current = null;
  }

  moveTo(x: number, y: number): void {
    this.current = [{ x: x + this.offset.x, y: y + this.offset.y }];
    this.subpaths.push(this.current);
  }

  lineTo(x: number, y: number): void {
    if (!this.current) {
      this.moveTo(x, y);
      return;
    }
    this.current.push({ x: x + this.offset.x, y: y + this.offset.y });
  }

  closePath(): void {
    if (this.current && this.current.length > 0) {
      const start = this.current[0];
      this.moveTo(start.x - this.offset.x, start.y - this.offset.y);
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
    // A transparent fill paints nothing.
    const rgb = parseColor(this.fillStyle);
    if (rgb === null) return;
    const edges: Edge[] = [];
    for (const sp of this.subpaths) {
      for (let i = 0; i < sp.length; i++) {
        const a = sp[i];
        const b = sp[(i + 1) % sp.length];
        if (a.y !== b.y) edges.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
      }
    }
    const op: FillOp = { edges, rgb, evenOdd: rule === 'evenodd' };
    this.fills.push(op);
    this.rasterize(op);
  }

  /** The current point, in user (translated) coordinates. */
  private lastPoint(): Point | null {
    if (!this.current || this.current.length === 0) return null;
    const last = this.current[this.current.length - 1];
    return { x: last.x - this.offset.x, y: last.y - this.offset.y };
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

  save(): void {
    this.offsets.push({ ...this.offset });
  }

  restore(): void {
    this.offset = this.offsets.pop() ?? { x: 0, y: 0 };
  }

  translate(x: number, y: number): void {
    this.offset = { x: this.offset.x + x, y: this.offset.y + y };
  }

  // Unused state and text calls: kept as no-ops so the renderer runs unchanged.
  // Text is not rasterised, and rotation or scaling only reaches badge text and icons.
  font = '';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  lineCap = 'butt';
  lineJoin = 'miter';
  fillText(): void {}
  measureText(text: string): { width: number } {
    return { width: text.length * 6 };
  }
  rotate(): void {}
  scale(): void {}
  setLineDash(): void {}
  strokeRect(): void {}
  stroke(): void {}
  clip(): void {}
  clearRect(): void {}
  setTransform(): void {}
  resetTransform(): void {}
}

export const toContext = (raster: RasterContext): CanvasRenderingContext2D =>
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

