/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { clampCornerRadius } from '@/packages/qr-matrix/canvas';

/**
 * A 2D affine transformation matrix in column-major form:
 *   | a  c  e |
 *   | b  d  f |
 *   | 0  0  1 |
 */
interface Matrix {
  a: number; b: number;
  c: number; d: number;
  e: number; f: number;
}

function identityMatrix(): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function isMatrixIdentity(m: Matrix): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

function formatGradientStops(stops: Array<{ offset: number; color: string }>): string {
  return stops
    .map((stop) => `      <stop offset="${stop.offset * 100}%" stop-color="${stop.color}" />`)
    .join('\n');
}

function getGradientTransformAttr(t: Matrix): string {
  return isMatrixIdentity(t) ? '' : ` gradientTransform="matrix(${t.a} ${t.b} ${t.c} ${t.d} ${t.e} ${t.f})"`;
}

function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

class SvgRadialGradient {
  public id: string;
  public x0: number;
  public y0: number;
  public r0: number;
  public x1: number;
  public y1: number;
  public r1: number;
  public transform: Matrix;
  public stops: Array<{ offset: number; color: string }> = [];

  constructor(id: string, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, transform: Matrix) {
    this.id = id;
    this.x0 = x0;
    this.y0 = y0;
    this.r0 = r0;
    this.x1 = x1;
    this.y1 = y1;
    this.r1 = r1;
    this.transform = transform;
  }

  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }

  toSvgString(): string {
    const stopsXml = formatGradientStops(this.stops);
    const transformAttr = getGradientTransformAttr(this.transform);
    const frAttr = this.r0 > 0 ? ` fr="${this.r0}"` : '';

    return [
      `    <radialGradient id="${this.id}" cx="${this.x1}" cy="${this.y1}" r="${this.r1}" fx="${this.x0}" fy="${this.y0}"${frAttr} gradientUnits="userSpaceOnUse"${transformAttr}>`,
      stopsXml,
      `    </radialGradient>`
    ].join('\n');
  }
}

class SvgLinearGradient {
  public id: string;
  public x0: number;
  public y0: number;
  public x1: number;
  public y1: number;
  public transform: Matrix;
  public stops: Array<{ offset: number; color: string }> = [];

  constructor(id: string, x0: number, y0: number, x1: number, y1: number, transform: Matrix) {
    this.id = id;
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
    this.transform = transform;
  }

  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }

  toSvgString(): string {
    const stopsXml = formatGradientStops(this.stops);
    const transformAttr = getGradientTransformAttr(this.transform);

    return [
      `    <linearGradient id="${this.id}" x1="${this.x0}" y1="${this.y0}" x2="${this.x1}" y2="${this.y1}" gradientUnits="userSpaceOnUse"${transformAttr}>`,
      stopsXml,
      `    </linearGradient>`
    ].join('\n');
  }
}

interface ContextState {
  transform: Matrix;
  fillStyle: string | SvgRadialGradient | SvgLinearGradient;
  strokeStyle: string | SvgRadialGradient | SvgLinearGradient;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  dashArray: number[];
}

let cachedCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
function getMeasuringContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (cachedCtx) return cachedCtx;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(1, 1);
      cachedCtx = canvas.getContext('2d');
      if (cachedCtx) return cachedCtx;
    }
  } catch (_e) {
    // Ignore error
  }
  try {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const canvas = document.createElement('canvas');
      cachedCtx = canvas.getContext('2d');
      if (cachedCtx) return cachedCtx;
    }
  } catch (_e) {
    // Ignore error
  }
  return null;
}

/**
 * A virtual 2D drawing context that captures canvas draw calls and produces
 * equivalent SVG XML. It implements the subset of CanvasRenderingContext2D
 * methods actually used by the QR rendering pipeline.
 *
 * Usage:
 *   const ctx = new SvgContext(1024, 1024);
 *   drawQRInternal(ctx as unknown as CanvasRenderingContext2D, ...);
 *   const svgString = ctx.serialize();
 */
export class SvgContext {
  // Public style properties (mirrors CanvasRenderingContext2D)
  fillStyle: string | SvgRadialGradient | SvgLinearGradient = '#000000';
  strokeStyle: string | SvgRadialGradient | SvgLinearGradient = '#000000';
  lineWidth: number = 1;
  font: string = '10px sans-serif';
  textAlign: string = 'start';
  textBaseline: string = 'alphabetic';

  public title?: string;
  public description?: string;

  // Mock canvas property for compatibility with drawQR signature
  readonly canvas: { width: number; height: number };

  private readonly _width: number;
  private readonly _height: number;
  private _elements: string[] = [];
  private _pathData: string = '';
  private _transform: Matrix = identityMatrix();
  private _stateStack: ContextState[] = [];
  private _dashArray: number[] = [];
  private _gradients: Array<SvgRadialGradient | SvgLinearGradient> = [];
  private _radialGradientCount = 0;
  private _linearGradientCount = 0;

  constructor(width: number, height: number, title?: string, description?: string) {
    this._width = width;
    this._height = height;
    this.canvas = { width, height };
    this.title = title;
    this.description = description;
  }

  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): SvgRadialGradient {
    this._radialGradientCount++;
    const id = `radial-grad-${this._radialGradientCount}`;
    const grad = new SvgRadialGradient(id, x0, y0, r0, x1, y1, r1, { ...this._transform });
    this._gradients.push(grad);
    return grad;
  }

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SvgLinearGradient {
    this._linearGradientCount++;
    const id = `linear-grad-${this._linearGradientCount}`;
    const grad = new SvgLinearGradient(id, x0, y0, x1, y1, { ...this._transform });
    this._gradients.push(grad);
    return grad;
  }

  // ── Transform helpers ──────────────────────────────────────────────────────

  private _applyTransform(x: number, y: number): [number, number] {
    const m = this._transform;
    return [
      m.a * x + m.c * y + m.e,
      m.b * x + m.d * y + m.f,
    ];
  }

  /** Returns a formatted number with up to 3 decimal places, no trailing zeros. */
  private _n(v: number): string {
    return parseFloat(v.toFixed(3)).toString();
  }

  private _pt(x: number, y: number): string {
    const [tx, ty] = this._applyTransform(x, y);
    return `${this._n(tx)} ${this._n(ty)}`;
  }

  // ── State management ───────────────────────────────────────────────────────

  save(): void {
    this._stateStack.push({
      transform: { ...this._transform },
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      dashArray: [...this._dashArray],
    });
  }

  restore(): void {
    const state = this._stateStack.pop();
    if (state) {
      this._transform = state.transform;
      this.fillStyle = state.fillStyle;
      this.strokeStyle = state.strokeStyle;
      this.lineWidth = state.lineWidth;
      this.font = state.font;
      this.textAlign = state.textAlign;
      this.textBaseline = state.textBaseline;
      this._dashArray = state.dashArray;
    }
  }

  scale(sx: number, sy: number): void {
    this._transform = multiplyMatrix(this._transform, {
      a: sx, b: 0, c: 0, d: sy, e: 0, f: 0,
    });
  }

  translate(tx: number, ty: number): void {
    this._transform = multiplyMatrix(this._transform, {
      a: 1, b: 0, c: 0, d: 1, e: tx, f: ty,
    });
  }

  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this._transform = multiplyMatrix(this._transform, {
      a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0,
    });
  }

  // ── Path API ───────────────────────────────────────────────────────────────

  beginPath(): void {
    this._pathData = '';
  }

  closePath(): void {
    this._pathData += 'Z ';
  }

  moveTo(x: number, y: number): void {
    this._pathData += `M ${this._pt(x, y)} `;
  }

  lineTo(x: number, y: number): void {
    this._pathData += `L ${this._pt(x, y)} `;
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this._pathData += `Q ${this._pt(cpx, cpy)} ${this._pt(x, y)} `;
  }

  /**
   * Adds a rectangular sub-path to the current path (with transform applied).
   * The four corners are transformed individually so rotated rects are handled correctly.
   */
  rect(x: number, y: number, w: number, h: number): void {
    this._pathData += `M ${this._pt(x, y)} `;
    this._pathData += `L ${this._pt(x + w, y)} `;
    this._pathData += `L ${this._pt(x + w, y + h)} `;
    this._pathData += `L ${this._pt(x, y + h)} Z `;
  }

  /**
   * Adds a rounded rectangle sub-path using quadratic Bézier curves.
   * Applies the current transform to all corner and control points.
   * Note: The `radii` parameter is treated as a uniform radius (single number).
   */
  roundRect(x: number, y: number, w: number, h: number, r: number): void {
    // Clamp radius so it doesn't exceed half the shorter side and is not negative
    const safeR = clampCornerRadius(r, w, h);

    this._pathData += `M ${this._pt(x + safeR, y)} `;
    this._pathData += `L ${this._pt(x + w - safeR, y)} `;
    this._pathData += `Q ${this._pt(x + w, y)} ${this._pt(x + w, y + safeR)} `;
    this._pathData += `L ${this._pt(x + w, y + h - safeR)} `;
    this._pathData += `Q ${this._pt(x + w, y + h)} ${this._pt(x + w - safeR, y + h)} `;
    this._pathData += `L ${this._pt(x + safeR, y + h)} `;
    this._pathData += `Q ${this._pt(x, y + h)} ${this._pt(x, y + h - safeR)} `;
    this._pathData += `L ${this._pt(x, y + safeR)} `;
    this._pathData += `Q ${this._pt(x, y)} ${this._pt(x + safeR, y)} Z `;
  }

  /**
   * Adds an arc/circle sub-path to the current path.
   * Converts curved arcs into transformed cubic Bezier curves using the active
   * transformation matrix to preserve rotation and non-uniform scaling.
   */
  arc(cx: number, cy: number, r: number, startAngle: number, endAngle: number, anticlockwise: boolean = false): void {
    // Standardize sweep angle calculation
    let sweep = endAngle - startAngle;
    if (anticlockwise) {
      if (sweep > 0) {
        sweep = sweep - Math.PI * 2;
      } else if (sweep === 0) {
        return;
      }
    } else {
      if (sweep < 0) {
        sweep = sweep + Math.PI * 2;
      } else if (sweep === 0) {
        return;
      }
    }

    // If sweep is extremely large, cap it at 2 * PI
    const totalSweep = Math.min(Math.PI * 2, Math.abs(sweep));
    const signedSweep = anticlockwise ? -totalSweep : totalSweep;

    const maxSegmentAngle = Math.PI / 2; // 90 degrees
    const numSegments = Math.max(1, Math.ceil(totalSweep / maxSegmentAngle));
    const segmentSweep = signedSweep / numSegments;

    // Draw the segments
    for (let i = 0; i < numSegments; i++) {
      const a1 = startAngle + i * segmentSweep;
      const a2 = a1 + segmentSweep;

      const p0x = cx + r * Math.cos(a1);
      const p0y = cy + r * Math.sin(a1);
      const p3x = cx + r * Math.cos(a2);
      const p3y = cy + r * Math.sin(a2);

      const k = (4 / 3) * Math.tan((a2 - a1) / 4);

      const p1x = p0x - k * r * Math.sin(a1);
      const p1y = p0y + k * r * Math.cos(a1);
      const p2x = p3x + k * r * Math.sin(a2);
      const p2y = p3y - k * r * Math.cos(a2);

      if (i === 0) {
        // First segment start point
        const isNewSubpath = !this._pathData.trim() || this._pathData.trim().endsWith('Z');
        if (isNewSubpath) {
          this._pathData += `M ${this._pt(p0x, p0y)} `;
        } else {
          this._pathData += `L ${this._pt(p0x, p0y)} `;
        }
      }

      // Add the cubic Bezier curve to the path
      this._pathData += `C ${this._pt(p1x, p1y)}, ${this._pt(p2x, p2y)}, ${this._pt(p3x, p3y)} `;
    }
  }

  // ── Immediate draw calls ───────────────────────────────────────────────────

  fill(): void {
    if (!this._pathData.trim()) return;
    const fill = this._cssColor(this.fillStyle);
    this._elements.push(`<path d="${this._pathData.trim()}" fill="${fill}" fill-rule="evenodd"/>`);
  }

  stroke(): void {
    if (!this._pathData.trim()) return;
    const stroke = this._cssColor(this.strokeStyle);
    const dash = this._dashArray.length > 0
      ? ` stroke-dasharray="${this._dashArray.join(' ')}"`
      : '';
    this._elements.push(
      `<path d="${this._pathData.trim()}" fill="none" stroke="${stroke}" stroke-width="${this._n(this.lineWidth)}"${dash}/>`
    );
  }

  /** Fills a rectangle directly (without modifying the current path). */
  fillRect(x: number, y: number, w: number, h: number): void {
    const fill = this._cssColor(this.fillStyle);
    const d = `M ${this._pt(x, y)} L ${this._pt(x + w, y)} L ${this._pt(x + w, y + h)} L ${this._pt(x, y + h)} Z`;
    this._elements.push(`<path d="${d}" fill="${fill}"/>`);
  }

  /**
   * Strokes a rectangle directly.
   * Supports the dashed/dotted border styles used in the QR border renderer.
   */
  strokeRect(x: number, y: number, w: number, h: number): void {
    const stroke = this._cssColor(this.strokeStyle);
    const dash = this._dashArray.length > 0
      ? ` stroke-dasharray="${this._dashArray.join(' ')}"`
      : '';
    const d = `M ${this._pt(x, y)} L ${this._pt(x + w, y)} L ${this._pt(x + w, y + h)} L ${this._pt(x, y + h)} Z`;
    this._elements.push(
      `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${this._n(this.lineWidth)}"${dash}/>`
    );
  }

  /**
   * No-op: In the QR renderer, clearRect is always followed by a fillRect with
   * the background colour, so the area will be properly painted over.
   */
  clearRect(_x: number, _y: number, _w: number, _h: number): void {
    // Intentional no-op for SVG export (see comment above)
  }

  /** Renders text as an SVG <text> element. */
  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    const fill = this._cssColor(this.fillStyle);
    const [tx, ty] = this._applyTransform(x, y);
    const anchor = this._svgTextAnchor(this.textAlign);
    const baseline = this._svgDominantBaseline(this.textBaseline);

    let textLengthAttr = '';
    if (maxWidth !== undefined && maxWidth > 0) {
      let actualWidth: number | null = null;
      try {
        const measuringCtx = getMeasuringContext();
        if (measuringCtx && typeof measuringCtx.measureText === 'function') {
          measuringCtx.font = this.font;
          const metrics = measuringCtx.measureText(text);
          if (metrics && typeof metrics.width === 'number') {
            actualWidth = metrics.width;
          }
        }
      } catch (_e) {
        // Fallback on error
      }

      // Safe font-size extraction and scaling fallback
      const match = this.font.match(/(\d+)px/);
      const fontSize = match ? parseInt(match[1], 10) : 16;
      const estimatedWidth = text.length * fontSize * 0.55;

      const measuredWidth = (actualWidth !== null && actualWidth > 0) ? actualWidth : estimatedWidth;

      if (measuredWidth > maxWidth) {
        textLengthAttr = ` textLength="${this._n(maxWidth)}" lengthAdjust="spacingAndGlyphs"`;
      }
    }

    this._elements.push(
      `<text x="${this._n(tx)}" y="${this._n(ty)}" fill="${fill}" font="${this._escapeAttr(this.font)}" text-anchor="${anchor}" dominant-baseline="${baseline}"${textLengthAttr}>${this._escapeText(text)}</text>`
    );
  }

  private _getTransformAttr(): string {
    const t = this._transform;
    return isMatrixIdentity(t) ? '' : ` transform="matrix(${this._n(t.a)} ${this._n(t.b)} ${this._n(t.c)} ${this._n(t.d)} ${this._n(t.e)} ${this._n(t.f)})"`;
  }

  /**
   * Draws an image into the SVG as a base64-encoded <image> element.
   * Supports standard 3-parameter, 5-parameter, and 9-parameter image drawing operations
   * and applies matrix transformations directly to preserve rotation, skew, and scaling.
   */
  drawImage(
    image: HTMLImageElement | { src: string; width?: number; height?: number; naturalWidth?: number; naturalHeight?: number },
    ...args: number[]
  ): void {
    const href = image.src ?? '';
    if (!href) return;

    let dx = 0;
    let dy = 0;
    let dw = 0;
    let dh = 0;

    let sx = 0;
    let sy = 0;
    let sw = 0;
    let sh = 0;
    let isSubImage = false;

    if (args.length === 2) {
      // 3-parameter: drawImage(image, dx, dy)
      dx = args[0];
      dy = args[1];
      dw = image.naturalWidth || image.width || 0;
      dh = image.naturalHeight || image.height || 0;
    } else if (args.length === 4) {
      // 5-parameter: drawImage(image, dx, dy, dw, dh)
      dx = args[0];
      dy = args[1];
      dw = args[2];
      dh = args[3];
    } else if (args.length === 8) {
      // 9-parameter: drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
      sx = args[0];
      sy = args[1];
      sw = args[2];
      sh = args[3];
      dx = args[4];
      dy = args[5];
      dw = args[6];
      dh = args[7];
      isSubImage = true;
    } else {
      return;
    }

    const tAttr = this._getTransformAttr();

    if (isSubImage) {
      const imgWidth = image.naturalWidth || image.width || sw;
      const imgHeight = image.naturalHeight || image.height || sh;

      if (tAttr) {
        this._elements.push(
          `<g${tAttr}>`,
          `  <svg x="${this._n(dx)}" y="${this._n(dy)}" width="${this._n(dw)}" height="${this._n(dh)}" viewBox="${this._n(sx)} ${this._n(sy)} ${this._n(sw)} ${this._n(sh)}" preserveAspectRatio="none">`,
          `    <image href="${this._escapeAttr(href)}" x="0" y="0" width="${this._n(imgWidth)}" height="${this._n(imgHeight)}" preserveAspectRatio="none"/>`,
          `  </svg>`,
          `</g>`
        );
      } else {
        this._elements.push(
          `<svg x="${this._n(dx)}" y="${this._n(dy)}" width="${this._n(dw)}" height="${this._n(dh)}" viewBox="${this._n(sx)} ${this._n(sy)} ${this._n(sw)} ${this._n(sh)}" preserveAspectRatio="none">`,
          `  <image href="${this._escapeAttr(href)}" x="0" y="0" width="${this._n(imgWidth)}" height="${this._n(imgHeight)}" preserveAspectRatio="none"/>`,
          `</svg>`
        );
      }
    } else {
      this._elements.push(
        `<image href="${this._escapeAttr(href)}" x="${this._n(dx)}" y="${this._n(dy)}" width="${this._n(dw)}" height="${this._n(dh)}" preserveAspectRatio="none"${tAttr}/>`
      );
    }
  }

  setLineDash(segments: number[]): void {
    this._dashArray = [...segments];
  }

  // ── SVG serialization ──────────────────────────────────────────────────────

  /**
   * Returns the complete SVG document as a string.
   */
  serialize(): string {
    const titleTag = this.title ? `  <title>${this._escapeText(this.title)}</title>` : '';
    const descTag = this.description ? `  <desc>${this._escapeText(this.description)}</desc>` : '';

    const defs = this._gradients.length > 0
      ? [
          `  <defs>`,
          ...this._gradients.map(g => g.toSvgString()),
          `  </defs>`
        ]
      : [];

    const lines = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
      `     width="${this._width}" height="${this._height}"`,
      `     viewBox="0 0 ${this._width} ${this._height}">`,
    ];

    if (titleTag) {
      lines.push(titleTag);
    }
    if (descTag) {
      lines.push(descTag);
    }

    lines.push(...defs);
    lines.push(...this._elements);
    lines.push(`</svg>`);

    return lines.join('\n');
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _cssColor(color: string | SvgRadialGradient | SvgLinearGradient): string {
    if (color instanceof SvgRadialGradient || color instanceof SvgLinearGradient) {
      return `url(#${color.id})`;
    }
    return color || 'none';
  }

  private _svgTextAnchor(align: string): string {
    switch (align) {
      case 'center': return 'middle';
      case 'right': case 'end': return 'end';
      default: return 'start';
    }
  }

  private _svgDominantBaseline(baseline: string): string {
    switch (baseline) {
      case 'middle': return 'middle';
      case 'top': case 'hanging': return 'hanging';
      case 'bottom': case 'ideographic': return 'ideographic';
      default: return 'auto';
    }
  }

  private _escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private _escapeText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
