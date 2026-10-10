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

import { generateQRPdf, convertSvgToPdf, MissingImageError, PayloadRejectedError } from '../index';
import { DEFAULT_CONFIG } from '@/constants';
import { QRType } from '@/types';

describe('PDF Vector Export', () => {
  it('generates a valid PDF document with standard structure and xref table', async () => {
    const pdfBytes = await generateQRPdf(DEFAULT_CONFIG as any);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);

    const pdfStr = new TextDecoder().decode(pdfBytes);
    expect(pdfStr).toContain('%PDF-1.4');
    expect(pdfStr).toContain('/Type /Catalog');
    expect(pdfStr).toContain('/Type /Pages');
    expect(pdfStr).toContain('/Type /Page');
    expect(pdfStr).toContain('/MediaBox');
    expect(pdfStr).toContain('xref');
    expect(pdfStr).toContain('trailer');
    expect(pdfStr).toContain('%%EOF');
  });

  it('includes PDF vector operators for QR code paths', async () => {
    const pdfBytes = await generateQRPdf(DEFAULT_CONFIG as any);
    const pdfStr = new TextDecoder().decode(pdfBytes);

    expect(pdfStr).toContain(' m');
    expect(pdfStr).toContain(' l');
    expect(pdfStr).toContain(' rg');
    expect(pdfStr).toContain(' f');
  });

  it('rejects invalid/dangerous QR payload before generating PDF', async () => {
    await expect(
      generateQRPdf({
        ...DEFAULT_CONFIG,
        type: QRType.TEXT,
        value: 'javascript:alert(1)',
      } as any)
    ).rejects.toBeInstanceOf(PayloadRejectedError);
  });

  it('convertSvgToPdf converts SVG elements to PDF page stream operators', async () => {
    const sampleSvg = `<svg width="400" height="400"><path d="M 0 0 L 50 0 L 50 50 Z" fill="#0000ff"/><text x="100" y="100" fill="#000000" font="16px sans-serif">PDF TEST</text></svg>`;
    const pdfBytes = await convertSvgToPdf(sampleSvg);
    const pdfStr = new TextDecoder().decode(pdfBytes);

    expect(pdfStr).toContain('/MediaBox [0 0 400 400]');
    expect(pdfStr).toContain('0 0 m');
    expect(pdfStr).toContain('50 0 l');
    expect(pdfStr).toContain('0 0 1 rg');
    expect(pdfStr).toContain('(PDF TEST) Tj');
  });

  it('converts SVG paths containing H, h, V, v, and Z subpath resets to PDF operators', async () => {
    const sampleSvg = `<svg width="200" height="200"><path d="M 10 10 H 50 v 20 h -10 V 10 Z m 5 5 h 10" fill="#000000"/></svg>`;
    const pdfBytes = await convertSvgToPdf(sampleSvg);
    const pdfStr = new TextDecoder().decode(pdfBytes);

    expect(pdfStr).toContain('10 10 m');
    expect(pdfStr).toContain('50 10 l');
    expect(pdfStr).toContain('50 30 l');
    expect(pdfStr).toContain('40 30 l');
    expect(pdfStr).toContain('40 10 l');
    expect(pdfStr).toContain('h');
    expect(pdfStr).toContain('15 15 m');
    expect(pdfStr).toContain('25 15 l');
  });

  describe('file structure and fidelity (#1362)', () => {
    /** Reads the file byte for byte (latin1 maps each byte to one character). */
    const bytesOf = (pdf: Uint8Array) => new TextDecoder('latin1').decode(pdf);

    /** Checks that every xref entry and stream length points at the right byte. */
    const expectByteExactXref = (pdf: Uint8Array) => {
      const file = bytesOf(pdf);
      const start = Number(/startxref\n(\d+)/.exec(file)?.[1]);
      expect(file.slice(start, start + 4)).toBe('xref');
      const lines = file.slice(start).split(/\r?\n/);
      const count = Number(lines[1].split(' ')[1]);
      for (let id = 1; id < count; id++) {
        const offset = Number(lines[2 + id].slice(0, 10));
        expect(file.slice(offset, offset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`);
      }
      for (const match of file.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
        const end = (match.index ?? 0) + match[0].length + Number(match[1]);
        expect(file.slice(end, end + 10)).toBe('\nendstream');
      }
    };

    const square = (fill: string) => `<path d="M 0 0 L 100 0 L 100 100 L 0 100 Z" fill="${fill}"/>`;
    const opaqueDecoder = async (_href: string, width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4).fill(255),
    });

    it('counts xref offsets and stream lengths in bytes, including accented text', async () => {
      const svg = `<svg width="200" height="200">${square('#000')}<text x="10" y="20" font="bold 12px sans-serif">Scannez-moi é ü</text></svg>`;
      expectByteExactXref(await convertSvgToPdf(svg));
      expectByteExactXref(await generateQRPdf(DEFAULT_CONFIG as any));
    });

    it('writes accented text in WinAnsi so it is not garbled', async () => {
      const file = bytesOf(await convertSvgToPdf(`<svg width="200" height="50"><text x="0" y="20" font="12px sans-serif">Café ü 中</text></svg>`));
      expect(file).toContain('/Encoding /WinAnsiEncoding');
      expect(file).toContain('(Caf\\351 \\374 ?) Tj');
    });

    it('moves the baseline for dominant-baseline and centres text with font metrics', async () => {
      const svg = `<svg width="200" height="200"><text x="100" y="100" font="20px sans-serif" text-anchor="middle" dominant-baseline="middle">HI</text></svg>`;
      const file = bytesOf(await convertSvgToPdf(svg));
      // "HI" in Helvetica is 722 + 278 = 1000/1000 em, so 20 units wide; the em-box middle sits 0.2555 em above the baseline.
      expect(file).toContain('1 0 0 -1 90 105.11 Tm');
    });

    it('keeps radial gradients radial, with every stop and the gradient transform', async () => {
      const svg = `<svg width="100" height="100"><defs><radialGradient id="g" cx="50" cy="50" r="40" fx="50" fy="50" gradientUnits="userSpaceOnUse" gradientTransform="matrix(1 0 0 2 0 0)"><stop offset="0%" stop-color="#ff0000"/><stop offset="50%" stop-color="#00ff00"/><stop offset="100%" stop-color="#0000ff"/></radialGradient></defs>${square('url(#g)')}</svg>`;
      const file = bytesOf(await convertSvgToPdf(svg));
      expect(file).toContain('/ShadingType 3');
      expect(file).toContain('/Coords [50 50 0 50 50 40]');
      expect(file).toContain('/FunctionType 3');
      expect(file).toContain('/Bounds [0.5]');
      expect(file).toMatch(/W n\n1 0 0 2 0 0 cm\n\/Sh1 sh/);
    });

    it('embeds logos as images with their transparency', async () => {
      const decode = async (_href: string, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4).fill(200);
        data[3] = 0;
        return { width, height, data };
      };
      const svg = `<svg width="100" height="100">${square('#fff')}<image href="data:image/png;base64,AA==" x="25" y="25" width="50" height="50"/></svg>`;
      const pdf = await convertSvgToPdf(svg, { decodeImage: decode });
      const file = bytesOf(pdf);
      expect(file).toContain('/Subtype /Image /Width 200 /Height 200');
      expect(file).toContain('/SMask');
      expect(file).toContain('50 0 0 -50 25 75 cm\n/Im1 Do');
      expectByteExactXref(pdf);
    });

    it('leaves out the soft mask for an opaque logo', async () => {
      const svg = `<svg width="100" height="100"><image href="data:image/png;base64,AA==" x="0" y="0" width="10" height="10"/></svg>`;
      const file = bytesOf(await convertSvgToPdf(svg, { decodeImage: opaqueDecoder }));
      expect(file).toContain('/Subtype /Image');
      expect(file).not.toContain('/SMask');
    });

    it('refuses the export instead of dropping a logo it cannot decode', async () => {
      const svg = `<svg width="100" height="100"><image href="data:image/png;base64,AA==" x="0" y="0" width="10" height="10"/></svg>`;
      await expect(
        convertSvgToPdf(svg, { decodeImage: () => Promise.reject(new Error('broken')) })
      ).rejects.toBeInstanceOf(MissingImageError);
    });

    it('strokes a path that is also filled', async () => {
      const svg = `<svg width="100" height="100"><path d="M 0 0 L 10 0 L 10 10 Z" fill="#ff0000" stroke="#0000ff" stroke-width="2"/></svg>`;
      const file = bytesOf(await convertSvgToPdf(svg));
      expect(file).toMatch(/f\n0 0 1 RG\n2 w\n0 0 m\n10 0 l\n10 10 l\nh\nS/);
    });
  });
});

