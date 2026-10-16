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

// python's static server (used locally) adds a trailing slash to directory routes, so both forms are accepted.
const arcadeUrl = (mode?: string) => new RegExp(`/arcade/?${mode ? `\\?mode=${mode}` : ''}$`);

test.describe('QR Arcade', () => {
  test('switches between the two modes and keeps the mode in the URL', async ({ page }) => {
    await page.goto('/arcade');
    await page.waitForSelector('main[data-hydrated="true"]');
    await expect(page.getByRole('heading', { level: 1, name: 'QR Arcade & Durability Lab' })).toBeVisible();

    const tabs = page.getByRole('tablist', { name: 'Arcade mode' });
    const blaster = tabs.getByRole('tab', { name: 'Arcade Blaster' });
    const simulator = tabs.getByRole('tab', { name: 'Damage Simulator' });
    await expect(blaster).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('arcade-blaster-canvas')).toBeVisible();

    await simulator.click();
    await expect(simulator).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(arcadeUrl('simulator'));
    await expect(page.getByRole('button', { name: 'Reset Grid' }).first()).toBeAttached();

    // Arrow keys move between tabs (roving tabindex).
    await simulator.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(blaster).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(arcadeUrl('blaster'));

    await page.goto('/arcade?mode=simulator');
    await page.waitForSelector('main[data-hydrated="true"]');
    await expect(simulator).toHaveAttribute('aria-selected', 'true');
  });

  for (const [legacy, mode] of [
    ['/game', 'simulator'],
    ['/destroy-the-qr', 'blaster'],
  ] as const) {
    test(`redirects ${legacy} to the ${mode} mode`, async ({ page }) => {
      await page.goto(legacy);
      await expect(page).toHaveURL(arcadeUrl(mode));
      await page.waitForSelector('main[data-hydrated="true"]');
      await expect(page.getByRole('tab', { name: mode === 'simulator' ? 'Damage Simulator' : 'Arcade Blaster' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });
  }

  test('Stress Test in Arcade carries the design in memory, never in the URL', async ({ page }) => {
    const payload = 'https://example.com/arcade-e2e-handoff';
    await page.goto('/');
    await page.waitForSelector('main[data-hydrated="true"]');
    await page.locator('#url-input').fill(payload);

    await page.getByRole('button', { name: 'Stress Test in Arcade' }).click();
    await expect(page).toHaveURL(arcadeUrl());
    expect(page.url()).not.toContain('example.com');

    await expect(page.getByRole('textbox', { name: 'Target QR content' })).toHaveValue(payload);
    await expect(page.getByRole('button', { name: 'Use my generator design' })).toBeVisible();
  });

  test('displays error alert with retry button when WASM encoder fails to load and recovers on retry', async ({ page }) => {
    await page.route('**/*qr-encode*.wasm', (route) => route.abort('failed'));
    await page.goto('/arcade');
    await expect(page.getByTestId('arcade-error-fallback')).toBeVisible();
    await expect(page.getByTestId('arcade-retry-button')).toBeVisible();
    await expect(page.getByText('QR Encoder Initialization Failed')).toBeVisible();

    await page.unroute('**/*qr-encode*.wasm');
    await page.getByTestId('arcade-retry-button').click();
    await expect(page.getByTestId('arcade-blaster-canvas')).toBeVisible();
  });
});
