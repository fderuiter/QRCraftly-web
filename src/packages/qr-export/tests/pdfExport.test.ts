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

import { generateQRPdf, convertSvgToPdf, PayloadRejectedError } from '../index';
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

  it('convertSvgToPdf converts SVG elements to PDF page stream operators', () => {
    const sampleSvg = `<svg width="400" height="400"><path d="M 0 0 L 50 0 L 50 50 Z" fill="#0000ff"/><text x="100" y="100" fill="#000000" font="16px sans-serif">PDF TEST</text></svg>`;
    const pdfBytes = convertSvgToPdf(sampleSvg);
    const pdfStr = new TextDecoder().decode(pdfBytes);

    expect(pdfStr).toContain('/MediaBox [0 0 400 400]');
    expect(pdfStr).toContain('0 0 m');
    expect(pdfStr).toContain('50 0 l');
    expect(pdfStr).toContain('0 0 1 rg');
    expect(pdfStr).toContain('(PDF TEST) Tj');
  });
});
