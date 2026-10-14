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

test.describe('Focus Management & Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('main[data-hydrated="true"]');
  });

  test('Tab sequences cycle correctly within the dialog panel (focus trap)', async ({ page }) => {
    // Wait for the lazy-loaded Color controls to be rendered and visible
    const fgTextInput = page.locator('input[aria-label="Foreground Hex Code"]');
    await fgTextInput.waitFor({ state: 'visible' });

    // 1. Trigger the Scan Safety Warning Modal by setting low contrast colors via native input prototype setter
    await page.locator('#fg-color').evaluate((el: any) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) {
        setter.call(el, '#e0e0e0');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.locator('#bg-color').evaluate((el: any) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) {
        setter.call(el, '#ffffff');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // Wait for the low contrast warning message to be visible
    const warningAlert = page.getByText(/The contrast ratio is low/i).first();
    await expect(warningAlert).toBeVisible();

    // Opening the download options is never gated, even for an unsafe QR.
    await page.getByRole('button', { name: 'Download options' }).click();
    await expect(page.getByRole('group', { name: 'Download options' })).toBeVisible();
    await expect(page.getByText('This Code May Not Scan')).not.toBeVisible();

    // Downloading triggers the safety gate Modal.
    await page.getByRole('button', { name: 'Download PNG' }).click();

    // The modal should appear
    const modalTitle = page.getByText('This Code May Not Scan');
    await expect(modalTitle).toBeVisible();

    // The first focusable element (Close button 'Close modal') should be focused automatically
    const closeBtn = page.getByRole('button', { name: 'Close modal' });
    await expect(closeBtn).toBeFocused();

    // 2. Tab key sequence navigation cycles through the modal elements
    // Tab -> the primary action: the one-tap fix for the top problem, or Go back
    await page.keyboard.press('Tab');
    const primaryBtn = page.getByRole('button', { name: /^(Go back|Use black on white|Use high error correction|Use the standard pattern|Shrink the logo)$/ });
    await expect(primaryBtn).toBeFocused();

    // Tab -> Export Anyway button
    await page.keyboard.press('Tab');
    const exportAnywayBtn = page.getByRole('button', { name: 'Export anyway' });
    await expect(exportAnywayBtn).toBeFocused();

    // Tab again -> Cycles back to Close button
    await page.keyboard.press('Tab');
    await expect(closeBtn).toBeFocused();

    // Shift+Tab -> Cycles backward to Export Anyway button
    // Using down('Shift') + press('Tab') + up('Shift') for flawless cross-browser compatibility
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    await expect(exportAnywayBtn).toBeFocused();

    // Close the modal to cleanly exit
    await closeBtn.click();
    await expect(modalTitle).not.toBeVisible();
  });

  test('QR types are links: Tab moves between them and arrow keys are not intercepted', async ({ page }) => {
    const typeNav = page.getByRole('navigation', { name: 'QR code types' });
    const urlLink = typeNav.getByRole('link', { name: 'URL' });
    await expect(urlLink).toHaveAttribute('aria-current', 'page');
    await urlLink.focus();

    // Arrow keys leave focus and the route alone
    await page.keyboard.press('ArrowRight');
    await expect(urlLink).toBeFocused();
    await expect(page).toHaveURL(/\/$/);

    // Tab reaches the next type link in document order
    await page.keyboard.press('Tab');
    await expect(typeNav.getByRole('link', { name: 'Text' })).toBeFocused();
  });

  test('Choosing a QR type navigates to its route and the URL, current link and panel agree', async ({ page }) => {
    await page.getByRole('navigation', { name: 'QR code types' }).getByRole('link', { name: 'WiFi' }).click();
    await expect(page).toHaveURL(/\/wifi-qr-code$/);
    await page.waitForSelector('main[data-hydrated="true"]');
    await expect(page.getByRole('navigation', { name: 'QR code types' }).getByRole('link', { name: 'WiFi' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByLabel('Network Name (SSID)')).toBeVisible();
    await expect(page.locator('[role="status"]').first()).toHaveText('WiFi input loaded');
  });
});

test.describe('Keyboard-only create, preview and download (#1354)', () => {
  test('a Wi-Fi code can be filled in and downloaded with Tab, typing and Enter alone', async ({ page }) => {
    // Force the anchor-download fallback so Playwright observes a download event.
    await page.addInitScript(() => Reflect.deleteProperty(window, 'showSaveFilePicker'));
    await page.goto('/wifi-qr-code');
    await page.waitForSelector('main[data-hydrated="true"]');

    const ssid = page.getByLabel('Network Name (SSID)');
    const password = page.getByRole('textbox', { name: 'Password' });
    const download = page.getByRole('button', { name: 'Download PNG' });

    /** Presses Tab until the locator has focus, failing after a fixed number of stops. */
    const tabTo = async (target: typeof ssid): Promise<void> => {
      for (let stop = 0; stop < 40; stop++) {
        await page.keyboard.press('Tab');
        if (await target.evaluate((el) => el === document.activeElement)) return;
      }
      throw new Error('Tab never reached the control');
    };

    await tabTo(ssid);
    await page.keyboard.type('CafeGuest');
    await tabTo(password);
    await page.keyboard.type('hunter22');
    await expect(page.getByTestId('scannability-verdict')).toHaveText('Scans reliably', { timeout: 15000 });

    await tabTo(download);
    const saved = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    expect((await saved).suggestedFilename()).toBe('wifi-CafeGuest.png');
  });
});
