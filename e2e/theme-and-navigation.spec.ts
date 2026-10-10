/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

const isDark = () => document.documentElement.classList.contains('dark');

test.describe('Global theme', () => {
  test('dark theme persists across route families and reloads without a light flash', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.waitForSelector('main[data-hydrated="true"]');

    const toggle = page.getByRole('button', { name: /^Theme: / });
    await toggle.click(); // System -> Light
    await toggle.click(); // Light -> Dark
    await expect(page.getByRole('button', { name: /^Theme: Dark/ })).toBeVisible();
    expect(await page.evaluate(isDark)).toBe(true);

    for (const path of ['/about', '/security', '/file-transfer', '/file-transfer/receive', '/wifi-qr-code']) {
      // Check at DOMContentLoaded, before hydration, to catch a flash of the wrong theme.
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(await page.evaluate(isDark), path).toBe(true);
      expect(await page.evaluate(() => document.documentElement.style.colorScheme), path).toBe('dark');
      await page.waitForSelector('main[data-hydrated="true"]');
      await expect(page.getByRole('button', { name: /^Theme: Dark/ }), path).toBeVisible();
    }

    // Only the documented preference key is stored.
    const keys = await page.evaluate(() => Object.keys(window.localStorage));
    expect(keys).toEqual(['qrcraftly:theme']);
  });

  test('system mode follows prefers-color-scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/about', { waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(isDark)).toBe(true);
    await page.waitForSelector('main[data-hydrated="true"]');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => page.evaluate(isDark)).toBe(false);
  });
});

test.describe('Primary navigation at 320px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const path of ['/', '/about', '/file-transfer']) {
    test(`every primary destination is reachable from ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForSelector('main[data-hydrated="true"]');

      const menuButton = page.getByRole('button', { name: 'Site menu', includeHidden: true });
      await menuButton.click();
      await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
      const menu = page.getByRole('dialog', { name: 'Menu' });
      for (const label of ['Create QR', 'File Transfer', 'Arcade', 'About', 'Security']) {
        await expect(menu.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
      }

      // Escape closes and restores focus
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
      await expect(menuButton).toBeFocused();

      // The header does not overflow horizontally
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('marks the current page', async ({ page }) => {
    await page.goto('/security');
    await page.waitForSelector('main[data-hydrated="true"]');
    await page.getByRole('button', { name: 'Site menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Security' })).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('Security page (#1056)', () => {
  test('keeps its prerendered policies after client-side navigation', async ({ page }) => {
    await page.goto('/about');
    await page.waitForSelector('main[data-hydrated="true"]');
    await page.getByRole('link', { name: 'How we keep it that way' }).click();
    await expect(page).toHaveURL(/\/security$/);
    await expect(page.locator('#security-doc')).toContainText('Content Security Policy');
  });

  test('a deep link opens the collapsed policy and scrolls to the heading', async ({ page }) => {
    await page.goto('/security#compliance-hipaa-and-other-rules');
    await page.waitForSelector('main[data-hydrated="true"]');
    await expect(page.locator('#compliance-hipaa-and-other-rules')).toBeInViewport();
  });
});

test.describe('Download options keyboard support (#1052)', () => {
  test('a format can be chosen without a pointer and Escape restores focus', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('main[data-hydrated="true"]');
    const trigger = page.getByRole('button', { name: 'Download options' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const options = page.getByRole('group', { name: 'Download options' });
    await page.keyboard.press('Tab');
    await expect(options.getByRole('radio', { name: 'PNG' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(options.getByRole('radio', { name: 'SVG' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Download SVG' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(options).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(options).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(options).toHaveCount(0);
  });
});
