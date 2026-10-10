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

/*
 * Blocked site data (#1263): with "Block sites from saving data" (or Firefox cookieBehavior=2),
 * merely reading `window.localStorage` throws `SecurityError`. The Appearance panel must keep
 * working, with custom templates simply unavailable.
 */

import { test, expect } from './fixtures';

test('the Appearance panel works when the browser blocks site data', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });

  await page.goto('/');
  await page.waitForSelector('main[data-hydrated="true"]');

  await expect(page.locator('input[aria-label="Foreground Hex Code"]')).toBeVisible();
  await expect(page.locator('#fg-color')).toBeAttached();
  await expect(page.getByText('This panel hit a snag.')).toHaveCount(0);

  await page.getByRole('tab', { name: /my templates/i }).click();
  await expect(page.getByText('Custom templates are unavailable.')).toBeVisible();
});
