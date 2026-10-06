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

import { test, expect } from '@playwright/test';

test.describe('Live Host Smoke Verification', { tag: '@prod' }, () => {
  test('Page loads, JS executes, and Web Worker initializes without errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    // Capture browser console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`Console error: ${msg.text()}`);
      }
    });

    // Capture unhandled page exceptions
    page.on('pageerror', (err) => {
      consoleErrors.push(`Page exception: ${err.message}`);
    });

    // Inject initialization script to spy on Web Worker creation
    await page.addInitScript(() => {
      const OriginalWorker = globalThis.Worker;
      class SpyWorker extends OriginalWorker {
        constructor(scriptURL: string | URL, options?: WorkerOptions) {
          super(scriptURL, options);
          (window as any).smokeWorkerCreated = true;
        }
      }
      globalThis.Worker = SpyWorker as any;
    });

    // Navigate to homepage (using the configured baseURL)
    await page.goto('/');

    // Assert that the page hydrates and form inputs render successfully
    const mainElement = page.locator('main[data-hydrated="true"]');
    await expect(mainElement).toBeVisible({ timeout: 15000 });

    const urlInput = page.locator('#url-input');
    await expect(urlInput).toBeVisible({ timeout: 15000 });

    // Wait and assert that the background web worker launches successfully
    await expect.poll(async () => {
      return await page.evaluate(() => !!(window as any).smokeWorkerCreated);
    }, {
      timeout: 15000,
      intervals: [250],
      message: 'Background Web Worker failed to initialize'
    }).toBe(true);

    // Verify no console errors or page exceptions occurred
    expect(consoleErrors).toEqual([]);
  });
});
