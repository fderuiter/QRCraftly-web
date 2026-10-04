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

import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function openGenerator(page: Page, value = 'https://qrcraftly.com/mockups') {
  await page.goto('/');
  await page.waitForSelector('main[data-hydrated="true"]');
  const input = page.locator('#url-input');
  await input.waitFor({ state: 'visible' });
  await input.fill(value);
  await page.waitForSelector('canvas[role="img"]');
}

const views = (page: Page) => page.getByRole('radiogroup', { name: 'In the wild' });

test.describe('In the wild mockups (#1060)', () => {
  test('every scene is drawn from code: no image, font or outside request is made', async ({ page }) => {
    await openGenerator(page);
    const requests: { url: string; type: string }[] = [];
    page.on('request', (request) => requests.push({ url: request.url(), type: request.resourceType() }));

    for (const scene of ['Poster', 'Card', 'Table tent', 'Screen', 'Sticker']) {
      await views(page).getByRole('radio', { name: scene }).click();
      await expect(page.getByTestId('mockup-qr')).toBeVisible();
    }

    const origin = new URL(page.url()).origin;
    expect(requests.filter((request) => request.type === 'image' || request.type === 'font')).toEqual([]);
    expect(requests.filter((request) => !request.url.startsWith(origin) && !request.url.startsWith('data:') && !request.url.startsWith('blob:'))).toEqual([]);
  });

  test('the printed width sets the scan distance, and a tiny print is flagged', async ({ page }) => {
    await openGenerator(page, 'https://qrcraftly.com/a-rather-long-address/with/many/segments/so/the/code/is/dense?x=1');
    await views(page).getByRole('radio', { name: 'Card' }).click();

    const guidance = page.getByTestId('mockup-guidance');
    const warning = page.getByTestId('mockup-view').getByRole('alert');
    await expect(guidance).toContainText('A phone scans it from about');
    const width = page.getByLabel('Printed width');
    await width.fill('6');
    await expect(warning).toHaveCount(0);
    const large = await guidance.textContent();

    await width.fill('1.5');
    await expect(warning).toContainText('Too small for this content');
    expect(await guidance.textContent()).not.toBe(large);
  });

  test('the viewing test decodes the live code under each condition and reports pass or fail', async ({ page }) => {
    await openGenerator(page);
    await views(page).getByRole('radio', { name: 'Poster' }).click();
    await page.getByLabel('Printed width').fill('5');
    await page.getByRole('button', { name: 'Test real-world conditions' }).click();

    const results = page.getByTestId('viewing-results');
    await expect(results.getByRole('listitem')).toHaveCount(7, { timeout: 30_000 });
    await expect(results.getByRole('listitem').filter({ hasText: 'As designed' })).toContainText('Still scans');
    // A 5 cm print read from 3 m is only a few pixels per module, so it cannot be read.
    await expect(results.getByRole('listitem').filter({ hasText: 'From 3.0 m away' })).toContainText('Fails to scan');
  });

  test('the scene downloads as a PNG made on the device', async ({ page }) => {
    await openGenerator(page);
    await views(page).getByRole('radio', { name: 'Screen' }).click();
    await expect(page.getByTestId('mockup-qr')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download mockup PNG' }).click();
    expect((await download).suggestedFilename()).toBe('qrcraftly-screen-mockup.png');
  });

  test('the flat preview stays and the scene goes away on Flat', async ({ page }) => {
    await openGenerator(page);
    await views(page).getByRole('radio', { name: 'Sticker' }).click();
    await expect(page.getByTestId('qr-stage')).toBeVisible();
    await views(page).getByRole('radio', { name: 'Flat' }).click();
    await expect(page.getByTestId('mockup-view')).toHaveCount(0);
  });
});
