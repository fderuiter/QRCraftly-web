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
import { parseSvgPath } from './pathParser';

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

  const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10) / 255,
      g: parseInt(rgbMatch[2], 10) / 255,
      b: parseInt(rgbMatch[3], 10) / 255,
    };
  }

  if (c === 'black') return { r: 0, g: 0, b: 0 };
  if (c === 'white') return { r: 1, g: 1, b: 1 };

  return { r: 0, g: 0, b: 0 };
}

function formatNum(n: number): string {
  return parseFloat(n.toFixed(3)).toString();
}

/**
 * Converts an SVG path `d` attribute string to PDF path operators.
 */
function svgPathToPdf(d: string): string {
  const commands: string[] = [];
  parseSvgPath(d, {
    moveTo(x, y) {
      commands.push(`${formatNum(x)} ${formatNum(y)} m`);
    },
    lineTo(x, y) {
      commands.push(`${formatNum(x)} ${formatNum(y)} l`);
    },
    curveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
      commands.push(`${formatNum(cp1x)} ${formatNum(cp1y)} ${formatNum(cp2x)} ${formatNum(cp2y)} ${formatNum(x)} ${formatNum(y)} c`);
    },
    closePath() {
      commands.push('h');
    },
  });

  return commands.join('\n');
}


/**
 * Converts an SVG XML payload string to a valid vector PDF document byte array (Uint8Array).
 */
export function convertSvgToPdf(svgString: string): Uint8Array {
  let width = 1080;
  let height = 1080;

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
    }
  } else {
    const wMatch = svgString.match(/width="([\d.]+)"/);
    const hMatch = svgString.match(/height="([\d.]+)"/);
    if (wMatch) width = parseFloat(wMatch[1]);
    if (hMatch) height = parseFloat(hMatch[1]);
  }

  const streamLines: string[] = [
    'q',
    `1 0 0 -1 0 ${formatNum(height)} cm`, // Match SVG top-left coordinate origin
  ];

  // Parse defs for gradients (if any)
  const gradientMap = new Map<string, { type: 'linear' | 'radial'; x1: number; y1: number; x2: number; y2: number; stops: Array<{ offset: number; color: RgbColor }> }>();
  const shadingObjIds: Map<string, number> = new Map();
  let nextObjId = 6;

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
        shadingObjIds.set(id, nextObjId++);
      } else {
        const cx = parseFloat(grad.getAttribute('cx') || '50');
        const cy = parseFloat(grad.getAttribute('cy') || '50');
        const r = parseFloat(grad.getAttribute('r') || '50');
        gradientMap.set(id, { type: 'radial', x1: cx, y1: cy, x2: cx + r, y2: cy, stops });
        shadingObjIds.set(id, nextObjId++);
      }
    });

    doc.querySelectorAll('path, text').forEach((el) => {
      if (el.tagName === 'path') {
        const d = el.getAttribute('d');
        if (!d) return;

        const fillAttr = el.getAttribute('fill') || 'none';
        const strokeAttr = el.getAttribute('stroke') || 'none';
        const fillColor = fillAttr.startsWith('url(#') ? null : parseColor(fillAttr);
        const strokeColor = parseColor(strokeAttr);
        const fillRule = el.getAttribute('fill-rule');
        const strokeWidth = parseFloat(el.getAttribute('stroke-width') || '1');
        const strokeDash = el.getAttribute('stroke-dasharray');

        const pdfPath = svgPathToPdf(d);

        if (fillAttr.startsWith('url(#')) {
          const gradId = fillAttr.replace(/^url\(#/, '').replace(/\)$/, '');
          const shId = shadingObjIds.get(gradId);
          if (shId) {
            streamLines.push('q');
            streamLines.push(pdfPath);
            streamLines.push(fillRule === 'evenodd' ? 'W* n' : 'W n');
            streamLines.push(`/Sh${shId} sh`);
            streamLines.push('Q');
          } else {
            const fallbackColor = parseColor(fillAttr) || { r: 0, g: 0, b: 0 };
            streamLines.push(`${formatNum(fallbackColor.r)} ${formatNum(fallbackColor.g)} ${formatNum(fallbackColor.b)} rg`);
            streamLines.push(pdfPath);
            streamLines.push(fillRule === 'evenodd' ? 'f*' : 'f');
          }
        } else if (fillColor) {
          streamLines.push(`${formatNum(fillColor.r)} ${formatNum(fillColor.g)} ${formatNum(fillColor.b)} rg`);
          streamLines.push(pdfPath);
          streamLines.push(fillRule === 'evenodd' ? 'f*' : 'f');
        }

        if (strokeColor) {
          streamLines.push(`${formatNum(strokeColor.r)} ${formatNum(strokeColor.g)} ${formatNum(strokeColor.b)} RG`);
          streamLines.push(`${formatNum(strokeWidth)} w`);
          if (strokeDash) {
            const dashArr = strokeDash.split(/[\s,]+/).map(parseFloat).filter((n) => !isNaN(n));
            if (dashArr.length > 0) {
              streamLines.push(`[${dashArr.map(formatNum).join(' ')}] 0 d`);
            }
          }
          if (!fillColor && !fillAttr.startsWith('url(#')) {
            streamLines.push(pdfPath);
          }
          streamLines.push('S');
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
        const fontRef = isBold ? '/F2' : '/F1';

        const fillColor = parseColor(fillAttr) || { r: 0, g: 0, b: 0 };
        const safeText = textContent.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

        let adjX = x;
        const estWidth = textContent.length * fontSize * 0.55;
        if (anchor === 'middle') adjX = x - estWidth / 2;
        if (anchor === 'end') adjX = x - estWidth;

        streamLines.push('q');
        streamLines.push('BT');
        streamLines.push(`${fontRef} ${fontSize} Tf`);
        streamLines.push(`${formatNum(fillColor.r)} ${formatNum(fillColor.g)} ${formatNum(fillColor.b)} rg`);
        streamLines.push(`1 0 0 -1 ${formatNum(adjX)} ${formatNum(y)} Tm`);
        streamLines.push(`(${safeText}) Tj`);
        streamLines.push('ET');
        streamLines.push('Q');
      }
    });
  } else {
    // Regex fallback
    const pathRegex = /<path\s+[^>]*d="([^"]+)"[^>]*>/g;
    let match: RegExpExecArray | null;
    while ((match = pathRegex.exec(svgString)) !== null) {
      const pathTag = match[0];
      const d = match[1];

      const fillMatch = pathTag.match(/fill="([^"]+)"/);
      const strokeMatch = pathTag.match(/stroke="([^"]+)"/);
      const fillRuleMatch = pathTag.match(/fill-rule="([^"]+)"/);

      const pdfPath = svgPathToPdf(d);
      const fillColor = parseColor(fillMatch ? fillMatch[1] : '#000000');
      if (fillColor) {
        streamLines.push(`${formatNum(fillColor.r)} ${formatNum(fillColor.g)} ${formatNum(fillColor.b)} rg`);
        streamLines.push(pdfPath);
        streamLines.push(fillRuleMatch && fillRuleMatch[1] === 'evenodd' ? 'f*' : 'f');
      }

      const strokeColor = parseColor(strokeMatch ? strokeMatch[1] : 'none');
      if (strokeColor) {
        streamLines.push(`${formatNum(strokeColor.r)} ${formatNum(strokeColor.g)} ${formatNum(strokeColor.b)} RG`);
        streamLines.push(pdfPath);
        streamLines.push('S');
      }
    }
  }

  streamLines.push('Q');
  const streamData = streamLines.join('\n');

  // Build PDF structure and cross-reference table
  const pdfParts: string[] = [];
  const offsets: number[] = [0];

  function appendPart(str: string) {
    pdfParts.push(str);
  }

  const header = '%PDF-1.4\n%\xFF\xFF\xFF\xFF\n';
  appendPart(header);

  let currentOffset = header.length;

  // Obj 1: Catalog
  offsets.push(currentOffset);
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  appendPart(obj1);
  currentOffset += obj1.length;

  // Obj 2: Pages
  offsets.push(currentOffset);
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  appendPart(obj2);
  currentOffset += obj2.length;

  // Obj 3: Page
  offsets.push(currentOffset);
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatNum(width)} ${formatNum(height)}] /Resources 4 0 R /Contents 5 0 R >>\nendobj\n`;
  appendPart(obj3);
  currentOffset += obj3.length;

  // Obj 4: Resources
  offsets.push(currentOffset);
  let shRes = '';
  shadingObjIds.forEach((id) => {
    shRes += `/Sh${id} ${id} 0 R `;
  });

  const obj4 = `4 0 obj\n<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> ${shRes ? `/Shading << ${shRes}>>` : ''} >>\nendobj\n`;
  appendPart(obj4);
  currentOffset += obj4.length;

  // Obj 5: Contents Stream
  offsets.push(currentOffset);
  const obj5Header = `5 0 obj\n<< /Length ${streamData.length} >>\nstream\n`;
  const obj5Footer = '\nendstream\nendobj\n';
  const obj5 = obj5Header + streamData + obj5Footer;
  appendPart(obj5);
  currentOffset += obj5.length;

  // Obj 6+: Shading Objects
  shadingObjIds.forEach((id, gradId) => {
    const gradInfo = gradientMap.get(gradId);
    if (!gradInfo) return;

    const c0 = gradInfo.stops[0]?.color || { r: 0, g: 0, b: 0 };
    const c1 = gradInfo.stops[gradInfo.stops.length - 1]?.color || { r: 1, g: 1, b: 1 };

    offsets.push(currentOffset);
    const shObj = `${id} 0 obj\n<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${formatNum(gradInfo.x1)} ${formatNum(gradInfo.y1)} ${formatNum(gradInfo.x2)} ${formatNum(gradInfo.y2)}] /Function << /FunctionType 2 /Domain [0 1] /C0 [${formatNum(c0.r)} ${formatNum(c0.g)} ${formatNum(c0.b)}] /C1 [${formatNum(c1.r)} ${formatNum(c1.g)} ${formatNum(c1.b)}] /N 1.0 >> /Extend [true true] >>\nendobj\n`;
    appendPart(shObj);
    currentOffset += shObj.length;
  });

  const startXref = currentOffset;
  const totalObjs = offsets.length;

  let xref = `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
  for (let i = 1; i < totalObjs; i++) {
    const offStr = offsets[i].toString().padStart(10, '0');
    xref += `${offStr} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
  appendPart(xref);
  appendPart(trailer);

  const fullPdfStr = pdfParts.join('');
  const encoder = new TextEncoder();
  return encoder.encode(fullPdfStr);
}

/**
 * Generates a Vector PDF byte array (Uint8Array) for a given QR configuration.
 */
export async function generateQRPdf(
  config: QRConfig,
  options?: { onLogoOmitted?: () => void; renderOptions?: ModuleRenderOptions; skipPayloadValidation?: boolean }
): Promise<Uint8Array> {
  const svg = await generateQRSvg(config, options);
  return convertSvgToPdf(svg);
}
