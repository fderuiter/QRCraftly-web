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
import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { codeScene, installFakeCamera, showOnCamera } from '../tests/utils/fakeCamera';
import { installSyntheticCamera, relayFrames } from './utils/opticalLink';

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

/** Records the page's CSP violations into `window.__cspViolations`, from the first script on. */
async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations?.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
    });
  });
}

/** The file names of the dedicated workers a page starts, such as `worker-matrix-<hash>.js`. */
function recordWorkers(page: Page): string[] {
  const names: string[] = [];
  page.on('worker', (worker) => names.push(new URL(worker.url()).pathname.split('/').pop() ?? ''));
  return names;
}

/** Page errors that name Trusted Types, which a refused sink throws. */
function recordTrustedTypesErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    if (/Trusted(Script|HTML|ScriptURL)|trusted-types/i.test(String(error))) errors.push(String(error));
  });
  return errors;
}

test.beforeEach(async ({ page }, testInfo) => {
  expect(testInfo.project.use.bypassCSP, 'this suite must run with the CSP enforced').toBe(false);

  await recordViolations(page);
  // Force the anchor-download fallback so Playwright observes a download event.
  await page.addInitScript(() => Reflect.deleteProperty(window, 'showSaveFilePicker'));

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
        await page.getByRole('group', { name: 'Download options' }).getByRole('radio', { name: 'SVG' }).click();
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

test.describe('Trusted Types enforced (#1172)', { tag: '@prod' }, () => {
  test('ships the directive with the app and loader policies only', async ({ page }) => {
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("require-trusted-types-for 'script'; trusted-types qrcraftly qrcraftly-loader;");
  });

  test('starts the generator, image resize and service workers and parses SVG and PDF markup without a violation', async ({ page, context }) => {
    const workers = recordWorkers(page);
    const errors = recordTrustedTypesErrors(page);
    await page.reload();
    await page.waitForSelector('main[data-hydrated="true"]');

    // The service worker registered through the policy.
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)).toMatch(/\/sw\.js$/);
    expect(context.serviceWorkers().length).toBeGreaterThan(0);

    // A raster logo goes to the image resize worker; an SVG logo goes through parseInertMarkup and sanitizeSvg.
    await page.getByRole('button', { name: 'Logo', exact: true }).click();
    const logo = page.getByRole('region', { name: 'Logo' }).getByLabel('Upload logo image');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await logo.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByText('Custom Logo')).toBeVisible();
    await expect.poll(() => workers.some((name) => name.startsWith('imageResizeWorker-'))).toBe(true);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0f766e"/></svg>';
    await logo.setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
    await expect(page.getByText('Custom Logo')).toBeVisible();

    // The PDF export reads the SVG scene through parseInertMarkup.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByRole('button', { name: 'Download options' }).click();
        await page.getByRole('group', { name: 'Download options' }).getByRole('radio', { name: 'PDF' }).click();
        await page.getByRole('button', { name: 'Download PDF' }).click();
      })(),
    ]);
    expect(fs.readFileSync(await download.path()).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // The matrix, maze and scannability workers start with the generator.
    expect(workers.some((name) => name.startsWith('worker-matrix-'))).toBe(true);
    expect(workers.some((name) => name.startsWith('worker-maze-'))).toBe(true);
    expect(workers.some((name) => /^worker-[\w-]+\.js$/.test(name) && !/^worker-(matrix|maze)-/.test(name))).toBe(true);

    expect(errors).toEqual([]);
    expect(await readViolations(page)).toEqual([]);
  });

  test('starts every file transfer worker without a violation', async ({ page: receiver, context }) => {
    test.setTimeout(120_000);
    await installSyntheticCamera(context);
    const sender = await context.newPage();
    await recordViolations(sender);
    const senderWorkers = recordWorkers(sender);
    const receiverWorkers = recordWorkers(receiver);
    const errors = [...recordTrustedTypesErrors(sender), ...recordTrustedTypesErrors(receiver)];

    await sender.goto('/file-transfer');
    await sender.waitForSelector('main[data-hydrated="true"]');
    await sender.getByLabel('Choose a file to send').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: randomBytes(512) });
    await sender.getByRole('button', { name: 'Start file transfer' }).click();
    await expect(sender.getByRole('button', { name: 'Stop file transfer' })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => senderWorkers.some((name) => name.startsWith('worker-slice-'))).toBe(true);

    await receiver.goto('/file-transfer/receive');
    await receiver.waitForSelector('main[data-hydrated="true"]');
    // The multi-code reader runs its tile workers next to the reassembly worker (#1142).
    await receiver.getByText('Read several codes per frame (preview)', { exact: true }).click();
    await expect(receiver.getByLabel('Read several codes per frame (preview)')).toBeChecked();
    await receiver.getByRole('button', { name: 'Activate camera scanner' }).click();
    const started = (prefix: string) => receiverWorkers.some((name) => name.startsWith(prefix));
    await relayFrames(sender, receiver, { until: async () => started('worker-reassembly-') && started('worker-tiles-'), timeoutMs: 60_000 });
    expect(started('worker-reassembly-')).toBe(true);
    expect(started('worker-tiles-')).toBe(true);

    expect(errors).toEqual([]);
    expect(await readViolations(sender)).toEqual([]);
    expect(await readViolations(receiver)).toEqual([]);
  });
});
