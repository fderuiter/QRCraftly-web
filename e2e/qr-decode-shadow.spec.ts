/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

/**
 * Shadow run of our QR decoder (#1178) beside jsQR on what the generator really draws: every
 * pattern style, with a short and a dense payload, rendered by Chromium. Our decoder must read
 * every code jsQR reads before it replaces jsQR.
 */
import jsQR from 'jsqr';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { qrReader } from '../tests/fixtures/qrReader';

const PAYLOADS = [
  'https://qrcraftly.com/shadow',
  'https://example.com/very/long/url/with/lots/of/parameters?foo=bar&baz=qux&utm_source=test&utm_medium=email&utm_campaign=winter_sale_2026_qrcraftly_verification',
];

/** The preview canvas's pixels. */
async function canvasPixels(page: Page): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const { base64, width, height } = await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 150)));
    const canvas = document.querySelector('canvas[role="img"]') as HTMLCanvasElement;
    const image = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let binary = '';
    for (let i = 0; i < image.data.length; i += 0x8000) {
      binary += String.fromCharCode(...image.data.subarray(i, i + 0x8000));
    }
    return { base64: btoa(binary), width: image.width, height: image.height };
  });
  return { data: new Uint8ClampedArray(Buffer.from(base64, 'base64')), width, height };
}

test.describe('qr-decode shadow run against jsQR', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'one engine draws the corpus');
  test.setTimeout(240_000);

  test('reads every pattern style jsQR reads', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('main[data-hydrated="true"]');
    const patternSection = page.getByRole('button', { name: 'Pattern & Colors' });
    if ((await patternSection.getAttribute('aria-expanded')) !== 'true') await patternSection.click();
    const radios = page.getByRole('radio', { name: /pattern$/ });
    const names = await radios.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
    expect(names.length).toBeGreaterThan(5);

    const input = page.locator('#url-input');
    const rows: string[] = [];
    const missed: string[] = [];
    for (const payload of PAYLOADS) {
      await input.fill(payload);
      for (const name of names) {
        const radio = page.getByRole('radio', { name, exact: true });
        await radio.click();
        await expect(radio).toHaveAttribute('aria-checked', 'true');
        // Wait until the preview shows this payload in this style (jsQR or ours reads it), or give up.
        let jsqr: string | null = null;
        let ours: string | null = null;
        for (let attempt = 0; attempt < 6; attempt++) {
          const { data, width, height } = await canvasPixels(page);
          jsqr = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
          ours = qrReader.read(data, width, height, { inverted: true, global: true, half: true })[0]?.text ?? null;
          if (jsqr === payload || ours === payload) break;
        }
        const label = `${name.replace(/^Select | pattern$/g, '')} (${payload.length} chars)`;
        rows.push(`${label}: jsQR ${jsqr === payload ? 'read' : 'missed'}, qr-decode ${ours === payload ? 'read' : 'missed'}`);
        if (jsqr === payload && ours !== payload) missed.push(label);
      }
    }
    console.log(rows.join('\n'));
    expect(missed, 'styles jsQR reads but qr-decode does not').toEqual([]);
  });
});
