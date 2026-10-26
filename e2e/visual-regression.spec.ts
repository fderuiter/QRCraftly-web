import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Loads the generator and waits until the preview has settled: the QR image is drawn and the
 * scannability check has left "Checking…". Without the second wait a slow runner photographs
 * the pill mid-check, and that frame ended up in a baseline (#1662).
 * @param page The page under test.
 */
async function gotoSettledGenerator(page: Page) {
  await page.goto('/');
  await page.waitForSelector('main[data-hydrated="true"]');
  await expect(page.getByRole('img', { name: /QR Code for/i })).toBeVisible();
  await expect(page.getByTestId('scannability-verdict')).not.toHaveText('Checking…');
}

test.describe('Visual Regression Layout Checks', () => {
  // A service worker can raise the "new version" toast mid-test, over the content (#1662).
  test.use({ serviceWorkers: 'block' });

  test('Standard Desktop Viewport (1280x720)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    // toHaveScreenshot then waits for two identical frames.
    await gotoSettledGenerator(page);
    await expect(page).toHaveScreenshot('desktop-standard.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
      threshold: 0.2
    });
  });

  test('Mobile Viewport (375x667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    // toHaveScreenshot then waits for two identical frames.
    await gotoSettledGenerator(page);
    await expect(page).toHaveScreenshot('mobile-standard.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
      threshold: 0.2
    });
  });

  test('High Zoom Viewport (480x270)', async ({ page }) => {
    // Simulates a 400% zoom level on a 1920x1080 screen
    await page.setViewportSize({ width: 480, height: 270 });
    // toHaveScreenshot then waits for two identical frames.
    await gotoSettledGenerator(page);
    await expect(page).toHaveScreenshot('desktop-high-zoom.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
      threshold: 0.25
    });
  });
});
