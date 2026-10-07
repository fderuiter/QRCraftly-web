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

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface ParsedSvgDocument {
  width: number;
  height: number;
  title: string;
}

export interface SvgGradientInfo {
  type: 'linear' | 'radial';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: Array<{ offset: number; color: RgbColor }>;
}

export type PathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; cp1x: number; cp1y: number; cp2x: number; cp2y: number; x: number; y: number }
  | { type: 'Z' };

/**
 * Parses CSS color strings into RGB color objects normalized to 0..1 range.
 */
export function parseColor(colorStr: string): RgbColor | null {
  if (!colorStr || colorStr === 'none' || colorStr === 'transparent') {
    return null;
  }
  let c = colorStr.trim().toLowerCase();

  // Hex format #rgb or #rrggbb
  if (c.startsWith('#')) {
    c = c.substring(1);
    if (c.length === 3) {
      const r = parseInt(c[0] + c[0], 16) / 255;
      const g = parseInt(c[1] + c[1], 16) / 255;
      const b = parseInt(c[2] + c[2], 16) / 255;
      return { r, g, b };
    }
    if (c.length >= 6) {
      const r = parseInt(c.substring(0, 2), 16) / 255;
      const g = parseInt(c.substring(2, 4), 16) / 255;
      const b = parseInt(c.substring(4, 6), 16) / 255;
      return { r, g, b };
    }
  }

  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10) / 255,
      g: parseInt(rgbMatch[2], 10) / 255,
      b: parseInt(rgbMatch[3], 10) / 255,
    };
  }

  // Named colors
  if (c === 'black') return { r: 0, g: 0, b: 0 };
  if (c === 'white') return { r: 1, g: 1, b: 1 };

  return { r: 0, g: 0, b: 0 };
}

/**
 * Formats numbers up to 3 decimal places without trailing zeros.
 */
export function formatNum(n: number): string {
  return parseFloat(n.toFixed(3)).toString();
}

/**
 * Extracts width, height, and title from an SVG document string.
 */
export function parseSvgDocument(svgString: string): ParsedSvgDocument {
  let width = 1080;
  let height = 1080;
  let title = 'QR Code';

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (svgEl) {
      const wAttr = svgEl.getAttribute('width');
      const hAttr = svgEl.getAttribute('height');
      const vbAttr = svgEl.getAttribute('viewBox');

      let parsedW: number | null = wAttr ? parseFloat(wAttr) : null;
      let parsedH: number | null = hAttr ? parseFloat(hAttr) : null;

      if ((!parsedW || !parsedH) && vbAttr) {
        const parts = vbAttr.split(/[\s,]+/).map(parseFloat);
        if (parts.length === 4) {
          if (!parsedW) parsedW = parts[2];
          if (!parsedH) parsedH = parts[3];
        }
      }

      if (parsedW && !isNaN(parsedW)) width = parsedW;
      if (parsedH && !isNaN(parsedH)) height = parsedH;

      const titleEl = doc.querySelector('title');
      if (titleEl && titleEl.textContent) {
        title = titleEl.textContent;
      }
    }
  } else {
    const wMatch = svgString.match(/width="([\d.]+)"/);
    const hMatch = svgString.match(/height="([\d.]+)"/);
    if (wMatch) width = parseFloat(wMatch[1]);
    if (hMatch) height = parseFloat(hMatch[1]);
  }

  return { width, height, title };
}

/**
 * Extracts linear and radial gradient definitions from SVG defs.
 */
export function extractSvgGradients(svgString: string): Map<string, SvgGradientInfo> {
  const gradientMap = new Map<string, SvgGradientInfo>();

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');

    doc.querySelectorAll('linearGradient, radialGradient').forEach((grad) => {
      const id = grad.getAttribute('id');
      if (!id) return;

      const stops: Array<{ offset: number; color: RgbColor }> = [];
      grad.querySelectorAll('stop').forEach((stop) => {
        const offAttr = stop.getAttribute('offset') || '0%';
        const off = offAttr.endsWith('%') ? parseFloat(offAttr) / 100 : parseFloat(offAttr);
        const colAttr = stop.getAttribute('stop-color') || '#000000';
        const color = parseColor(colAttr) || { r: 0, g: 0, b: 0 };
        stops.push({ offset: off, color });
      });

      if (grad.tagName === 'linearGradient') {
        const x1 = parseFloat(grad.getAttribute('x1') || '0');
        const y1 = parseFloat(grad.getAttribute('y1') || '0');
        const x2 = parseFloat(grad.getAttribute('x2') || '100');
        const y2 = parseFloat(grad.getAttribute('y2') || '100');
        gradientMap.set(id, { type: 'linear', x1, y1, x2, y2, stops });
      } else {
        const cx = parseFloat(grad.getAttribute('cx') || '50');
        const cy = parseFloat(grad.getAttribute('cy') || '50');
        const r = parseFloat(grad.getAttribute('r') || '50');
        gradientMap.set(id, { type: 'radial', x1: cx, y1: cy, x2: cx + r, y2: cy, stops });
      }
    });
  }

  return gradientMap;
}

/**
 * Tokenizes and normalizes an SVG path `d` attribute string into absolute path commands.
 * Converts relative commands (m, l, q, c, z) and quadratic Bezier curves (Q/q) to cubic Bezier curves (C).
 */
export function parseSvgPathCommands(d: string): PathCommand[] {
  const commands: PathCommand[] = [];
  const tokens = d.match(/([a-zA-Z]|-?[\d.eE]+)/g) || [];

  let idx = 0;
  let currentCmd = '';
  let curX = 0;
  let curY = 0;

  while (idx < tokens.length) {
    const token = tokens[idx];
    if (/^[a-zA-Z]$/.test(token)) {
      currentCmd = token;
      idx++;
    }

    if (currentCmd === 'M' || currentCmd === 'm') {
      const x = parseFloat(tokens[idx++]);
      const y = parseFloat(tokens[idx++]);
      curX = currentCmd === 'm' ? curX + x : x;
      curY = currentCmd === 'm' ? curY + y : y;
      commands.push({ type: 'M', x: curX, y: curY });
      currentCmd = currentCmd === 'M' ? 'L' : 'l'; // Subsequent coordinate pairs are implicit lineTos
    } else if (currentCmd === 'L' || currentCmd === 'l') {
      const x = parseFloat(tokens[idx++]);
      const y = parseFloat(tokens[idx++]);
      curX = currentCmd === 'l' ? curX + x : x;
      curY = currentCmd === 'l' ? curY + y : y;
      commands.push({ type: 'L', x: curX, y: curY });
    } else if (currentCmd === 'Q' || currentCmd === 'q') {
      const cpxRel = parseFloat(tokens[idx++]);
      const cpyRel = parseFloat(tokens[idx++]);
      const xRel = parseFloat(tokens[idx++]);
      const yRel = parseFloat(tokens[idx++]);

      const cpx = currentCmd === 'q' ? curX + cpxRel : cpxRel;
      const cpy = currentCmd === 'q' ? curY + cpyRel : cpyRel;
      const x = currentCmd === 'q' ? curX + xRel : xRel;
      const y = currentCmd === 'q' ? curY + yRel : yRel;

      // Convert quadratic Bezier to cubic Bezier
      const cp1x = curX + (2 / 3) * (cpx - curX);
      const cp1y = curY + (2 / 3) * (cpy - curY);
      const cp2x = x + (2 / 3) * (cpx - x);
      const cp2y = y + (2 / 3) * (cpy - y);

      commands.push({ type: 'C', cp1x, cp1y, cp2x, cp2y, x, y });
      curX = x;
      curY = y;
    } else if (currentCmd === 'C' || currentCmd === 'c') {
      const cp1xRel = parseFloat(tokens[idx++]);
      const cp1yRel = parseFloat(tokens[idx++]);
      const cp2xRel = parseFloat(tokens[idx++]);
      const cp2yRel = parseFloat(tokens[idx++]);
      const xRel = parseFloat(tokens[idx++]);
      const yRel = parseFloat(tokens[idx++]);

      const cp1x = currentCmd === 'c' ? curX + cp1xRel : cp1xRel;
      const cp1y = currentCmd === 'c' ? curY + cp1yRel : cp1yRel;
      const cp2x = currentCmd === 'c' ? curX + cp2xRel : cp2xRel;
      const cp2y = currentCmd === 'c' ? curY + cp2yRel : cp2yRel;
      const x = currentCmd === 'c' ? curX + xRel : xRel;
      const y = currentCmd === 'c' ? curY + yRel : yRel;

      commands.push({ type: 'C', cp1x, cp1y, cp2x, cp2y, x, y });
      curX = x;
      curY = y;
    } else if (currentCmd === 'Z' || currentCmd === 'z') {
      commands.push({ type: 'Z' });
    } else {
      idx++;
    }
  }

  return commands;
}
