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
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { renderPhoto } from '../tests/utils/photoFixture';

/**
 * Malicious content at each browser trust boundary (#1350, docs/SECURITY.md): typed payloads,
 * an uploaded SVG logo and the text of a scanned code. These projects bypass the CSP on purpose,
 * so a pass proves the app itself keeps the content inert; the CSP is a second layer.
 */

const HTML_PAYLOAD = `"><img src=x onerror="window.__xss.push('img')"><svg onload="window.__xss.push('svg')"></svg><script>window.__xss.push('script')</script>`;

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="window.__xss.push('logo-onload')">
  <script>window.__xss.push('logo-script')</script>
  <foreignObject width="10" height="10"><img xmlns="http://www.w3.org/1999/xhtml" src="x" onerror="window.__xss.push('logo-foreign')"/></foreignObject>
  <a href="javascript:window.__xss.push('logo-link')"><rect width="10" height="10" fill="#123456"/></a>
  <image href="https://tracker.invalid/pixel.png" width="1" height="1"/>
  <style>rect{fill:url(https://tracker.invalid/fill.svg#p)}</style>
</svg>`;

/** Records any script the payloads manage to run, and any dialog they open. */
async function watchForExecution(page: Page): Promise<() => Promise<string[]>> {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(`dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
  await page.addInitScript(() => {
    (window as unknown as { __xss: string[] }).__xss = [];
    // Force the anchor-download fallback so Playwright observes a download event.
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });
  return async () => [...dialogs, ...(await page.evaluate(() => (window as unknown as { __xss: string[] }).__xss))];
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForSelector('main[data-hydrated="true"]');
}

/** Parses an exported SVG and lists any element or attribute that could run script. */
function activeContentIn(page: Page, svg: string): Promise<string[]> {
  return page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const found: string[] = [];
    for (const element of Array.from(doc.getElementsByTagName('*'))) {
      if (['script', 'foreignobject', 'iframe', 'img', 'a'].includes(element.localName.toLowerCase())) found.push(`<${element.localName}>`);
      for (const attr of Array.from(element.attributes)) {
        if (attr.localName.toLowerCase().startsWith('on')) found.push(attr.name);
        if (attr.localName === 'href' && !/^(#|data:image\/)/.test(attr.value)) found.push(`${attr.name}=${attr.value}`);
      }
    }
    return found;
  }, svg);
}

async function downloadSvg(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Download options' }).click();
      await page.getByRole('radio', { name: 'SVG' }).click();
      await page.getByRole('button', { name: 'Download SVG' }).click();
    })(),
  ]);
  return fs.readFileSync(await download.path(), 'utf8');
}

test.describe('XSS regression (#1350)', () => {
  test('markup typed into the generator stays text in the page and in the SVG export', async ({ page }) => {
    const executed = await watchForExecution(page);
    await open(page, '/text-qr-code');
    await page.locator('#text-content').fill(HTML_PAYLOAD);
    // Wait past the input debounce so the code is redrawn from the payload.
    await page.waitForTimeout(800);
    await expect(page.locator('#text-content')).toHaveValue(HTML_PAYLOAD);

    const svg = await downloadSvg(page);
    expect(svg).toContain('<svg');
    // The text may appear escaped in <desc>, but never as elements or attributes.
    expect(await activeContentIn(page, svg)).toEqual([]);
    expect(await executed()).toEqual([]);
  });

  test('a javascript: link is refused in the link generator', async ({ page }) => {
    const executed = await watchForExecution(page);
    await open(page, '/');
    await page.locator('#url-input').fill(`javascript:window.__xss.push('link')`);
    await page.waitForTimeout(800);
    // The preview never becomes a clickable javascript: link.
    await expect(page.locator('a[href^="javascript:" i]')).toHaveCount(0);
    expect(await executed()).toEqual([]);
  });

  test('a hostile SVG logo is sanitized before it is shown or exported', async ({ page }) => {
    const executed = await watchForExecution(page);
    const external: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('tracker.invalid')) external.push(request.url());
    });
    await open(page, '/');
    await page.getByRole('button', { name: 'Logo', exact: true }).click();
    await page
      .getByRole('region', { name: 'Logo' })
      .getByLabel('Upload logo image')
      .setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(LOGO) });
    await expect(page.getByRole('region', { name: 'Logo' }).getByRole('button', { name: /remove/i }).first()).toBeVisible();

    const svg = await downloadSvg(page);
    expect(await activeContentIn(page, svg)).toEqual([]);
    expect(svg).not.toMatch(/__xss|tracker\.invalid|javascript:/i);
    // The logo itself survived: its embedded image is in the export.
    expect(svg).toMatch(/<image[^>]+href="data:image\//);
    expect(await executed()).toEqual([]);
    expect(external).toEqual([]);
  });

  test('the text of a scanned code is shown as text, never as markup', async ({ page }) => {
    const executed = await watchForExecution(page);
    await open(page, '/qr-code-checker');
    const photo = await renderPhoto(page, HTML_PAYLOAD, { width: 900, height: 700, modulePx: 6 });
    await page.getByLabel('Choose a picture of a QR code').setInputFiles({ name: 'code.jpg', mimeType: 'image/jpeg', buffer: photo });
    await expect(page.getByTestId('scan-result')).toContainText(HTML_PAYLOAD, { timeout: 15_000 });
    await expect(page.getByTestId('scan-result').locator('img, script, svg[onload]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open link' })).toHaveCount(0);
    expect(await executed()).toEqual([]);
  });
});
