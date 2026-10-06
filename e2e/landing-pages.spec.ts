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

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { renderPhoto } from '../tests/utils/photoFixture';

/**
 * The landing pages that preset the generator (#1035, #1037) and the QR code checker (#1036).
 */

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForSelector('main[data-hydrated="true"]');
}

test.describe('Landing pages that preset the generator', () => {
  test('the logo and image pages open with the Logo section expanded', async ({ page }) => {
    for (const path of ['/qr-code-with-logo', '/mosaic-qr-code']) {
      await open(page, path);
      await expect(page.getByRole('button', { name: 'Logo', exact: true })).toHaveAttribute('aria-expanded', 'true');
    }
    await open(page, '/menu-qr-code');
    await expect(page.getByRole('button', { name: 'Logo', exact: true })).toHaveAttribute('aria-expanded', 'false');
  });

  test('the mosaic page shows both example pictures and the WhatsApp page starts on a wa.me link', async ({ page }) => {
    await open(page, '/mosaic-qr-code');
    await expect(page.getByRole('heading', { level: 1, name: 'Image QR Code Generator (Mosaic)' })).toBeVisible();
    for (const image of await page.getByRole('region', { name: 'Examples' }).getByRole('img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    }
    await open(page, '/whatsapp-qr-code');
    await expect(page.locator('#url-input')).toHaveValue('https://wa.me/');
  });
});

test.describe('QR code checker', () => {
  test('reads a picture of a code and reports whether it scans, without leaving the browser', async ({ page }) => {
    await open(page, '/qr-code-checker');
    await expect(page.getByRole('heading', { level: 1, name: 'QR Code Checker' })).toBeVisible();
    const photo = await renderPhoto(page, 'https://qrcraftly.com/checked-here', { width: 800, height: 600, modulePx: 8 });
    await page.getByLabel('Choose a picture of a QR code').setInputFiles({ name: 'code.jpg', mimeType: 'image/jpeg', buffer: photo });
    await expect(page.getByTestId('scan-result-host')).toHaveText('qrcraftly.com', { timeout: 15_000 });
    // A sharp photo of a plain code passes the print simulation too (#1248).
    await expect(page.getByText('Scans reliably')).toBeVisible();
    await page.getByRole('button', { name: 'Scan another' }).click();
    await expect(page.getByRole('button', { name: 'Choose picture' })).toBeVisible();
  });

  test('says so when a picture holds no QR code', async ({ page }) => {
    await open(page, '/qr-code-checker');
    await page.getByLabel('Choose a picture of a QR code').setInputFiles({
      name: 'blank.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      ),
    });
    await expect(page.getByRole('alert')).toContainText(/No QR code/i, { timeout: 15_000 });
  });
});
