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

import { generateQREps, convertSvgToEps, MissingImageError, PayloadRejectedError } from '../index';
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

  it('convertSvgToEps converts SVG paths and text to EPS commands', async () => {
    const sampleSvg = `<svg width="500" height="500"><path d="M 10 10 L 100 10 L 100 100 Z" fill="#ff0000"/><text x="50" y="200" fill="#000000" font="bold 20px sans-serif" text-anchor="middle">TEST</text></svg>`;
    const eps = await convertSvgToEps(sampleSvg);

    expect(eps).toContain('%!PS-Adobe-3.0 EPSF-3.0');
    expect(eps).toContain('%%BoundingBox: 0 0 500 500');
    expect(eps).toContain('10 10 moveto');
    expect(eps).toContain('100 10 lineto');
    expect(eps).toContain('1 0 0 setrgbcolor');
    expect(eps).toContain('/QRHelvetica-Bold findfont 20 scalefont setfont');
    expect(eps).toContain('(TEST) show');
  });

  it('converts SVG paths containing H, h, V, v, and Z subpath resets to PostScript', async () => {
    const sampleSvg = `<svg width="200" height="200"><path d="M 10 10 H 50 v 20 h -10 V 10 Z m 5 5 h 10" fill="#000000"/></svg>`;
    const eps = await convertSvgToEps(sampleSvg);

    expect(eps).toContain('10 10 moveto');
    expect(eps).toContain('50 10 lineto');
    expect(eps).toContain('50 30 lineto');
    expect(eps).toContain('40 30 lineto');
    expect(eps).toContain('40 10 lineto');
    expect(eps).toContain('closepath');
    expect(eps).toContain('15 15 moveto');
    expect(eps).toContain('25 15 lineto');
  });

  describe('fidelity (#1362)', () => {
    const logoSvg = `<svg width="100" height="100"><path d="M 0 0 L 100 0 L 100 100 L 0 100 Z" fill="#ff0000"/><image href="data:image/png;base64,AA==" x="10" y="10" width="80" height="80"/></svg>`;

    it('re-encodes Helvetica to Latin-1 and escapes accented text', async () => {
      const eps = await convertSvgToEps(`<svg width="200" height="50"><text x="0" y="20" font="12px sans-serif">Café-1</text></svg>`);
      expect(eps).toContain('/Encoding ISOLatin1Encoding 256 array copy dup 45 /hyphen put');
      expect(eps).toContain('(Caf\\351-1) show');
      expect(eps).not.toContain('%%LanguageLevel');
    });

    it('declares LanguageLevel 3 for gradients and keeps every stop of a radial gradient', async () => {
      const svg = `<svg width="100" height="100"><defs><radialGradient id="g" cx="50" cy="50" r="40" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ff0000"/><stop offset="50%" stop-color="#00ff00"/><stop offset="100%" stop-color="#0000ff"/></radialGradient></defs><path d="M 0 0 L 100 0 L 100 100 Z" fill="url(#g)"/></svg>`;
      const eps = await convertSvgToEps(svg);
      expect(eps).toContain('%%LanguageLevel: 3');
      expect(eps).toContain('/ShadingType 3');
      expect(eps).toContain('/Coords [50 50 0 50 50 40]');
      expect(eps).toContain('/Bounds [0.5]');
    });

    it('embeds a transparent logo as a masked image', async () => {
      const decode = async (_href: string, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4).fill(255);
        data[3] = 0;
        return { width, height, data };
      };
      const eps = await convertSvgToEps(logoSvg, { decodeImage: decode });
      expect(eps).toContain('/ImageType 3 /InterleaveType 3');
      expect(eps).toContain('10 10 translate 80 80 scale');
      expect(eps).toContain('%%LanguageLevel: 3');
    });

    it('refuses the export instead of dropping a logo it cannot decode', async () => {
      await expect(convertSvgToEps(logoSvg, { decodeImage: () => Promise.reject(new Error('broken')) })).rejects.toBeInstanceOf(
        MissingImageError
      );
    });
  });
});

