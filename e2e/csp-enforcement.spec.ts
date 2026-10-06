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
 * CSP-enforced regression suite (issues #969 and #970).
 *
 * Runs only in the `chromium-csp` Playwright project, which sets `bypassCSP: false`
 * so the built app's real Content Security Policy (meta tag rewritten by
 * scripts/csp_hash_injector.js) is enforced. The other projects bypass CSP, which
 * previously hid the SVG export failure caused by `img-src` lacking `blob:`.
 */

import fs from 'fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { codeScene, installFakeCamera, showOnCamera } from '../tests/utils/fakeCamera';

interface RecordedViolation {
  directive: string;
  blockedURI: string;
}

declare global {
  interface Window {
    __cspViolations?: RecordedViolation[];
  }
}

async function readViolations(page: Page): Promise<RecordedViolation[]> {
  return page.evaluate(() => window.__cspViolations ?? []);
}

test.beforeEach(async ({ page }, testInfo) => {
  expect(testInfo.project.use.bypassCSP, 'this suite must run with the CSP enforced').toBe(false);

  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
    });
    // Force the anchor-download fallback so Playwright observes a download event.
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });

  await page.goto('/');
  await page.waitForSelector('main[data-hydrated="true"]');
});

test.describe('Content Security Policy enforced', { tag: '@prod' }, () => {
  test('ships a CSP that allows blob: images/media and no third-party origins', async ({ page }) => {
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("media-src 'self' blob:");
    expect(csp).toContain("font-src 'self'");
    expect(csp).not.toMatch(/https?:\/\//);
  });

  test('loads the page without CSP violations or Google Fonts requests', async ({ page }) => {
    const externalRequests: string[] = [];
    page.on('request', (request) => {
      if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) {
        externalRequests.push(request.url());
      }
    });
    await page.reload();
    await page.waitForSelector('main[data-hydrated="true"]');
    await page.evaluate(() => document.fonts.ready);

    expect(externalRequests).toEqual([]);
    expect(await readViolations(page)).toEqual([]);
    expect(await page.locator('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]').count()).toBe(0);
  });

  test('SVG download succeeds with the CSP enforced (#969 regression)', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByRole('button', { name: 'Download options' }).click();
        await page.getByRole('radio', { name: 'SVG' }).click();
        await page.getByRole('button', { name: 'Download SVG' }).click();
      })(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.svg$/i);
    const content = fs.readFileSync(await download.path(), 'utf8');
    expect(content).toContain('<svg');
    expect(content).toContain('<path');

    const blobViolations = (await readViolations(page)).filter((v) => v.blockedURI.startsWith('blob') || v.blockedURI === 'blob');
    expect(blobViolations).toEqual([]);
  });

  test('the scanner compiles its self-hosted qr-decode reader under the CSP (ADR 0036)', async ({ page, context }) => {
    const warnings: string[] = [];
    const record = (text: string) => {
      if (/WasmModuleError|did not compile|wasm-runtime|WebAssembly/.test(text)) warnings.push(text);
    };
    page.on('console', (message) => record(message.text()));
    page.on('pageerror', (error) => record(String(error)));
    const wasm = page.waitForResponse((response) => /\/assets\/.*qr-decode[\w.-]*\.wasm$/.test(response.url()));
    await installFakeCamera(context);
    await page.reload();
    await page.waitForSelector('main[data-hydrated="true"]');

    await showOnCamera(page, codeScene('https://qrcraftly.com/csp'));
    await page.getByRole('button', { name: 'Scan QR Code' }).click();
    expect((await wasm).ok()).toBe(true);
    await page.getByRole('button', { name: 'Edit in generator' }).click();
    await expect(page.locator('#url-input')).toHaveValue('https://qrcraftly.com/csp');

    expect(warnings).toEqual([]);
    expect(await readViolations(page)).toEqual([]);
  });
});
