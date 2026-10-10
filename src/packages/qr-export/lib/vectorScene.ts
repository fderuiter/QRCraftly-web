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
 * The SVG reader shared by the EPS and PDF writers (#1359). It turns the SVG that
 * `generateQRSvg` builds into a flat list of drawing steps in page coordinates, so each
 * writer only has to say how to draw a path, a text line or an image.
 */

import { normalizeHex } from '@/utils/colorUtils';
import { parseSvgPath, type PathCommandVisitor } from './pathParser';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** An affine matrix `[a b c d e f]`, mapping (x, y) to (a·x + c·y + e, b·x + d·y + f). */
export type Matrix = readonly [number, number, number, number, number, number];

export interface GradientStop {
  offset: number;
  color: RgbColor;
}

export interface SceneGradient {
  type: 'linear' | 'radial';
  /** Linear: `[x1 y1 x2 y2]`. Radial: `[fx fy fr cx cy r]` (start circle, end circle). */
  coords: number[];
  /** Stops sorted by offset, running from 0 to 1. */
  stops: GradientStop[];
  /** `gradientTransform`, or null for none. */
  transform: Matrix | null;
}

export type ScenePaint = { color: RgbColor } | { gradient: SceneGradient };

/** A rectangle the drawing is clipped to, as a polygon in page coordinates. */
export type SceneClip = ReadonlyArray<readonly [number, number]>;

interface SceneBase {
  /** Transform from the element's coordinates to the page, or null for none. */
  matrix: Matrix | null;
  clips: SceneClip[];
}

export interface ScenePath extends SceneBase {
  kind: 'path';
  d: string;
  fill: ScenePaint | null;
  evenOdd: boolean;
  stroke: { color: RgbColor; width: number; dash: number[] } | null;
}

export interface SceneText extends SceneBase {
  kind: 'text';
  /** Latin-1 character codes; characters outside Latin-1 are `?`. */
  codes: number[];
  x: number;
  /** The baseline, with `dominant-baseline` already applied. */
  y: number;
  color: RgbColor;
  fontSize: number;
  bold: boolean;
  anchor: 'start' | 'middle' | 'end';
  /** Width the text is squeezed to (`textLength`), or null. */
  textLength: number | null;
}

export interface SceneImage extends SceneBase {
  kind: 'image';
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SceneElement = ScenePath | SceneText | SceneImage;

export interface SvgScene {
  width: number;
  height: number;
  title: string;
  elements: SceneElement[];
}

const BLACK: RgbColor = { r: 0, g: 0, b: 0 };

/**
 * Reads a CSS colour as written by the SVG builder.
 * @param value - `#rgb`, `#rrggbb`, `rgb()`/`rgba()`, `black`, `white`, `none` or `transparent`.
 * @returns The colour with channels in 0..1, or null for no paint.
 */
export function parseColor(value: string | null | undefined): RgbColor | null {
  const color = (value || '').trim().toLowerCase();
  if (!color || color === 'none' || color === 'transparent') return null;
  const hex = normalizeHex(color.length > 7 && color.startsWith('#') ? color.slice(0, 7) : color);
  if (hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255 };
  }
  if (/^rgba?\(/.test(color) && color.endsWith(')')) {
    const [r, g, b, alpha] = color.slice(color.indexOf('(') + 1, -1).split(',').map((part) => Number(part.trim()));
    if (alpha === 0) return null;
    if ([r, g, b].every(Number.isFinite)) return { r: r / 255, g: g / 255, b: b / 255 };
  }
  if (color === 'white') return { r: 1, g: 1, b: 1 };
  return BLACK;
}

/** Formats a number for PostScript and PDF: at most 3 decimals, no exponent. */
export function formatNum(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** `r g b` as three numbers. */
export const formatRgb = (c: RgbColor): string => `${formatNum(c.r)} ${formatNum(c.g)} ${formatNum(c.b)}`;

export const formatMatrix = (m: Matrix): string => m.map(formatNum).join(' ');

const multiply = (p: Matrix, l: Matrix): Matrix => [
  p[0] * l[0] + p[2] * l[1],
  p[1] * l[0] + p[3] * l[1],
  p[0] * l[2] + p[2] * l[3],
  p[1] * l[2] + p[3] * l[3],
  p[0] * l[4] + p[2] * l[5] + p[4],
  p[1] * l[4] + p[3] * l[5] + p[5],
];

const compose = (parent: Matrix | null, local: Matrix | null): Matrix | null =>
  parent && local ? multiply(parent, local) : parent || local;

const apply = (m: Matrix | null, x: number, y: number): [number, number] =>
  m ? [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] : [x, y];

/** Scale factor a matrix applies to lengths (geometric mean of its axes). */
export const matrixScale = (m: Matrix | null): number => (m ? Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 1);

const numbers = (value: string): number[] =>
  value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);

/**
 * Reads an SVG `transform` list (`matrix`, `translate`, `scale`, `rotate`).
 * @returns The combined matrix, or null when there is none.
 */
export function parseTransform(value: string | null): Matrix | null {
  if (!value) return null;
  let result: Matrix | null = null;
  for (const [, name, args] of value.matchAll(/(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g)) {
    const n = numbers(args);
    let m: Matrix | null = null;
    if (name === 'matrix' && n.length === 6) m = [n[0], n[1], n[2], n[3], n[4], n[5]];
    else if (name === 'translate') m = [1, 0, 0, 1, n[0] || 0, n[1] || 0];
    else if (name === 'scale') m = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (name === 'rotate') {
      const a = ((n[0] || 0) * Math.PI) / 180;
      const [cx, cy] = [n[1] || 0, n[2] || 0];
      m = multiply([1, 0, 0, 1, cx, cy], multiply([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0], [1, 0, 0, 1, -cx, -cy]));
    }
    if (m && m.every(Number.isFinite)) result = compose(result, m);
  }
  return result;
}

const num = (el: Element, name: string, fallback = 0): number => {
  const value = parseFloat(el.getAttribute(name) || '');
  return Number.isFinite(value) ? value : fallback;
};

/** Pads stops to run from 0 to 1, so every writer can build one function over [0 1]. */
function normalizeStops(stops: GradientStop[]): GradientStop[] {
  const sorted = stops
    .map((stop) => ({ ...stop, offset: Math.min(1, Math.max(0, stop.offset)) }))
    .sort((a, b) => a.offset - b.offset);
  if (sorted.length === 0) return sorted;
  if (sorted[0].offset > 0) sorted.unshift({ offset: 0, color: sorted[0].color });
  const last = sorted[sorted.length - 1];
  if (last.offset < 1) sorted.push({ offset: 1, color: last.color });
  return sorted;
}

function readGradients(doc: Document): Map<string, SceneGradient> {
  const gradients = new Map<string, SceneGradient>();
  doc.querySelectorAll('linearGradient, radialGradient').forEach((grad) => {
    const id = grad.getAttribute('id');
    if (!id) return;
    const stops = normalizeStops(
      Array.from(grad.querySelectorAll('stop')).map((stop) => {
        const offset = stop.getAttribute('offset') || '0';
        return {
          offset: offset.trim().endsWith('%') ? parseFloat(offset) / 100 : parseFloat(offset) || 0,
          color: parseColor(stop.getAttribute('stop-color') || '#000000') || BLACK,
        };
      })
    );
    const transform = parseTransform(grad.getAttribute('gradientTransform'));
    if (grad.tagName === 'linearGradient') {
      const coords = [num(grad, 'x1'), num(grad, 'y1'), num(grad, 'x2'), num(grad, 'y2')];
      gradients.set(id, { type: 'linear', coords, stops, transform });
    } else {
      const cx = num(grad, 'cx');
      const cy = num(grad, 'cy');
      const coords = [num(grad, 'fx', cx), num(grad, 'fy', cy), num(grad, 'fr'), cx, cy, num(grad, 'r')];
      gradients.set(id, { type: 'radial', coords, stops, transform });
    }
  });
  return gradients;
}

function readPaint(value: string | null, gradients: Map<string, SceneGradient>): ScenePaint | null {
  const ref = /^url\(\s*#([^)\s]+)\s*\)/.exec((value || '').trim());
  if (!ref) {
    const color = parseColor(value);
    return color ? { color } : null;
  }
  const gradient = gradients.get(ref[1]);
  if (!gradient || gradient.stops.length === 0) return { color: BLACK };
  const [first] = gradient.stops;
  const same = (c: RgbColor) => c.r === first.color.r && c.g === first.color.g && c.b === first.color.b;
  if (gradient.stops.every((stop) => same(stop.color))) return { color: first.color };
  return { gradient };
}

// --- text --------------------------------------------------------------------------------

/** Helvetica advance widths (1/1000 em) for codes 32..126, from the Adobe core font metrics. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Helvetica-Bold advance widths (1/1000 em) for codes 32..126. */
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Helvetica ascender, descender and the em-box middle, in em (Adobe core font metrics). */
const ASCENDER = 0.718;
const DESCENDER = -0.207;

/** How far below the SVG `y` the baseline sits for each `dominant-baseline`, in em. */
const BASELINE_SHIFT: Record<string, number> = {
  middle: (ASCENDER + DESCENDER) / 2,
  central: (ASCENDER + DESCENDER) / 2,
  hanging: ASCENDER,
  'text-before-edge': ASCENDER,
  ideographic: DESCENDER,
  'text-after-edge': DESCENDER,
};

/**
 * Converts text to Latin-1 codes, the encoding both writers select for Helvetica
 * (`ISOLatin1Encoding` in EPS, `WinAnsiEncoding` in PDF, which agree on these codes).
 * @param text - Text to encode.
 * @returns One code per character; characters outside Latin-1 become `?`.
 */
export function toLatin1Codes(text: string): number[] {
  return Array.from(text, (ch) => {
    const code = ch.codePointAt(0) ?? 63;
    return code >= 32 && code <= 126 ? code : code >= 0xa0 && code <= 0xff ? code : 63;
  });
}

const widthOf = (code: number, bold: boolean): number => {
  const table = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  if (code >= 32 && code <= 126) return table[code - 32];
  // Accented letters take the width of their base letter.
  const base = String.fromCharCode(code).normalize('NFD').charCodeAt(0);
  return base >= 32 && base <= 126 ? table[base - 32] : 556;
};

/** Width of Latin-1 text set in Helvetica at `fontSize`. */
export const textWidth = (codes: readonly number[], fontSize: number, bold: boolean): number =>
  (codes.reduce((sum, code) => sum + widthOf(code, bold), 0) * fontSize) / 1000;

/** Writes Latin-1 codes as a PostScript/PDF literal string, escaping everything outside printable ASCII. */
export function literalString(codes: readonly number[]): string {
  const body = codes
    .map((code) => {
      if (code === 40 || code === 41 || code === 92) return `\\${String.fromCharCode(code)}`;
      if (code >= 32 && code <= 126) return String.fromCharCode(code);
      return `\\${code.toString(8).padStart(3, '0')}`;
    })
    .join('');
  return `(${body})`;
}

// --- shading -----------------------------------------------------------------------------

const exponential = (c0: RgbColor, c1: RgbColor): string =>
  `<< /FunctionType 2 /Domain [0 1] /C0 [${formatRgb(c0)}] /C1 [${formatRgb(c1)}] /N 1 >>`;

/**
 * Builds the shading dictionary for a gradient. PostScript (LanguageLevel 3) and PDF use
 * the same syntax: an axial or radial shading over a stitching function with one segment per
 * pair of stops.
 */
export function shadingDictionary(gradient: SceneGradient): string {
  const { stops } = gradient;
  let fn: string;
  if (stops.length <= 2) {
    fn = exponential(stops[0].color, stops[stops.length - 1].color);
  } else {
    const segments = stops.slice(1).map((stop, i) => exponential(stops[i].color, stop.color));
    const bounds = stops.slice(1, -1).map((stop) => formatNum(stop.offset));
    const encode = segments.map(() => '0 1').join(' ');
    fn = `<< /FunctionType 3 /Domain [0 1] /Functions [${segments.join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${encode}] >>`;
  }
  const type = gradient.type === 'linear' ? 2 : 3;
  return `<< /ShadingType ${type} /ColorSpace /DeviceRGB /Coords [${gradient.coords.map(formatNum).join(' ')}] /Function ${fn} /Extend [true true] >>`;
}

// --- paths -------------------------------------------------------------------------------

/**
 * Writes an SVG path with a writer's operators.
 * @param d - SVG path data.
 * @param ops - Operator names for move, line, curve and close.
 */
export function pathOperators(d: string, ops: { move: string; line: string; curve: string; close: string }): string {
  const out: string[] = [];
  const visitor: PathCommandVisitor = {
    moveTo: (x, y) => out.push(`${formatNum(x)} ${formatNum(y)} ${ops.move}`),
    lineTo: (x, y) => out.push(`${formatNum(x)} ${formatNum(y)} ${ops.line}`),
    curveTo: (a, b, c, d2, x, y) => out.push(`${[a, b, c, d2, x, y].map(formatNum).join(' ')} ${ops.curve}`),
    closePath: () => out.push(ops.close),
  };
  parseSvgPath(d, visitor);
  return out.join('\n');
}

// --- reader ------------------------------------------------------------------------------

interface WalkState {
  matrix: Matrix | null;
  clips: SceneClip[];
}

function clipRect(state: WalkState, x: number, y: number, w: number, h: number): SceneClip {
  return [apply(state.matrix, x, y), apply(state.matrix, x + w, y), apply(state.matrix, x + w, y + h), apply(state.matrix, x, y + h)];
}

function readText(el: Element, state: WalkState): SceneText | null {
  const content = el.textContent || '';
  if (!content) return null;
  const font = el.getAttribute('font') || '';
  const size = parseFloat(/([\d.]+)px/.exec(font)?.[1] ?? el.getAttribute('font-size') ?? '');
  const fontSize = size > 0 ? size : 16;
  const weight = el.getAttribute('font-weight') || '';
  const anchorAttr = el.getAttribute('text-anchor');
  const textLength = parseFloat(el.getAttribute('textLength') || '');
  return {
    kind: 'text',
    codes: toLatin1Codes(content),
    x: num(el, 'x'),
    y: num(el, 'y') + (BASELINE_SHIFT[el.getAttribute('dominant-baseline') || ''] || 0) * fontSize,
    color: parseColor(el.getAttribute('fill') || '#000000') || BLACK,
    fontSize,
    bold: /\bbold\b|\b[6-9]00\b/.test(`${font} ${weight}`),
    anchor: anchorAttr === 'middle' || anchorAttr === 'end' ? anchorAttr : 'start',
    textLength: textLength > 0 ? textLength : null,
    matrix: state.matrix,
    clips: state.clips,
  };
}

function walk(el: Element, state: WalkState, gradients: Map<string, SceneGradient>, out: SceneElement[]): void {
  const tag = el.tagName;
  if (tag === 'defs' || tag === 'title' || tag === 'desc' || tag === 'linearGradient' || tag === 'radialGradient') return;

  const local: WalkState = { matrix: compose(state.matrix, parseTransform(el.getAttribute('transform'))), clips: state.clips };

  if (tag === 'path') {
    const d = el.getAttribute('d');
    if (!d) return;
    const stroke = parseColor(el.getAttribute('stroke'));
    out.push({
      kind: 'path',
      d,
      // SVG paints a path black when it names no fill.
      fill: readPaint(el.getAttribute('fill') ?? '#000000', gradients),
      evenOdd: el.getAttribute('fill-rule') === 'evenodd',
      stroke: stroke
        ? { color: stroke, width: num(el, 'stroke-width', 1), dash: numbers(el.getAttribute('stroke-dasharray') || '').filter(Number.isFinite) }
        : null,
      ...local,
    });
    return;
  }
  if (tag === 'text') {
    const text = readText(el, local);
    if (text) out.push(text);
    return;
  }
  if (tag === 'image') {
    const href = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
    const width = num(el, 'width');
    const height = num(el, 'height');
    if (href && width > 0 && height > 0) {
      out.push({ kind: 'image', href, x: num(el, 'x'), y: num(el, 'y'), width, height, ...local });
    }
    return;
  }

  let inner = local;
  if (tag === 'svg' && el.parentElement) {
    // A nested <svg> crops its content to its box and maps its viewBox onto it.
    const x = num(el, 'x');
    const y = num(el, 'y');
    const w = num(el, 'width');
    const h = num(el, 'height');
    const box = numbers(el.getAttribute('viewBox') || '');
    let matrix = compose(local.matrix, [1, 0, 0, 1, x, y]);
    if (box.length === 4 && box[2] > 0 && box[3] > 0) {
      matrix = compose(matrix, [w / box[2], 0, 0, h / box[3], (-box[0] * w) / box[2], (-box[1] * h) / box[3]]);
    }
    inner = { matrix, clips: [...local.clips, clipRect(local, x, y, w, h)] };
  }
  for (const child of Array.from(el.children)) walk(child, inner, gradients, out);
}

/**
 * Reads an SVG document into drawing steps.
 * @param svg - SVG markup.
 * @returns The page size, title and drawing steps in document order.
 * @throws When no DOMParser is available or the markup is not SVG.
 */
export function readSvgScene(svg: string): SvgScene {
  if (typeof DOMParser === 'undefined') throw new Error('Vector export needs a browser DOMParser.');
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.querySelector('svg');
  if (!root) throw new Error('The vector export could not read the SVG.');

  let width = num(root, 'width');
  let height = num(root, 'height');
  const box = numbers(root.getAttribute('viewBox') || '');
  if ((!width || !height) && box.length === 4) {
    width = box[2];
    height = box[3];
  }
  width = width || 1080;
  height = height || 1080;

  const elements: SceneElement[] = [];
  const gradients = readGradients(doc);
  // The root's viewBox maps onto its width and height.
  const rootMatrix: Matrix | null =
    box.length === 4 && box[2] > 0 && box[3] > 0 && (box[0] !== 0 || box[1] !== 0 || box[2] !== width || box[3] !== height)
      ? [width / box[2], 0, 0, height / box[3], (-box[0] * width) / box[2], (-box[1] * height) / box[3]]
      : null;
  for (const child of Array.from(root.children)) walk(child, { matrix: rootMatrix, clips: [] }, gradients, elements);

  const title = root.querySelector('title')?.textContent?.trim() || 'QR Code';
  return { width, height, title, elements };
}
