import { test, expect } from './fixtures';

test.describe('Visual Regression Layout Checks', () => {
  test('Standard Desktop Viewport (1280x720)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.waitForSelector('main[data-hydrated="true"]');
    // Wait for the QR preview itself; toHaveScreenshot then waits for two identical frames.
    await expect(page.getByRole('img', { name: /QR Code for/i })).toBeVisible();
    await expect(page).toHaveScreenshot('desktop-standard.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
      threshold: 0.2
    });
  });

  test('Mobile Viewport (375x667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForSelector('main[data-hydrated="true"]');
    // Wait for the QR preview itself; toHaveScreenshot then waits for two identical frames.
    await expect(page.getByRole('img', { name: /QR Code for/i })).toBeVisible();
    await expect(page).toHaveScreenshot('mobile-standard.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
      threshold: 0.2
    });
  });

  test('High Zoom Viewport (480x270)', async ({ page }) => {
    // Simulates a 400% zoom level on a 1920x1080 screen
    await page.setViewportSize({ width: 480, height: 270 });
    await page.goto('/');
    await page.waitForSelector('main[data-hydrated="true"]');
    // Wait for the QR preview itself; toHaveScreenshot then waits for two identical frames.
    await expect(page.getByRole('img', { name: /QR Code for/i })).toBeVisible();
    // The update toast's edges render differently from run to run (about 2% of the pixels on
    // WebKit), so it is masked and the tolerance is the 2% the other views use (#1613).
    await expect(page).toHaveScreenshot('desktop-high-zoom.png', {
      fullPage: false,
      mask: [page.getByRole('status').filter({ hasText: 'A new version of QRCraftly is available.' })],
      maxDiffPixelRatio: 0.02,
      threshold: 0.25
    });
  });
});
