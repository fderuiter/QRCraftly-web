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
import fs from 'fs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads the actual pixel dimensions of the QR canvas element by evaluating
 * its `.width` and `.height` attributes (the internal canvas resolution,
 * independent of CSS layout size).
 */
async function getCanvasInternalSize(page: Parameters<typeof test>[1] extends (...args: any[]) => any ? never : any) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('No canvas found');
    return { width: canvas.width, height: canvas.height };
  });
}

// ---------------------------------------------------------------------------
// Setup – navigate and wait for the app to be fully rendered
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as any).showSaveFilePicker;
  });
  await page.goto('/');
  await page.waitForSelector('main[data-hydrated="true"]');
  // StyleControls lazy-loads; Export Layout lives in the collapsed "Layout & Border" accordion section.
  await page.getByRole('button', { name: 'Layout & Border' }).click();
  await page.getByText('Export Layout').waitFor({ state: 'visible' });
});

// ---------------------------------------------------------------------------
// 1. Export Layout section visibility
// ---------------------------------------------------------------------------

test.describe('Export Layout section', () => {
  test('renders the Export Layout heading', async ({ page }) => {
    await expect(page.getByText('Export Layout')).toBeVisible();
  });

  test('renders Aspect Ratio label and three format buttons', async ({ page }) => {
    await expect(page.getByText('Aspect Ratio')).toBeVisible();
    await expect(page.getByRole('radio', { name: /Select Square format/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Select Portrait format/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Select Story format/i })).toBeVisible();
  });

  test('renders Template label and four style buttons', async ({ page }) => {
    await expect(page.getByText('Template', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Select None template/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Select Minimalist template/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Select Gradient template/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Select Solid Frame template/i })).toBeVisible();
  });

  test('Square and None are selected by default (aria-checked=true)', async ({ page }) => {
    await expect(page.getByRole('radio', { name: /Select Square format/i })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /Select None template/i })).toHaveAttribute('aria-checked', 'true');
  });
});

// ---------------------------------------------------------------------------
// 2. Aspect Ratio selection
// ---------------------------------------------------------------------------

test.describe('Aspect Ratio selection', () => {
  test('clicking Portrait marks it as pressed and deselects Square', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Portrait format/i }).click();

    await expect(page.getByRole('radio', { name: /Select Portrait format/i })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /Select Square format/i })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('radio', { name: /Select Story format/i })).toHaveAttribute('aria-checked', 'false');
  });

  test('clicking Story marks it as pressed', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Story format/i }).click();

    await expect(page.getByRole('radio', { name: /Select Story format/i })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /Select Square format/i })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('radio', { name: /Select Portrait format/i })).toHaveAttribute('aria-checked', 'false');
  });

  test('clicking Square after Story restores Square as pressed', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Story format/i }).click();
    await page.getByRole('radio', { name: /Select Square format/i }).click();

    await expect(page.getByRole('radio', { name: /Select Square format/i })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /Select Story format/i })).toHaveAttribute('aria-checked', 'false');
  });
});

// ---------------------------------------------------------------------------
// 3. Canvas aspect ratio changes when format changes
// ---------------------------------------------------------------------------

test.describe('Canvas aspect ratio reflects selected format', () => {
  test('canvas wrapper has aspect-ratio 1/1 by default (Square)', async ({ page }) => {
    // The outer div has inline style aspect-ratio: 1080/1080
    const wrapper = page.locator('.aspect-square, .aspect-\\[4\\/5\\], .aspect-\\[9\\/16\\]').first();
    const className = await wrapper.getAttribute('class');
    expect(className).toContain('aspect-square');
  });

  test('canvas wrapper aspect-ratio changes to 1080/1350 for Portrait', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Portrait format/i }).click();

    // Wait for re-render
    const canvas = page.locator('canvas:not([aria-hidden])');
    await expect(canvas).toBeVisible();

    const wrapper = page.locator('.aspect-\\[4\\/5\\]').first();
    await expect(wrapper).toHaveClass(/aspect-\[4\/5\]/);
  });

  test('canvas wrapper aspect-ratio changes to 1080/1920 for Story', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Story format/i }).click();

    const wrapper = page.locator('.aspect-\\[9\\/16\\]').first();
    await expect(wrapper).toHaveClass(/aspect-\[9\/16\]/);
  });
});

// ---------------------------------------------------------------------------
// 4. Canvas internal pixel dimensions
// ---------------------------------------------------------------------------

test.describe('Canvas internal pixel dimensions', () => {
  test('canvas is square by default (width == height)', async ({ page }) => {
    // Wait for the debounced first render instead of sleeping a fixed time
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas');
      return !!c && c.width > 0 && c.height > 0;
    });
    const { width, height } = await getCanvasInternalSize(page);
    expect(width).toBe(height);
  });

  test('canvas height is 1350/1080 × width after switching to Portrait', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Portrait format/i }).click();
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas');
      return c && c.width !== c.height;
    });
    const { width, height } = await getCanvasInternalSize(page);
    // height should be ≈ 1350/1080 × width
    expect(height).toBeCloseTo(Math.round(width * 1350 / 1080), -1);
  });

  test('canvas height is 1920/1080 × width after switching to Story', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Story format/i }).click();
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas');
      return c && c.width !== c.height;
    });
    const { width, height } = await getCanvasInternalSize(page);
    expect(height).toBeCloseTo(Math.round(width * 1920 / 1080), -1);
  });
});

// ---------------------------------------------------------------------------
// 5. Template style selection
// ---------------------------------------------------------------------------

test.describe('Template style selection', () => {
  test('clicking Minimalist marks it as pressed and deselects None', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Minimalist template/i }).click();

    await expect(page.getByRole('radio', { name: /Select Minimalist template/i })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /Select None template/i })).toHaveAttribute('aria-checked', 'false');
  });

  test('clicking Gradient marks it as pressed', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Gradient template/i }).click();

    await expect(page.getByRole('radio', { name: /Select Gradient template/i })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /Select None template/i })).toHaveAttribute('aria-checked', 'false');
  });

  test('clicking Solid Frame marks it as pressed', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Solid Frame template/i }).click();

    await expect(page.getByRole('radio', { name: /Select Solid Frame template/i })).toHaveAttribute('aria-checked', 'true');
  });

  test('clicking None after Minimalist restores None as pressed', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Minimalist template/i }).click();
    await page.getByRole('radio', { name: /Select None template/i }).click();

    await expect(page.getByRole('radio', { name: /Select None template/i })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /Select Minimalist template/i })).toHaveAttribute('aria-checked', 'false');
  });
});

// ---------------------------------------------------------------------------
// 6. Headline / subtext inputs – conditional visibility
// ---------------------------------------------------------------------------

test.describe('Headline and subtext inputs', () => {
  test('headline and subtext inputs are hidden when template=None', async ({ page }) => {
    await expect(page.getByLabel('Template headline')).not.toBeVisible();
    await expect(page.getByLabel('Template subtext')).not.toBeVisible();
  });

  test('headline and subtext inputs appear when Minimalist is selected', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Minimalist template/i }).click();

    await expect(page.getByLabel('Template headline')).toBeVisible();
    await expect(page.getByLabel('Template subtext')).toBeVisible();
  });

  test('headline and subtext inputs appear when Gradient is selected', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Gradient template/i }).click();

    await expect(page.getByLabel('Template headline')).toBeVisible();
    await expect(page.getByLabel('Template subtext')).toBeVisible();
  });

  test('headline and subtext inputs appear when Solid Frame is selected', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Solid Frame template/i }).click();

    await expect(page.getByLabel('Template headline')).toBeVisible();
    await expect(page.getByLabel('Template subtext')).toBeVisible();
  });

  test('inputs are hidden again when switching back to None', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Minimalist template/i }).click();
    await expect(page.getByLabel('Template headline')).toBeVisible();

    await page.getByRole('radio', { name: /Select None template/i }).click();
    await expect(page.getByLabel('Template headline')).not.toBeVisible();
    await expect(page.getByLabel('Template subtext')).not.toBeVisible();
  });

  test('headline input accepts text and reflects the value', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Minimalist template/i }).click();

    const headlineInput = page.getByLabel('Template headline');
    await headlineInput.fill('Scan Me!');
    await expect(headlineInput).toHaveValue('Scan Me!');
  });

  test('subtext input accepts text and reflects the value', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Gradient template/i }).click();

    const subtextInput = page.getByLabel('Template subtext');
    await subtextInput.fill('@qrcraftly');
    await expect(subtextInput).toHaveValue('@qrcraftly');
  });

  test('headline input has correct placeholder text', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Solid Frame template/i }).click();

    await expect(page.getByLabel('Template headline')).toHaveAttribute('placeholder', /Headline/i);
  });

  test('subtext input has correct placeholder text', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Solid Frame template/i }).click();

    await expect(page.getByLabel('Template subtext')).toHaveAttribute('placeholder', /Subtext/i);
  });
});

// ---------------------------------------------------------------------------
// 7. Live canvas remains a valid QR code after switching formats/templates
// ---------------------------------------------------------------------------

test.describe('Live QR canvas after format/template changes', () => {
  test('QR canvas is visible after switching to Portrait format', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Portrait format/i }).click();

    await expect(page.getByRole('img', { name: /QR Code for/i })).toBeVisible();
    await expect(page.getByRole('img', { name: /^QR code for [^,]+$/i })).toBeVisible();
  });

  test('QR canvas is visible after switching to Story format', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Story format/i }).click();

    await expect(page.getByRole('img', { name: /QR Code for/i })).toBeVisible();
    await expect(page.getByRole('img', { name: /^QR code for [^,]+$/i })).toBeVisible();
  });

  test('QR canvas is visible after selecting Minimalist template', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Minimalist template/i }).click();

    await expect(page.getByRole('img', { name: /QR Code for/i })).toBeVisible();
  });

  test('QR canvas is visible after selecting Gradient Blur template', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Gradient template/i }).click();

    await expect(page.getByRole('img', { name: /QR Code for/i })).toBeVisible();
  });

  test('QR canvas is visible after selecting Solid Frame template', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Solid Frame template/i }).click();

    await expect(page.getByRole('img', { name: /QR Code for/i })).toBeVisible();
  });

  test('QR canvas still visible after Story format + Minimalist template combination', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Story format/i }).click();
    await page.getByRole('radio', { name: /Select Minimalist template/i }).click();

    await expect(page.getByRole('img', { name: /QR Code for/i })).toBeVisible();
  });

  test('QR canvas updates when headline text is entered', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Minimalist template/i }).click();
    await page.getByLabel('Template headline').fill('Hello World');

    // Canvas should still be alive with a scannable image
    await expect(page.getByRole('img', { name: /QR Code for/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 8. Format + template combination persists across QR type changes
// ---------------------------------------------------------------------------

test.describe('Format and template persist across QR type changes', () => {
  test('selected format is preserved when switching QR type to Text', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Story format/i }).click();
    await expect(page.getByRole('radio', { name: /Select Story format/i })).toHaveAttribute('aria-checked', 'true');

    // Switch QR type
    await page.getByRole('navigation', { name: 'QR code types' }).getByRole('link', { name: 'Event' }).click();
    await page.waitForURL(/\/event-qr-code$/);
    // Wait for Appearance panel – StyleControls re-renders lazily
    await page.getByText('Export Layout').waitFor({ state: 'visible' });

    // Story should still be selected after type change
    await expect(page.getByRole('radio', { name: /Select Story format/i })).toHaveAttribute('aria-checked', 'true');
  });

  test('selected template is preserved when switching QR type', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Gradient template/i }).click();
    await expect(page.getByRole('radio', { name: /Select Gradient template/i })).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('navigation', { name: 'QR code types' }).getByRole('link', { name: 'Location' }).click();
    await page.waitForURL(/\/location-qr-code$/);
    await page.getByText('Export Layout').waitFor({ state: 'visible' });

    await expect(page.getByRole('radio', { name: /Select Gradient template/i })).toHaveAttribute('aria-checked', 'true');
  });
});

// ---------------------------------------------------------------------------
// 9. Download flow – SVG download triggers correct MIME type
// ---------------------------------------------------------------------------

test.describe('SVG download', () => {
  test('SVG download starts a file download with SVG content type', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByRole('button', { name: 'Download options' }).click();
        await page.getByRole('radio', { name: 'SVG' }).click();
        await page.getByRole('button', { name: 'Download SVG' }).click();
      })(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.svg$/i);
    const downloadPath = await download.path();
    
    const content = fs.readFileSync(downloadPath, 'utf8');
    expect(content).toContain('<svg');
    expect(content).toContain('<path'); // Verify core vector components are present
  });

  test('SVG download in Story format still produces a download', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Story format/i }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByRole('button', { name: 'Download options' }).click();
        await page.getByRole('radio', { name: 'SVG' }).click();
        await page.getByRole('button', { name: 'Download SVG' }).click();
      })(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.svg$/i);
    const downloadPath = await download.path();
    
    const content = fs.readFileSync(downloadPath, 'utf8');
    expect(content).toContain('<svg');
    expect(content).toContain('<path'); // Verify core vector components are present
  });

  test('SVG with Minimalist template still produces a download', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Minimalist template/i }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByRole('button', { name: 'Download options' }).click();
        await page.getByRole('radio', { name: 'SVG' }).click();
        await page.getByRole('button', { name: 'Download SVG' }).click();
      })(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.svg$/i);
    const downloadPath = await download.path();
    
    const content = fs.readFileSync(downloadPath, 'utf8');
    expect(content).toContain('<svg');
    expect(content).toContain('<path'); // Verify core vector components are present
  });
});

// ---------------------------------------------------------------------------
// 10. PNG download flow
// ---------------------------------------------------------------------------

test.describe('PNG download', () => {
  test('PNG download triggers a file download with .png extension', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByRole('button', { name: 'Download PNG' }).click();
      })(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.png$/i);
  });

  test('PNG download in Portrait format triggers a download', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Portrait format/i }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByRole('button', { name: 'Download PNG' }).click();
      })(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.png$/i);
  });

  test('PNG download in Story format triggers a download', async ({ page }) => {
    await page.getByRole('radio', { name: /Select Story format/i }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByRole('button', { name: 'Download PNG' }).click();
      })(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.png$/i);
  });
});

// ---------------------------------------------------------------------------
// 11. Keyboard accessibility
// ---------------------------------------------------------------------------

test.describe('Keyboard accessibility for layout controls', () => {
  test('format buttons have aria-checked attribute', async ({ page }) => {
    const squareBtn = page.getByRole('radio', { name: /Select Square format/i });
    const portraitBtn = page.getByRole('radio', { name: /Select Portrait format/i });
    const storyBtn = page.getByRole('radio', { name: /Select Story format/i });

    // All buttons should have aria-checked defined
    await expect(squareBtn).toHaveAttribute('aria-checked');
    await expect(portraitBtn).toHaveAttribute('aria-checked');
    await expect(storyBtn).toHaveAttribute('aria-checked');
  });

  test('template buttons have aria-checked attribute', async ({ page }) => {
    for (const name of ['None', 'Minimalist', 'Gradient', 'Solid Frame']) {
      const btn = page.getByRole('radio', { name: new RegExp(`Select ${name} template`, 'i') });
      await expect(btn).toHaveAttribute('aria-checked');
    }
  });

  test('format buttons are keyboard-focusable', async ({ page }) => {
    const storyBtn = page.getByRole('radio', { name: /Select Story format/i });
    await storyBtn.focus();
    await expect(storyBtn).toBeFocused();
  });

  test('pressing Enter on a format button activates it', async ({ page }) => {
    const storyBtn = page.getByRole('radio', { name: /Select Story format/i });
    await storyBtn.focus();
    await storyBtn.press('Enter');

    await expect(storyBtn).toHaveAttribute('aria-checked', 'true');
  });

  test('pressing Enter on a template button activates it', async ({ page }) => {
    const minimalistBtn = page.getByRole('radio', { name: /Select Minimalist template/i });
    await minimalistBtn.focus();
    await minimalistBtn.press('Enter');

    await expect(minimalistBtn).toHaveAttribute('aria-checked', 'true');
  });
});

// ---------------------------------------------------------------------------
// 12. Aspect-ratio group has accessible group role
// ---------------------------------------------------------------------------

test.describe('ARIA roles and groups', () => {
  test('Aspect Ratio options form a labelled radiogroup', async ({ page }) => {
    const group = page.getByRole('radiogroup', { name: /Aspect Ratio/i });
    await expect(group).toBeVisible();
  });

  test('Template options form a labelled radiogroup', async ({ page }) => {
    const group = page.getByRole('radiogroup', { name: 'Template', exact: true });
    await expect(group).toBeVisible();
  });
});
