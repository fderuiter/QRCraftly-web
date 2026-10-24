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
 * Reads the SVG that `generateQRSvg` builds into a flat list of drawing steps in page
 * coordinates (#1359, #1605), so each writer only has to say how to draw a path, a text line or
 * an image. It knows nothing about PostScript or PDF.
 */

import type { GradientStop, Matrix, RgbColor, SceneClip, SceneElement, SceneGradient, ScenePaint, SceneText, SvgScene } from './sceneTypes';
import { apply, BLACK, compose, num, numbers, parseColor, parseTransform } from './svgValues';
import { toLatin1Codes } from './winAnsi';

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

// --- walk --------------------------------------------------------------------------------

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
  const fontAttr = el.getAttribute('font') || '';
  const fontSizeAttr = el.getAttribute('font-size') || '';
  const size = parseFloat(fontSizeAttr || (/([\d.]+)px/.exec(fontAttr)?.[1] ?? ''));
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
    bold: /\bbold\b|\b[6-9]00\b/.test(`${fontAttr} ${weight}`),
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
