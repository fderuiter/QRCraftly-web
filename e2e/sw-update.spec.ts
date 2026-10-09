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
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const UPDATE_MESSAGE = 'A new version of QRCraftly is available.';
const BUILD_DIR = path.join(process.cwd(), 'dist', 'client');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Serves a private copy of the built site, so a test can "deploy" by editing files without
 * touching the build the other specs use. Pages resolve the way Workers Static Assets serves
 * them: `/about` answers with `about/index.html`.
 * @param root Directory to serve.
 * @returns The server's origin and a function that stops it.
 */
async function serveSite(root: string): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const base = path.join(root, ...pathname.split('/').filter(Boolean));
    const file = [base, `${base}.html`, path.join(base, 'index.html')].find(
      (candidate) => candidate.startsWith(root) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    );
    if (!file) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(fs.readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Waits until a service worker controls the page. */
async function waitForController(page: Page) {
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    return Boolean(navigator.serviceWorker.controller);
  });
}

test.describe('Service worker updates', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'One engine is enough for the update flow');
  test.skip(Boolean(process.env.PLAYWRIGHT_TEST_BASE_URL), 'Needs the local build to simulate a deploy');

  let siteDir: string;
  let site: { origin: string; close: () => Promise<void> };

  test.beforeEach(async () => {
    siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qrcraftly-sw-update-'));
    fs.cpSync(BUILD_DIR, siteDir, { recursive: true });
    site = await serveSite(siteDir);
  });

  test.afterEach(async () => {
    await site.close();
    fs.rmSync(siteDir, { recursive: true, force: true });
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
    const indexFile = path.join(siteDir, 'index.html');
    fs.writeFileSync(indexFile, fs.readFileSync(indexFile, 'utf8').replace('<title>', '<title>[BUILD B] '));
    const swFile = path.join(siteDir, 'sw.js');
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
