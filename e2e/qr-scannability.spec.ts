import { test, expect } from './fixtures';
import { qrReader } from '../tests/fixtures/qrReader';

test.describe('QR Code Scannability via Headless Browser', () => {
  test('generates scannable QR codes for various styles', async ({ page }) => {
    await page.goto('/');

    // Wait for hydration to complete
    await page.waitForSelector('main[data-hydrated="true"]');

    // Wait for the URL input to be visible
    const input = page.locator('#url-input');
    await input.waitFor({ state: 'visible' });

    // Set a known value for the QR code
    const testUrl = 'https://qrcraftly.com/test-verification';
    await input.fill(testUrl);
    await expect(input).toHaveValue(testUrl);

    // Wait for the QR code to be rendered
    await page.waitForSelector('canvas[role="img"]');
    
    const checkScannability = async () => {
        const result = await page.evaluate(async () => {
            const canvas = document.querySelector('canvas[role="img"]') as HTMLCanvasElement;
            if (!canvas) return null;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            
            // Wait a small moment for drawing
            await new Promise(r => setTimeout(r, 100));

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            return {
                width: imageData.width,
                height: imageData.height,
                data: new Uint8Array(imageData.data.buffer)
            };
        });

        if (!result) {
            return null;
        }

        const uint8Data = new Uint8ClampedArray(result.data.buffer);
        const [code] = qrReader.read(uint8Data, result.width, result.height, { inverted: true });
        return code ? code.text : undefined;
    };

    await expect.poll(async () => {
        return await checkScannability();
    }, {
        timeout: 15000,
        intervals: [500]
    }).toBe(testUrl);

    // Now test a different style if we can click it.
    const dotsButton = page.getByRole('radio', { name: 'Select Dots pattern' });
    if (await dotsButton.isVisible()) {
        await dotsButton.click();
        await expect.poll(async () => {
            return await checkScannability();
        }, {
            timeout: 15000,
            intervals: [500]
        }).toBe(testUrl);
    }
  });

  test('rates the default code as scanning reliably, print simulation included (#1248)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('main[data-hydrated="true"]');

    // The print simulation runs in automated browsers too, so a plain code must pass it.
    await expect(page.getByTestId('scannability-verdict')).toHaveText('Scans reliably', { timeout: 15000 });
  });

  test('shows a passing scannability verdict for Fluid Ink across default and dense payloads', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('main[data-hydrated="true"]');

    const patternSection = page.getByRole('button', { name: 'Pattern & Colors' });
    if ((await patternSection.getAttribute('aria-expanded')) !== 'true') await patternSection.click();
    const fluidRadio = page.getByRole('radio', { name: 'Select Fluid Ink pattern' });
    await fluidRadio.click();
    await expect(fluidRadio).toHaveAttribute('aria-checked', 'true');

    // Any passing verdict ("Scans reliably" or "Scans, but fragile"), never "Won't scan reliably".
    const verdict = page.getByTestId('scannability-verdict');
    await expect.poll(async () => {
      const text = (await verdict.textContent().catch(() => '')) ?? '';
      return text.startsWith('Scans');
    }, { timeout: 15000, intervals: [500] }).toBe(true);

    const longUrl = 'https://example.com/very/long/url/with/lots/of/parameters?foo=bar&baz=qux&utm_source=test&utm_medium=email&utm_campaign=winter_sale_2026_qrcraftly_verification';
    const input = page.locator('#url-input');
    await input.fill(longUrl);

    await expect.poll(async () => {
      const text = (await verdict.textContent().catch(() => '')) ?? '';
      return text.startsWith('Scans');
    }, { timeout: 15000, intervals: [500] }).toBe(true);
  });
});
