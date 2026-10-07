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

import { QRConfig } from '@/types';
import { generateQRSvg } from './svgExport';
import { type ModuleRenderOptions } from '@/packages/qr-matrix';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function parseColor(colorStr: string): RgbColor | null {
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

function formatNum(n: number): string {
  return parseFloat(n.toFixed(3)).toString();
}

/**
 * Converts an SVG path `d` attribute string to PostScript path commands.
 */
function svgPathToPostScript(d: string): string {
  const commands: string[] = [];
  // Tokenize commands and numbers
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
      commands.push(`${formatNum(curX)} ${formatNum(curY)} moveto`);
      currentCmd = currentCmd === 'M' ? 'L' : 'l'; // Subsequent pairs are implicit lineTos
    } else if (currentCmd === 'L' || currentCmd === 'l') {
      const x = parseFloat(tokens[idx++]);
      const y = parseFloat(tokens[idx++]);
      curX = currentCmd === 'l' ? curX + x : x;
      curY = currentCmd === 'l' ? curY + y : y;
      commands.push(`${formatNum(curX)} ${formatNum(curY)} lineto`);
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

      commands.push(`${formatNum(cp1x)} ${formatNum(cp1y)} ${formatNum(cp2x)} ${formatNum(cp2y)} ${formatNum(x)} ${formatNum(y)} curveto`);
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

      commands.push(`${formatNum(cp1x)} ${formatNum(cp1y)} ${formatNum(cp2x)} ${formatNum(cp2y)} ${formatNum(x)} ${formatNum(y)} curveto`);
      curX = x;
      curY = y;
    } else if (currentCmd === 'Z' || currentCmd === 'z') {
      commands.push('closepath');
    } else {
      idx++;
    }
  }

  return commands.join('\n');
}

/**
 * Converts an SVG string into Encapsulated PostScript (.eps) format.
 */
export function convertSvgToEps(svgString: string): string {
  let width = 1080;
  let height = 1080;
  let title = 'QR Code';

  // Parse SVG document using DOMParser if available, or regex fallback
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (svgEl) {
      const wAttr = svgEl.getAttribute('width');
      const hAttr = svgEl.getAttribute('height');
      const vbAttr = svgEl.getAttribute('viewBox');

      if (wAttr) width = parseFloat(wAttr);
      if (hAttr) height = parseFloat(hAttr);

      if ((!width || !height) && vbAttr) {
        const parts = vbAttr.split(/[\s,]+/).map(parseFloat);
        if (parts.length === 4) {
          width = parts[2];
          height = parts[3];
        }
      }

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

  const psLines: string[] = [
    `%!PS-Adobe-3.0 EPSF-3.0`,
    `%%BoundingBox: 0 0 ${Math.ceil(width)} ${Math.ceil(height)}`,
    `%%HiResBoundingBox: 0.00 0.00 ${formatNum(width)} ${formatNum(height)}`,
    `%%Title: ${title.replace(/[^\x20-\x7E]/g, '')}`,
    `%%Creator: QRCraftly`,
    `%%Pages: 1`,
    `%%EndComments`,
    `%%Page: 1 1`,
    `gsave`,
    `0 ${formatNum(height)} translate 1 -1 scale`, // Match SVG top-left coordinate origin
  ];

  // Parse defs for gradients (if any)
  const gradientMap = new Map<string, { type: 'linear' | 'radial'; x1: number; y1: number; x2: number; y2: number; stops: Array<{ offset: number; color: RgbColor }> }>();

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

    // Traverse vector elements
    const elements = doc.querySelectorAll('path, text, image');
    elements.forEach((el) => {
      if (el.tagName === 'path') {
        const d = el.getAttribute('d');
        if (!d) return;

        const fillAttr = el.getAttribute('fill') || 'none';
        const strokeAttr = el.getAttribute('stroke') || 'none';
        const fillRule = el.getAttribute('fill-rule');
        const strokeWidth = parseFloat(el.getAttribute('stroke-width') || '1');
        const strokeDash = el.getAttribute('stroke-dasharray');

        psLines.push('newpath');
        psLines.push(svgPathToPostScript(d));

        if (fillAttr.startsWith('url(#')) {
          const gradId = fillAttr.replace(/^url\(#/, '').replace(/\)$/, '');
          const gradInfo = gradientMap.get(gradId);
          if (gradInfo && gradInfo.stops.length >= 2) {
            const c0 = gradInfo.stops[0].color;
            const c1 = gradInfo.stops[gradInfo.stops.length - 1].color;
            psLines.push('gsave');
            psLines.push(fillRule === 'evenodd' ? 'eoclip' : 'clip');
            psLines.push('newpath');
            psLines.push(`<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${formatNum(gradInfo.x1)} ${formatNum(gradInfo.y1)} ${formatNum(gradInfo.x2)} ${formatNum(gradInfo.y2)}] /Function << /FunctionType 2 /Domain [0 1] /C0 [${formatNum(c0.r)} ${formatNum(c0.g)} ${formatNum(c0.b)}] /C1 [${formatNum(c1.r)} ${formatNum(c1.g)} ${formatNum(c1.b)}] /N 1.0 >> /Extend [true true] >> shfill`);
            psLines.push('grestore');
          } else {
            psLines.push('0 0 0 setrgbcolor');
            psLines.push(fillRule === 'evenodd' ? 'eofill' : 'fill');
          }
        } else {
          const fillColor = parseColor(fillAttr);
          if (fillColor) {
            psLines.push(`${formatNum(fillColor.r)} ${formatNum(fillColor.g)} ${formatNum(fillColor.b)} setrgbcolor`);
            psLines.push(fillRule === 'evenodd' ? 'eofill' : 'fill');
          }
        }

        const strokeColor = parseColor(strokeAttr);
        if (strokeColor) {
          psLines.push(`${formatNum(strokeColor.r)} ${formatNum(strokeColor.g)} ${formatNum(strokeColor.b)} setrgbcolor`);
          psLines.push(`${formatNum(strokeWidth)} setlinewidth`);
          if (strokeDash) {
            const dashArr = strokeDash.split(/[\s,]+/).map(parseFloat).filter((n) => !isNaN(n));
            if (dashArr.length > 0) {
              psLines.push(`[${dashArr.map(formatNum).join(' ')}] 0 setdash`);
            }
          }
          psLines.push('stroke');
        }
      } else if (el.tagName === 'text') {
        const textContent = el.textContent || '';
        if (!textContent) return;

        const x = parseFloat(el.getAttribute('x') || '0');
        const y = parseFloat(el.getAttribute('y') || '0');
        const fillAttr = el.getAttribute('fill') || '#000000';
        const fontAttr = el.getAttribute('font') || '16px sans-serif';
        const anchor = el.getAttribute('text-anchor') || 'start';

        const sizeMatch = fontAttr.match(/(\d+)px/);
        const fontSize = sizeMatch ? parseInt(sizeMatch[1], 10) : 16;
        const isBold = fontAttr.includes('bold');
        const fontName = isBold ? '/Helvetica-Bold' : '/Helvetica';

        const fillColor = parseColor(fillAttr) || { r: 0, g: 0, b: 0 };
        const safeText = textContent.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

        psLines.push('gsave');
        psLines.push(`${formatNum(x)} ${formatNum(y)} translate 1 -1 scale`);
        psLines.push(`${fontName} findfont ${fontSize} scalefont setfont`);
        psLines.push(`${formatNum(fillColor.r)} ${formatNum(fillColor.g)} ${formatNum(fillColor.b)} setrgbcolor`);

        if (anchor === 'middle') {
          psLines.push(`(${safeText}) stringwidth pop 2 div neg 0 moveto (${safeText}) show`);
        } else if (anchor === 'end') {
          psLines.push(`(${safeText}) stringwidth pop neg 0 moveto (${safeText}) show`);
        } else {
          psLines.push(`0 0 moveto (${safeText}) show`);
        }
        psLines.push('grestore');
      }
    });
  } else {
    // Regex fallback for non-DOM environments
    const pathRegex = /<path\s+[^>]*d="([^"]+)"[^>]*>/g;
    let match: RegExpExecArray | null;
    while ((match = pathRegex.exec(svgString)) !== null) {
      const pathTag = match[0];
      const d = match[1];

      const fillMatch = pathTag.match(/fill="([^"]+)"/);
      const strokeMatch = pathTag.match(/stroke="([^"]+)"/);
      const fillRuleMatch = pathTag.match(/fill-rule="([^"]+)"/);

      psLines.push('newpath');
      psLines.push(svgPathToPostScript(d));

      const fillColor = parseColor(fillMatch ? fillMatch[1] : '#000000');
      if (fillColor) {
        psLines.push(`${formatNum(fillColor.r)} ${formatNum(fillColor.g)} ${formatNum(fillColor.b)} setrgbcolor`);
        psLines.push(fillRuleMatch && fillRuleMatch[1] === 'evenodd' ? 'eofill' : 'fill');
      }

      const strokeColor = parseColor(strokeMatch ? strokeMatch[1] : 'none');
      if (strokeColor) {
        psLines.push(`${formatNum(strokeColor.r)} ${formatNum(strokeColor.g)} ${formatNum(strokeColor.b)} setrgbcolor`);
        psLines.push('stroke');
      }
    }
  }

  psLines.push('grestore');
  psLines.push('showpage');
  psLines.push('%%EOF');

  return psLines.join('\n');
}

/**
 * Generates an Encapsulated PostScript (.eps) file string for a given QR configuration.
 */
export async function generateQREps(
  config: QRConfig,
  options?: { onLogoOmitted?: () => void; renderOptions?: ModuleRenderOptions; skipPayloadValidation?: boolean }
): Promise<string> {
  const svg = await generateQRSvg(config, options);
  return convertSvgToEps(svg);
}
