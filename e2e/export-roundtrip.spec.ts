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
 * A downloaded code scans (#1610): type a payload, download it as PNG, SVG and PDF, and read
 * each file back. PNG and SVG go through the scanner's Image mode, as a person would use it;
 * a browser cannot open a PDF as an image, so the PDF's page is painted from its own operators
 * and decoded here. Each read must give back exactly the payload that was typed.
 */
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { qrReader } from '../tests/fixtures/qrReader';
import { rasterizePdf } from '../tests/fixtures/pdfRaster';

const PAYLOAD = 'https://qrcraftly.com/export-round-trip?q=1';

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium decodes SVG through createImageBitmap and grants clipboard reads');

async function openGenerator(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('main[data-hydrated="true"]');
  await page.locator('#url-input').fill(PAYLOAD);
}

/** Downloads the current code in `format` and returns the file's bytes. */
async function download(page: Page, format: 'PNG' | 'SVG' | 'PDF'): Promise<Buffer> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Download options' }).click();
      await page.getByRole('group', { name: 'Download options' }).getByRole('radio', { name: format }).click();
      await page.getByRole('button', { name: `Download ${format}` }).click();
    })(),
  ]);
  return fs.readFileSync(await file.path());
}

/** Scans `bytes` in the scanner's Image mode and returns the text the result sheet copies. */
async function scanInImageMode(page: Page, name: string, mimeType: string, bytes: Buffer): Promise<string> {
  await page.getByRole('button', { name: 'Scan QR Code' }).click();
  await page.getByRole('radio', { name: 'Image' }).click();
  await page.getByLabel('Upload QR code image file').setInputFiles({ name, mimeType, buffer: bytes });
  await expect(page.getByTestId('scan-result')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('scan-result').getByRole('button', { name: 'Copy' }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe('downloads decode back to the typed payload (#1610)', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    // Force the anchor-download fallback so Playwright observes a download event.
    await page.addInitScript(() => Reflect.deleteProperty(window, 'showSaveFilePicker'));
  });

  for (const { format, name, mimeType } of [
    { format: 'PNG', name: 'qr.png', mimeType: 'image/png' },
    { format: 'SVG', name: 'qr.svg', mimeType: 'image/svg+xml' },
  ] as const) {
    test(`${format} scans in the scanner`, async ({ page }) => {
      test.setTimeout(60_000);
      await openGenerator(page);
      const bytes = await download(page, format);
      expect(await scanInImageMode(page, name, mimeType, bytes)).toBe(PAYLOAD);
    });
  }

  test('PDF holds a code that decodes', async ({ page }) => {
    test.setTimeout(60_000);
    await openGenerator(page);
    const bytes = await download(page, 'PDF');
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const raster = rasterizePdf(new Uint8Array(bytes), 1080);
    expect(qrReader.read(raster.data, raster.canvas.width, raster.canvas.height)[0]?.text).toBe(PAYLOAD);
  });
});
