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

import { describe, it, expect } from 'vitest';
// @ts-expect-error - jsdom type declarations
import { JSDOM } from 'jsdom';

if (typeof globalThis.DOMParser === 'undefined') {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Node = dom.window.Node;
}

import { generateQREps, convertSvgToEps, PayloadRejectedError } from '../index';
import { DEFAULT_CONFIG } from '@/constants';
import { QRType } from '@/types';

describe('EPS Vector Export', () => {
  it('generates a valid EPS document with standard headers and footer', async () => {
    const eps = await generateQREps(DEFAULT_CONFIG as any);
    expect(eps).toContain('%!PS-Adobe-3.0 EPSF-3.0');
    expect(eps).toContain('%%BoundingBox: 0 0');
    expect(eps).toContain('%%Creator: QRCraftly');
    expect(eps).toContain('showpage');
    expect(eps).toContain('%%EOF');
  });

  it('includes PostScript path vector commands for QR code modules', async () => {
    const eps = await generateQREps(DEFAULT_CONFIG as any);
    expect(eps).toContain('moveto');
    expect(eps).toContain('lineto');
    expect(eps).toContain('setrgbcolor');
    expect(eps).toContain('fill');
  });

  it('rejects invalid/dangerous QR payload before generating EPS', async () => {
    await expect(
      generateQREps({
        ...DEFAULT_CONFIG,
        type: QRType.TEXT,
        value: 'javascript:alert(1)',
      } as any)
    ).rejects.toBeInstanceOf(PayloadRejectedError);
  });

  it('convertSvgToEps converts SVG paths and text to EPS commands', () => {
    const sampleSvg = `<svg width="500" height="500"><path d="M 10 10 L 100 10 L 100 100 Z" fill="#ff0000"/><text x="50" y="200" fill="#000000" font="bold 20px sans-serif" text-anchor="middle">TEST</text></svg>`;
    const eps = convertSvgToEps(sampleSvg);

    expect(eps).toContain('%!PS-Adobe-3.0 EPSF-3.0');
    expect(eps).toContain('%%BoundingBox: 0 0 500 500');
    expect(eps).toContain('10 10 moveto');
    expect(eps).toContain('100 10 lineto');
    expect(eps).toContain('1 0 0 setrgbcolor');
    expect(eps).toContain('/Helvetica-Bold findfont 20 scalefont setfont');
    expect(eps).toContain('(TEST) show');
  });

  it('converts SVG paths containing H, h, V, v, and Z subpath resets to PostScript', () => {
    const sampleSvg = `<svg width="200" height="200"><path d="M 10 10 H 50 v 20 h -10 V 10 Z m 5 5 h 10" fill="#000000"/></svg>`;
    const eps = convertSvgToEps(sampleSvg);

    expect(eps).toContain('10 10 moveto');
    expect(eps).toContain('50 10 lineto');
    expect(eps).toContain('50 30 lineto');
    expect(eps).toContain('40 30 lineto');
    expect(eps).toContain('40 10 lineto');
    expect(eps).toContain('closepath');
    expect(eps).toContain('15 15 moveto');
    expect(eps).toContain('25 15 lineto');
  });
});
