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

import { test, expect } from '@playwright/test';

test.describe('vCard Social Profile Input Fields', () => {
  test('Renders social profile fields and captures screenshot', async ({ page }) => {
    await page.goto('/vcard-qr-code');

    const twitterInput = page.locator('#vcard-twitter');
    const linkedinInput = page.locator('#vcard-linkedin');
    const instagramInput = page.locator('#vcard-instagram');
    const facebookInput = page.locator('#vcard-facebook');
    const githubInput = page.locator('#vcard-github');

    await expect(twitterInput).toBeVisible();
    await expect(linkedinInput).toBeVisible();
    await expect(instagramInput).toBeVisible();
    await expect(facebookInput).toBeVisible();
    await expect(githubInput).toBeVisible();

    await page.fill('#vcard-firstname', 'Jane');
    await page.fill('#vcard-lastname', 'Doe');
    await page.fill('#vcard-twitter', '@janedoe');
    await page.fill('#vcard-linkedin', 'https://linkedin.com/in/janedoe');
    await page.fill('#vcard-github', 'janedoe');

    await page.screenshot({ path: '/tmp/vcard_social_profiles.png', fullPage: true });
  });
});
