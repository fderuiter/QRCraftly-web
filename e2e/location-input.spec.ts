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
import { FIXTURES } from "../tests/fixtures/data";

/**
 * End-to-end tests for the "Use Current Location" geolocation feature
 * on the Location QR type input.
 */

// Navigate to the homepage and activate the Location QR type before each test.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('main[data-hydrated="true"]');
  // Wait for all network requests to settle so React has fully hydrated
  await page.getByRole('navigation', { name: 'QR code types' }).getByRole('link', { name: 'Location' }).click();
  await page.waitForURL(/\/location-qr-code$/);
  // Wait for the form to be fully rendered
  await page.getByTestId('use-current-location').waitFor({ state: 'visible' });
});

test.describe('Location QR type', () => {
  test('renders Latitude and Longitude fields and the Use Current Location button', async ({ page }) => {
    await expect(page.getByLabel('Latitude')).toBeVisible();
    await expect(page.getByLabel('Longitude')).toBeVisible();
    await expect(page.getByTestId('use-current-location')).toBeVisible();
  });

  test('manually entering coordinates generates a QR code', async ({ page }) => {
    await page.getByLabel('Latitude').fill(FIXTURES.coordinates.newYork.latitude);
    await page.getByLabel('Longitude').fill(FIXTURES.coordinates.newYork.longitude);

    // The QR canvas description should update once valid coordinates are provided
    await expect(page.getByRole('img', { name: /qr code for location/i })).toBeVisible();
  });

  test('"Use Current Location" fills fields and generates QR when permission is granted', async ({ page, context }) => {
    // Grant geolocation permission and mock coordinates via the browser context
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 51.5074, longitude: -0.1278 });

    await page.getByTestId('use-current-location').click();

    // Latitude and longitude fields should be populated
    await expect(page.getByLabel('Latitude')).toHaveValue('51.5074');
    await expect(page.getByLabel('Longitude')).toHaveValue('-0.1278');

    // A valid QR code should be rendered (the image name drops "nothing entered yet")
    await expect(page.getByRole('img', { name: 'QR code for Location', exact: true })).toBeVisible();
  });

  test('geolocation error banner shows Dismiss control and clears on manual edit', async ({ page }) => {
    // Override navigator.geolocation to simulate permission denied
    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition = (_success, error) => {
        if (error) {
          error({
            code: 1,
            message: 'User denied Geolocation',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } satisfies GeolocationPositionError);
        }
      };
    });

    await page.getByTestId('use-current-location').click();

    const alert = page.getByRole('group', { name: 'Geo-Location' }).getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Location access denied');

    const dismissBtn = alert.getByRole('button', { name: 'Dismiss alert' });
    await expect(dismissBtn).toBeVisible();

    // Click Dismiss -> clears error
    await dismissBtn.click();
    await expect(alert).not.toBeVisible();

    // Re-trigger error
    await page.getByTestId('use-current-location').click();
    await expect(alert).toBeVisible();

    // Type in Latitude -> clears error
    await page.getByLabel('Latitude').fill('40.7128');
    await expect(alert).not.toBeVisible();
  });
});
