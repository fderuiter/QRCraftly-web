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

async function gotoHydrated(page: Page, path: string) {
  await page.goto(path);
  await page.waitForSelector('main[data-hydrated="true"]');
}

test.describe('QR preview is the hero on desktop (#1050)', () => {
  for (const { width, height, min } of [
    { width: 1920, height: 1080, min: 520 },
    { width: 1440, height: 900, min: 520 },
    { width: 1280, height: 720, min: 420 },
  ]) {
    test(`QR renders at least ${min}px at ${width}x${height} with one export control`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoHydrated(page, '/');

      const canvas = page.getByTestId('qr-stage').locator('canvas').first();
      await expect(canvas).toBeVisible();
      const box = await canvas.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(min);
      expect(box!.height).toBeGreaterThanOrEqual(min);
      // Fully visible, with the export control on screen too, without scrolling.
      expect(box!.y + box!.height).toBeLessThanOrEqual(height);
      await expect(page.getByRole('button', { name: 'Download PNG' })).toBeInViewport({ ratio: 1 });

      await expect(page.getByRole('button', { name: 'Download PNG' })).toHaveCount(1);
      await expect(page.getByRole('button', { name: /as PNG/ })).toHaveCount(0);

      // The preview heading stays on one line.
      const heading = page.getByRole('heading', { name: 'Live Preview' });
      const lineHeight = await heading.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
      expect((await heading.boundingBox())!.height).toBeLessThan(lineHeight * 1.5);
    });
  }
});

test.describe('Mobile action bar and mini preview (#1051)', () => {
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 740, height: 360 },
  ]) {
    test(`export bar stays docked and in reach at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await gotoHydrated(page, '/');

      const bar = page.getByTestId('export-actions');
      const download = page.getByRole('button', { name: 'Download PNG' });
      await expect(download).toBeInViewport();
      const barBox = (await bar.boundingBox())!;
      expect(barBox.y + barBox.height).toBeCloseTo(viewport.height, 0);
      expect(barBox.width).toBeLessThanOrEqual(viewport.width);
      expect((await download.boundingBox())!.height).toBeGreaterThanOrEqual(48);

      // Still docked after scrolling the controls.
      await page.mouse.wheel(0, 600);
      await expect(download).toBeInViewport();
    });
  }

  test('a thumbnail mirrors the QR while the style controls are in view', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHydrated(page, '/');

    await expect(page.getByTestId('mini-preview')).toHaveCount(0);
    await page.getByRole('button', { name: 'Pattern & Colors' }).scrollIntoViewIfNeeded();
    const thumb = page.getByTestId('mini-preview');
    await expect(thumb).toBeVisible();
    await expect(thumb).toBeInViewport();

    await thumb.click();
    await expect(page.getByTestId('qr-stage')).toBeInViewport();
    await expect(page.getByTestId('mini-preview')).toHaveCount(0);
  });

  test('the bar steps aside while typing so the keyboard does not cover the field', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHydrated(page, '/');

    const bar = page.getByTestId('export-actions');
    await page.locator('#url-input').focus();
    await expect(bar).toBeHidden();
    await page.locator('#url-input').blur();
    await expect(bar).toBeVisible();
  });

  test('desktop shows no mini preview or docked bar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoHydrated(page, '/');
    await page.getByRole('button', { name: 'Pattern & Colors' }).scrollIntoViewIfNeeded();
    await expect(page.getByTestId('mini-preview')).toBeHidden();
    const position = await page.getByTestId('export-actions').evaluate((el) => getComputedStyle(el).position);
    // In flow (relative only to anchor the Download options panel), not docked.
    expect(position).toBe('relative');
  });
});

test.describe('Text codes keep line breaks (#1269)', () => {
  test('pressing Enter in the Text box is kept after the edit is saved', async ({ page }) => {
    await gotoHydrated(page, '/text-qr-code/');
    const content = page.locator('#text-content');
    await content.click();
    await content.pressSequentially('Line one');
    await content.press('Enter');
    await content.pressSequentially('Line two');
    await content.press('Tab');
    // Wait past the input debounce so the stored value has come back to the field.
    await page.waitForTimeout(800);
    await expect(content).toHaveValue('Line one\nLine two');
  });
});
