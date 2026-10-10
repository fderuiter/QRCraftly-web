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

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';
import { serveLocalSite, waitForController, type LocalSite } from './utils/localSite';

const UPDATE_MESSAGE = 'A new version of QRCraftly is available.';

test.describe('Service worker updates', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One engine is enough for the update flow');
  test.skip(Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL), 'Needs the local build to simulate a deploy');

  let site: LocalSite;

  test.beforeEach(async () => {
    site = await serveLocalSite();
  });

  test.afterEach(async () => {
    await site.dispose();
  });

  test('a first visit shows no update prompt, and accepting an update loads the new build (#1126, #1259)', async ({ page }) => {
    // Build A: a first visit, then a second visit controlled by A's worker.
    await page.goto(`${site.origin}/`);
    await page.waitForSelector('main[data-hydrated="true"]');
    await waitForController(page);
    await page.reload();
    await page.waitForSelector('main[data-hydrated="true"]');
    await expect(page.getByText(UPDATE_MESSAGE)).toHaveCount(0);
    await expect(page).not.toHaveTitle(/\[BUILD B\]/);

    // Deploy build B: a changed homepage, so a worker with a new build hash and cache.
    const indexFile = path.join(site.dir, 'index.html');
    fs.writeFileSync(indexFile, fs.readFileSync(indexFile, 'utf8').replace('<title>', '<title>[BUILD B] '));
    const swFile = path.join(site.dir, 'sw.js');
    const swSource = fs.readFileSync(swFile, 'utf8');
    const nextSource = swSource.replace(/(const CACHE_NAME = CACHE_PREFIX \+ ')([^']+)'/, "$1$2-b'");
    expect(nextSource).not.toBe(swSource);
    fs.writeFileSync(swFile, nextSource);

    // The browser's update check finds B, which waits and is announced.
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    await expect(page.getByText(UPDATE_MESSAGE)).toBeVisible();

    // Accepting it reloads into build B, not a copy of A from A's cache.
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(page).toHaveTitle(/\[BUILD B\]/);
    await page.waitForSelector('main[data-hydrated="true"]');
    await expect(page.getByText(UPDATE_MESSAGE)).toHaveCount(0);
  });
});
