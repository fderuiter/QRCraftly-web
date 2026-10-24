/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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
 * The bundle-size check counts the Rust modules a page fetches as soon as it opens by reading
 * the build (#1594). This spec opens one page of each kind in a real browser and checks that the
 * modules it fetches are exactly the ones the check counts, so the rule and its list of on-demand
 * tools cannot drift from what visitors download.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import { readStartupWasm, wasmModuleName } from '../scripts/check-bundle-size.js';

const DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/client');

const PAGES = [
  { route: '/', html: 'index.html' },
  { route: '/mosaic-qr-code/', html: 'mosaic-qr-code/index.html' },
  { route: '/bulk-csv-qr-code/', html: 'bulk-csv-qr-code/index.html' },
  { route: '/arcade/', html: 'arcade/index.html' },
  { route: '/qr-code-size-calculator/', html: 'qr-code-size-calculator/index.html' },
  { route: '/qr-code-scanner/', html: 'qr-code-scanner/index.html' },
  { route: '/file-transfer/', html: 'file-transfer/index.html' },
  { route: '/about/', html: 'about/index.html' },
];

test.describe('WebAssembly fetched on open', () => {
  // Only the page and its workers count; the service worker's precache is not part of opening a page.
  test.use({ serviceWorkers: 'block' });
  test.skip(({ browserName }) => browserName !== 'chromium', 'Worker requests are reported to the context reliably in Chromium');
  test.skip(Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL), 'Compares against the local build in dist/client');

  for (const { route, html } of PAGES) {
    test(`${route} fetches the modules the bundle-size check counts`, async ({ page, context }) => {
      const expected = [...readStartupWasm(DIST_DIR, html).keys()].sort();
      const fetched = new Set<string>();
      context.on('request', (request) => {
        const name = wasmModuleName(new URL(request.url()).pathname);
        if (name) fetched.add(name);
      });

      await page.goto(route, { waitUntil: 'networkidle' });
      await expect.poll(() => [...fetched].sort(), { timeout: 15_000 }).toEqual(expected);
      // Nothing else arrives once the page has settled.
      await page.waitForLoadState('networkidle');
      expect([...fetched].sort()).toEqual(expected);
    });
  }
});
