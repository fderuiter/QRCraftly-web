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
import { installSyntheticCamera, relayFrames } from './utils/opticalLink';

interface RecordedViolation {
  directive: string;
  blockedURI: string;
}

declare global {
  interface Window {
    __cspViolations?: RecordedViolation[];
    __workerScripts?: string[];
  }
}

async function readViolations(page: Page): Promise<RecordedViolation[]> {
  return page.evaluate(() => window.__cspViolations ?? []);
}

/** Records each worker's script path in `window.__workerScripts`; the subclass hands the TrustedScriptURL on untouched. */
function recordWorkerScripts() {
  window.__workerScripts = [];
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      window.__workerScripts?.push(new URL(String(url), location.href).pathname);
    }
  };
}

test.beforeEach(async ({ page }, testInfo) => {
  expect(testInfo.project.use.bypassCSP, 'this suite must run with the CSP enforced').toBe(false);

  await page.addInitScript(recordWorkerScripts);

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
  const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123456"/></svg>';
  const LOGO_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

  const workerScripts = (page: Page) => page.evaluate(() => window.__workerScripts ?? []);
  const expectWorker = async (page: Page, name: RegExp) => {
    await expect.poll(async () => (await workerScripts(page)).some((url) => name.test(url)), { timeout: 20_000 }).toBe(true);
  };

  /** Fails the test on any Trusted Types or other CSP violation, and on any uncaught page error. */
  const watch = (page: Page) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    return async () => {
      expect(errors).toEqual([]);
      expect(await readViolations(page)).toEqual([]);
    };
  };

  test('ships the Trusted Types directives with the three named policies', async ({ page }) => {
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).toContain('trusted-types qrcraftly-script-url qrcraftly-inert-markup qrcraftly-page-loader;');
  });

  test('starts the generator workers, registers the service worker and parses uploaded and exported SVG', async ({ page }) => {
    const check = watch(page);
    await page.reload();
    await page.waitForSelector('main[data-hydrated="true"]');
    await page.locator('#url-input').fill('https://qrcraftly.com/trusted-types');
    await expect(page.getByTestId('scannability-verdict')).toHaveText('Scans reliably', { timeout: 20_000 });
    await expectWorker(page, /worker-matrix/);
    expect(await workerScripts(page)).not.toEqual([]);
    expect(await page.evaluate(() => navigator.serviceWorker.ready.then((registration) => new URL(registration.active?.scriptURL ?? '').pathname))).toBe('/sw.js');

    // An SVG logo goes through DOMParser twice (drawability check, sanitizeSvg); a PNG through the resize worker.
    await page.getByRole('button', { name: 'Logo', exact: true }).click();
    const upload = page.getByRole('region', { name: 'Logo' }).getByLabel('Upload logo image');
    await upload.setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(LOGO_SVG) });
    await expect(page.getByText('Custom Logo')).toBeVisible();
    await upload.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: LOGO_PNG });
    await expectWorker(page, /imageResizeWorker/);

    // PDF export reads the SVG export back through DOMParser (sceneReader).
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByRole('button', { name: 'Download options' }).click();
        await page.getByRole('group', { name: 'Download options' }).getByRole('radio', { name: 'PDF' }).click();
        await page.getByRole('button', { name: 'Download PDF' }).click();
      })(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    await check();
  });

  test('starts the maze worker for a design with the maze overlay', async ({ page }) => {
    const check = watch(page);
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import template from JSON file' }).click();
    await (await chooser).setFiles({ name: 'maze.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ name: 'Maze', config: { isMazeEnabled: true } })) });
    await page.getByRole('button', { name: 'Apply Maze template' }).click();
    await expectWorker(page, /worker-maze/);
    await check();
  });

  test('moves between pages with client-side navigation and opens the security docs', async ({ page }) => {
    const check = watch(page);
    const nav = page.getByRole('navigation').first();
    await nav.getByRole('link', { name: 'About', exact: true }).click();
    await page.waitForURL('**/about');
    await nav.getByRole('link', { name: 'Security', exact: true }).click();
    await page.waitForURL('**/security');
    await page.waitForSelector('main[data-hydrated="true"]');
    await expect(page.locator('#security-doc')).toContainText('Trusted Types');
    await nav.getByRole('link', { name: 'Create QR', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.locator('#url-input')).toBeVisible();
    await check();
  });

  test('sends and receives a file through every optical transfer worker', async ({ page: receiver, context }) => {
    test.setTimeout(150_000);
    await installSyntheticCamera(context);
    const sender = await context.newPage();
    await sender.addInitScript(recordWorkerScripts);
    const checkSender = watch(sender);
    const checkReceiver = watch(receiver);

    await sender.goto('/file-transfer');
    await sender.waitForSelector('main[data-hydrated="true"]');
    await sender.getByLabel('Choose a file to send').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('Trusted Types '.repeat(64)) });
    await sender.getByRole('button', { name: 'Start file transfer' }).click();
    await expect(sender.getByRole('button', { name: 'Stop file transfer' })).toBeVisible({ timeout: 20_000 });
    await expectWorker(sender, /worker-slice/);

    await receiver.goto('/file-transfer/receive');
    await receiver.waitForSelector('main[data-hydrated="true"]');
    // Several codes per frame reads through the tile worker as well as the scanner worker.
    await receiver.getByText('Read several codes per frame (preview)', { exact: true }).click();
    await receiver.getByRole('button', { name: 'Activate camera scanner' }).click();
    await relayFrames(sender, receiver, { until: () => receiver.getByTestId('inline-complete-panel').isVisible(), timeoutMs: 90_000 });
    for (const worker of [/worker-tiles/, /worker-reassembly/]) await expectWorker(receiver, worker);

    await checkSender();
    await checkReceiver();
  });
});
