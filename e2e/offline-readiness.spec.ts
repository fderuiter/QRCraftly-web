/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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
import { serveLocalSite, type LocalSite } from './utils/localSite';

/**
 * Measures the first QR canvas: its pixel width and the share of dark pixels. A canvas that was
 * never drawn keeps the 300px default size and is fully transparent.
 */
async function measureQrCanvas(page: Page) {
  return page.getByTestId('qr-stage').locator('canvas').first().evaluate((canvas: HTMLCanvasElement) => {
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d');
    if (!context || canvas.width === 0 || canvas.height === 0) return { width: canvas.width, darkFraction: 0 };
    context.drawImage(canvas, 0, 0);
    const { data } = context.getImageData(0, 0, copy.width, copy.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 128 && data[i] + data[i + 1] + data[i + 2] < 384) dark++;
    }
    return { width: canvas.width, darkFraction: dark / (data.length / 4) };
  });
}

test.describe('Offline after one visit (#1262)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Service worker offline reloads are checked in Chromium');
  test.skip(Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL), 'Needs the local build so the server can be stopped');

  let site: LocalSite;

  test.beforeEach(async () => {
    site = await serveLocalSite();
  });

  test.afterEach(async () => {
    await site.dispose();
  });

  test('the homepage generator draws a code after the server goes away', async ({ page }) => {
    // One online visit: the worker installs (precaching the shell) and activates.
    await page.goto(`${site.origin}/`);
    await page.waitForSelector('main[data-hydrated="true"]');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => measureQrCanvas(page).then((m) => m.darkFraction)).toBeGreaterThan(0.05);

    // Stopping the server really cuts the network: every request now fails unless the worker
    // answers it (context.setOffline does not reliably fail worker fetches).
    await site.stop();

    await page.reload();
    await page.waitForSelector('main[data-hydrated="true"]', { timeout: 10000 });
    await expect(page.locator('h1')).toContainText('Free QR Code Generator');
    await expect.poll(async () => (await measureQrCanvas(page)).darkFraction, { timeout: 10000 }).toBeGreaterThan(0.05);
    expect((await measureQrCanvas(page)).width).toBeGreaterThan(300);
  });
});

test.describe('Automated Workbox Precaching and Offline Readiness', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to homepage first to allow SW registration
    await page.goto('/');
    await page.waitForSelector('main[data-hydrated="true"]');
  });

  test('Unknown routes are answered by the network, not the cached homepage', async ({ browserName, page }) => {
    test.skip(browserName !== 'chromium', 'Service worker response inspection is only reliable in Chromium in Playwright');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (navigator.serviceWorker.controller) return;
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
        setTimeout(() => resolve(), 2000);
      });
    });
    await page.reload();
    await page.waitForSelector('main[data-hydrated="true"]');
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    // Unknown routes are passed through to the server, so its 404 reaches the page
    // instead of the precached homepage.
    const unknownResponse = await page.goto('/this-route-does-not-exist');
    expect(unknownResponse?.status()).toBe(404);

    const aboutResponse = await page.goto('/about');
    expect(aboutResponse?.fromServiceWorker()).toBe(true);
  });

  test('Constraint 1: Custom brand logo uploads are transient and fully cleared on page refresh', async ({ page }) => {
    // 1. Expand the Logo section and locate the logo file input (the section also holds the Mosaic QR upload)
    await page.getByRole('button', { name: 'Logo', exact: true }).click();
    const fileInput = page.getByRole('region', { name: 'Logo' }).getByLabel('Upload logo image');
    await expect(fileInput).toBeAttached();

    // 2. Simulate uploading a custom brand logo image
    const sampleLogoBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    await fileInput.setInputFiles({
      name: 'test-logo.png',
      mimeType: 'image/png',
      buffer: sampleLogoBuffer
    });

    // 3. Assert the logo has been loaded (e.g. the remove button or Custom Logo preview text appears)
    const customLogoText = page.getByText('Custom Logo');
    await expect(customLogoText).toBeVisible();

    // 4. Perform a page refresh/reload
    await page.reload();
    await page.waitForSelector('main[data-hydrated="true"]');

    // 5. Verify the custom brand logo state has been fully wiped and reset
    await expect(page.getByText('Custom Logo')).not.toBeVisible();
  });

  test('Constraint 2: Mosaic QR designs are transient and fully cleared on page refresh', async ({ page }) => {
    // Mosaic QR lives in the Logo section of the appearance accordion
    await page.getByRole('button', { name: 'Logo', exact: true }).click();
    const fileInput = page.getByRole('region', { name: 'Logo' }).getByLabel('Upload mosaic design', { exact: true });
    await expect(fileInput).toBeAttached();

    await fileInput.setInputFiles({
      name: 'test-mosaic.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      ),
    });

    const removeMosaic = page.getByRole('button', { name: 'Remove mosaic image' });
    await expect(removeMosaic).toBeVisible();

    await page.reload();
    await page.waitForSelector('main[data-hydrated="true"]');

    await expect(page.getByRole('button', { name: 'Remove mosaic image' })).not.toBeVisible();
  });
});
