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
 * Attribute values the SVG reader understands: colours, transform lists, numbers and the
 * matrix arithmetic that composes them (#1605).
 */

import { normalizeHex } from '@/packages/core/encoding';
import type { Matrix, RgbColor } from './sceneTypes';

export const BLACK: RgbColor = { r: 0, g: 0, b: 0 };

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

const multiply = (p: Matrix, l: Matrix): Matrix => [
  p[0] * l[0] + p[2] * l[1],
  p[1] * l[0] + p[3] * l[1],
  p[0] * l[2] + p[2] * l[3],
  p[1] * l[2] + p[3] * l[3],
  p[0] * l[4] + p[2] * l[5] + p[4],
  p[1] * l[4] + p[3] * l[5] + p[5],
];

export const compose = (parent: Matrix | null, local: Matrix | null): Matrix | null =>
  parent && local ? multiply(parent, local) : parent || local;

export const apply = (m: Matrix | null, x: number, y: number): [number, number] =>
  m ? [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] : [x, y];

/** Scale factor a matrix applies to lengths (geometric mean of its axes). */
export const matrixScale = (m: Matrix | null): number => (m ? Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 1);

export const numbers = (value: string): number[] =>
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

export const num = (el: Element, name: string, fallback = 0): number => {
  const value = parseFloat(el.getAttribute(name) || '');
  return Number.isFinite(value) ? value : fallback;
};
