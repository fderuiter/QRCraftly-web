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

// @vitest-environment jsdom
/**
 * The PDF download decodes (#1610): each case is exported with generateQRPdf, its page is
 * painted from the PDF's own operators, and our decoder must read back exactly the payload.
 */
import { describe, expect, it } from 'vitest';
import { qrReader } from '../../../../tests/fixtures/qrReader';
import { generateQRPdf } from '../index';
import { EXPORT_CASES } from './exportCases';
import { rasterizePdf } from '../../../../tests/fixtures/pdfRaster';

/** Stands in for the browser's image decoder: an opaque grey logo. */
const decodeImage = async (_href: string, width: number, height: number) => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4).fill(128),
});

describe('PDF export decodes back to its payload (#1610)', () => {
  it.each(EXPORT_CASES)('for $name', async ({ config }) => {
    const pdf = await generateQRPdf(config, { decodeImage });
    const raster = rasterizePdf(pdf, 1080);
    expect(qrReader.read(raster.data, raster.canvas.width, raster.canvas.height)[0]?.text).toBe(config.value);
  }, 60_000);

  it('paints the logo the PDF embeds', async () => {
    const withLogo = EXPORT_CASES[1].config;
    const raster = rasterizePdf(await generateQRPdf(withLogo, { decodeImage }), 1080);
    expect(raster.colorAt(540, 540)).toEqual([128, 128, 128]);
  });
});
