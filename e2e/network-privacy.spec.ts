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

import { randomBytes } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { renderPhoto } from '../tests/utils/photoFixture';
import { serveLocalSite, waitForController, type LocalSite } from './utils/localSite';

/**
 * The request matrix in docs/SECURITY.md (#1352), checked in the browser. The shared fixture
 * already fails any test that reaches another origin or sends a request body; these tests add
 * that what a person types or scans never appears in any request, even a same-origin one, and
 * that every request made while they work is a plain read of a static file.
 */

/** A value that cannot occur in the app by chance. */
const sentinel = () => `QRCRAFTLY-SECRET-${randomBytes(6).toString('hex')}`;

interface RecordedRequest {
  method: string;
  url: string;
}

/** Records every request the context makes from now on: pages, workers and the service worker. */
function recordRequests(context: BrowserContext): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  context.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));
  return requests;
}

/** Every way a request could carry the secret or more than a file read. */
function leaks(requests: RecordedRequest[], secret: string, origin: string): string[] {
  return requests.flatMap(({ method, url }) => {
    const problems: string[] = [];
    const parsed = new URL(url);
    if (['data:', 'blob:'].includes(parsed.protocol)) return problems;
    if (decodeURIComponent(url).includes(secret)) problems.push(`carries the secret: ${url}`);
    if (parsed.origin !== origin) problems.push(`other origin: ${url}`);
    if (method !== 'GET') problems.push(`${method} ${url}`);
    // Static files need no query string; one would mean input was encoded into a URL.
    if (parsed.search !== '') problems.push(`query string: ${url}`);
    return problems;
  });
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForSelector('main[data-hydrated="true"]');
  await page.waitForLoadState('networkidle');
}

async function download(page: Page, format: 'PNG' | 'SVG'): Promise<void> {
  const done = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download options' }).click();
  await page.getByRole('radio', { name: format }).click();
  await page.getByRole('button', { name: `Download ${format}` }).click();
  await done;
}

test.describe('Network privacy (#1352)', () => {
  test.beforeEach(async ({ page }) => {
    // Force the anchor-download fallback so Playwright observes a download event.
    await page.addInitScript(() => Reflect.deleteProperty(window, 'showSaveFilePicker'));
  });

  test('what a person types into the generator never leaves the browser, even when downloaded', async ({ page, context, baseURL }) => {
    const secret = sentinel();
    const requests = recordRequests(context);

    await open(page, '/');
    await page.locator('#url-input').fill(`https://example.com/${secret}`);
    await download(page, 'PNG');

    await open(page, '/text-qr-code');
    await page.locator('#text-content').fill(`Private note ${secret}`);
    await download(page, 'SVG');

    await open(page, '/wifi-qr-code');
    await page.locator('#wifi-ssid').fill('Home');
    await page.locator('#wifi-password').fill(secret);
    await download(page, 'PNG');

    expect(leaks(requests, secret, new URL(baseURL ?? '').origin)).toEqual([]);
  });

  test('the text of a scanned picture never leaves the browser', async ({ page, context, baseURL }) => {
    const secret = sentinel();
    await open(page, '/qr-code-checker');
    const photo = await renderPhoto(page, `https://example.com/${secret}`, { width: 800, height: 600, modulePx: 8 });

    const requests = recordRequests(context);
    await page.getByLabel('Choose a picture of a QR code').setInputFiles({ name: 'code.jpg', mimeType: 'image/jpeg', buffer: photo });
    await expect(page.getByTestId('scan-result-host')).toHaveText('example.com', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Copy' }).click();

    expect(leaks(requests, secret, new URL(baseURL ?? '').origin)).toEqual([]);
  });

  test.describe('after one visit', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'Service worker offline reloads are checked in Chromium');
    test.skip(Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL), 'Needs the local build so the server can be stopped');

    let site: LocalSite;
    test.beforeEach(async () => {
      site = await serveLocalSite();
    });
    test.afterEach(async () => {
      await site.dispose();
    });

    test('the QR code checker reads a picture with the server gone, once it was used online', async ({ page }) => {
      // Pages and workers outside the homepage shell are cached on first use (generate_sw.cjs),
      // so the checker works offline after one online scan.
      const choose = (buffer: Buffer) => page.getByLabel('Choose a picture of a QR code').setInputFiles({ name: 'code.jpg', mimeType: 'image/jpeg', buffer });
      await page.goto(`${site.origin}/qr-code-checker`);
      await page.waitForSelector('main[data-hydrated="true"]');
      await waitForController(page);
      await page.reload();
      await page.waitForSelector('main[data-hydrated="true"]');
      await choose(await renderPhoto(page, 'https://qrcraftly.com/online-check', { width: 800, height: 600, modulePx: 8 }));
      await expect(page.getByTestId('scan-result-host')).toHaveText('qrcraftly.com', { timeout: 15_000 });
      const photo = await renderPhoto(page, 'https://example.com/offline-check', { width: 800, height: 600, modulePx: 8 });

      await site.stop();
      await page.reload();
      await page.waitForSelector('main[data-hydrated="true"]');
      await choose(photo);
      await expect(page.getByTestId('scan-result-host')).toHaveText('example.com', { timeout: 15_000 });
    });
  });
});
