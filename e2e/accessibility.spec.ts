import { test, expect } from './fixtures';
import { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ROUTES, gotoHydrated } from './utils/routes';

/**
 * Custom auditing helper that filters out native browser color input artifacts.
 * This prevents false-positive WCAG failures from empty or default color picker frames.
 */
async function runAccessibilityScan(page: Page) {
  // Let enter animations (the dialog fade and pop-in) finish, so axe measures final colours.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('input[type="color"]') // Filter out native browser color pickers
    .analyze();

  return accessibilityScanResults;
}

test.describe('Accessibility Suite', () => {
  test('dynamic UI patterns and accordions pass WCAG audits', async ({ page }) => {
    await page.goto('/');
    
    // Wait for the app to hydrate
    await page.waitForSelector('main[data-hydrated="true"]');

    // Expand accordion panels if any are present
    const accordions = await page.locator('button[aria-expanded="false"]').all();
    for (const accordion of accordions) {
      if (await accordion.isVisible()) {
        await accordion.click();
      }
    }
    
    // Run scan on expanded state
    const expandedScan = await runAccessibilityScan(page);
    expect(expandedScan.violations).toEqual([]);
    
    // Create custom-colored layouts and trigger a warning
    const fgColorInput = page.locator('input#fg-color');
    await fgColorInput.fill('#ffffff');

    const bgColorInput = page.locator('input#bg-color');
    await bgColorInput.fill('#ffffff');

    const eyeColorInput = page.locator('input#eye-frame-color');
    await eyeColorInput.fill('#ff0000');

    // Wait for contrast warning text
    await page.waitForSelector('text=Warning: The contrast ratio is low', { timeout: 5000 });

    // Trigger the warning modal by downloading
    await page.getByRole('button', { name: 'Download PNG' }).click();
    await page.waitForSelector('text=Scan Safety Warning', { timeout: 5000 });

    // Run scan on warning state
    const warningScan = await runAccessibilityScan(page);
    expect(warningScan.violations).toEqual([]);
  });
});

/*
 * Every route in both colour themes (#1057). The theme follows the system preference by
 * default, so emulating `prefers-color-scheme` switches it before the first paint.
 */
for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`Axe audit of every route (${colorScheme} theme)`, () => {
    test.use({ colorScheme });

    for (const route of ROUTES) {
      test(`${route} has no WCAG A/AA violations`, async ({ page }) => {
        await gotoHydrated(page, route);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
        const results = await runAccessibilityScan(page);
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  });
}
