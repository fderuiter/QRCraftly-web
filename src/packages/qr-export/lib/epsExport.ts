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
import {
  parseColor,
  formatNum,
  parseSvgDocument,
  extractSvgGradients,
  parseSvgPathCommands,
} from './vectorUtils';

/**
 * Converts an SVG path `d` attribute string to PostScript path commands.
 */
function svgPathToPostScript(d: string): string {
  const commands = parseSvgPathCommands(d);
  return commands
    .map((cmd) => {
      switch (cmd.type) {
        case 'M':
          return `${formatNum(cmd.x)} ${formatNum(cmd.y)} moveto`;
        case 'L':
          return `${formatNum(cmd.x)} ${formatNum(cmd.y)} lineto`;
        case 'C':
          return `${formatNum(cmd.cp1x)} ${formatNum(cmd.cp1y)} ${formatNum(cmd.cp2x)} ${formatNum(cmd.cp2y)} ${formatNum(cmd.x)} ${formatNum(cmd.y)} curveto`;
        case 'Z':
          return 'closepath';
      }
    })
    .join('\n');
}

/**
 * Converts an SVG string into Encapsulated PostScript (.eps) format.
 */
export function convertSvgToEps(svgString: string): string {
  const { width, height, title } = parseSvgDocument(svgString);

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
  const gradientMap = extractSvgGradients(svgString);

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');

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
