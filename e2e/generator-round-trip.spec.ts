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

import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Makes a code in the generator, downloads the PNG, and reads it back with the QR code checker,
 * so the whole path a person takes is covered in a real browser: eye shapes (#1465), the UPI
 * preset (#1469) and vCard social profiles (#1470).
 */

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForSelector('main[data-hydrated="true"]');
}

async function downloadPng(page: Page): Promise<Buffer> {
  const done = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download options' }).click();
  await page.getByRole('group', { name: 'Download options' }).getByRole('radio', { name: 'PNG' }).click();
  await page.getByRole('button', { name: 'Download PNG' }).click();
  const download = await done;
  const path = await download.path();
  return readFile(path);
}

async function readBack(page: Page, png: Buffer): Promise<string> {
  await open(page, '/qr-code-checker');
  await page.getByLabel('Choose a picture of a QR code').setInputFiles({ name: 'code.png', mimeType: 'image/png', buffer: png });
  const content = page.getByTestId('scan-result').locator('pre');
  await expect(content).toBeVisible({ timeout: 15_000 });
  return (await content.textContent()) ?? '';
}

test.describe('Generator round trip: download, then read back with the checker', () => {
  test.beforeEach(async ({ page }) => {
    // Force the anchor-download fallback so Playwright observes a download event.
    await page.addInitScript(() => Reflect.deleteProperty(window, 'showSaveFilePicker'));
  });

  test('a code with a leaf eye frame and circle eye balls still reads', async ({ page }) => {
    await open(page, '/');
    await page.locator('#url-input').fill('https://example.com/eyes');
    await page.getByRole('radio', { name: 'Eye frame shape: Leaf' }).click();
    await page.getByRole('radio', { name: 'Eye ball shape: Circle' }).click();
    await expect(page.getByRole('radio', { name: 'Eye frame shape: Leaf' })).toBeChecked();

    expect(await readBack(page, await downloadPng(page))).toBe('https://example.com/eyes');
  });

  test('a UPI payment code reads back as a upi://pay link in rupees', async ({ page }) => {
    await open(page, '/payment-qr-code');
    await page.getByLabel('Currency / Network').selectOption({ label: 'UPI (India)' });
    await page.getByLabel('UPI ID').fill('jane@okaxis');
    await page.getByLabel('Payee Name').fill('Jane Doe');
    await page.getByLabel('Amount (INR)').fill('250');

    const text = await readBack(page, await downloadPng(page));
    expect(text).toMatch(/^upi:\/\/pay\?/);
    const params = new URL(text).searchParams;
    expect(params.get('pa')).toBe('jane@okaxis');
    expect(params.get('pn')).toBe('Jane Doe');
    expect(params.get('am')).toBe('250');
    expect(params.get('cu')).toBe('INR');
  });

  test('a vCard with social profiles reads back with a URL line per profile', async ({ page }) => {
    await open(page, '/vcard-qr-code');
    await page.getByLabel('First Name').fill('Jane');
    await page.getByLabel('Last Name').fill('Doe');
    await page.getByLabel('GitHub').fill('@janedoe');
    await page.getByLabel('LinkedIn').fill('linkedin.com/in/janedoe');

    const text = await readBack(page, await downloadPng(page));
    expect(text).toMatch(/^BEGIN:VCARD/);
    expect(text).toMatch(/URL;TYPE=github:https:\/\/github\.com\/janedoe/i);
    expect(text).toMatch(/URL;TYPE=linkedin:https:\/\/(www\.)?linkedin\.com\/in\/janedoe/i);
  });
});
