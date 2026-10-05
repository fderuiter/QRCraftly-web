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

/**
 * The generator's camera scanner against a scripted fake camera (#1103).
 *
 * The fake camera (`tests/utils/fakeCamera.ts`) feeds a canvas stream into the real
 * scanner (engine, worker, decoder), so these tests measure what a user waits for: the
 * time from opening the scanner (or a code appearing) to the decoded code landing in
 * the generator. Budgets are generous so they do not flake on a CI runner; the
 * numbers are attached to each test as `time-to-decode` annotations.
 */
import { setTimeout as delay } from 'node:timers/promises';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  codeScene,
  installFakeCamera,
  liveCameraTracks,
  requestedCameraConstraints,
  showOnCamera,
  throttleCpu,
} from '../tests/utils/fakeCamera';
import { renderPhoto, withExifOrientation } from '../tests/utils/photoFixture';

const CODE = 'https://qrcraftly.com/scanned';
/** PR CI budget for decoding a code that is in view when the scanner opens (#1103). */
const BASELINE_BUDGET_MS = 1000;
/** PR CI budget for a scanner reopened after a long session with no code (#1095, #1103). */
const REOPEN_BUDGET_MS = 2000;
/** A code that appears after 10 s with no code, at 4x CPU throttling, decodes within this (#1096). */
const THROTTLED_APPEAR_BUDGET_MS = 1000;
/** Generous bound for a grainy code at 6x CPU throttling; the point there is no worker restart. */
const NOISY_THROTTLED_BUDGET_MS = 5000;
/** How long the scanner looks at nothing before it is closed and reopened. */
const LONG_SESSION_MS = 20_000;

declare global {
  interface Window {
    __decode?: { startedAt: number; decodedAt: number | null };
  }
}

/**
 * Starts the clock and watches for the next found code: the reticle locking onto it, or the
 * result sheet when there are no corners to lock onto (#1101).
 */
async function startDecodeTimer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const timer = { startedAt: performance.now(), decodedAt: null as number | null };
    window.__decode = timer;
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-locked="true"], [data-testid="scan-result"]')) {
        timer.decodedAt = performance.now();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
}

/** Opens the result in the generator and checks the content arrived. */
async function editInGenerator(page: Page, code = CODE): Promise<void> {
  await page.getByRole('button', { name: 'Edit in generator' }).click();
  await expect(page.locator('#url-input')).toHaveValue(code);
}

/** Waits for the decode the timer is watching and returns the elapsed milliseconds. */
async function decodeTime(page: Page, timeout = 15_000): Promise<number> {
  await expect.poll(() => page.evaluate(() => window.__decode?.decodedAt != null), { timeout, intervals: [50] }).toBe(true);
  return page.evaluate(() => {
    const timer = window.__decode;
    return timer && timer.decodedAt !== null ? Math.round(timer.decodedAt - timer.startedAt) : Number.NaN;
  });
}

/**
 * Resources the page fetched between the timer's start and the decode (resource timing), other
 * than the app's own code: applying the decoded content starts the generator's matrix worker,
 * whose script is a same-origin `/assets/` file, exactly as typing the same content would, and the
 * scanner may load its own zxing-wasm reader from `/assets/` (ADR 0023).
 */
async function requestsDuringScan(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const timer = window.__decode;
    if (!timer || timer.decodedAt === null) return ['<no decode>'];
    const { startedAt, decodedAt } = timer;
    return performance
      .getEntriesByType('resource')
      .filter((entry) => entry.startTime >= startedAt && entry.startTime <= decodedAt)
      .map((entry) => entry.name)
      .filter((name) => !/^https?:\/\/[^/]+\/assets\/[\w.-]+\.(?:js|wasm)$/.test(name) || !name.startsWith(location.origin));
  });
}

function report(testInfo: TestInfo, scenario: string, ms: number): void {
  testInfo.annotations.push({ type: 'time-to-decode', description: `${scenario}: ${ms} ms` });
  console.log(`[scanner] ${testInfo.project.name} ${scenario}: ${ms} ms`);
}

async function openGenerator(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('main[data-hydrated="true"]');
  // Let the generator finish its first render and route prefetching, as a user would.
  await page.waitForLoadState('networkidle');
}

const openScanner = (page: Page) => page.getByRole('button', { name: 'Scan QR Code' }).click();

/** Opens the scanner with `scene` in view and returns the time to decode. */
async function scanWith(page: Page, scene: Parameters<typeof codeScene>[1] = {}): Promise<number> {
  await showOnCamera(page, codeScene(CODE, scene));
  await startDecodeTimer(page);
  await openScanner(page);
  const ms = await decodeTime(page);
  await expect(page.getByTestId('scan-result-host')).toHaveText('qrcraftly.com');
  await editInGenerator(page);
  return ms;
}

test.describe('Camera scanner with a scripted fake camera', () => {
  test.describe('Chromium', () => {
    // The fake camera's canvas stream and CPU throttling (CDP) are Chromium features in CI.
    test.skip(({ browserName }) => browserName !== 'chromium', 'scripted fake camera runs in Chromium');

    test('decodes a code in view, sends nothing over the network and releases the camera', async ({ page, context }, testInfo) => {
      await installFakeCamera(context);
      await openGenerator(page);

      const baseline = await scanWith(page);
      report(testInfo, 'baseline', baseline);
      expect(baseline).toBeLessThan(BASELINE_BUDGET_MS);
      // A found code stops the camera, and opening it in the generator closes the scanner.
      await expect.poll(() => liveCameraTracks(page)).toBe(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // Nothing goes over the network between opening the scanner and the decode, and nothing the
      // page requests afterwards (its own code, the service worker's precache) carries the payload.
      await page.locator('#url-input').fill('https://example.com/');
      const requests: string[] = [];
      context.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));
      const again = await scanWith(page);
      report(testInfo, 'second scan', again);
      expect(await requestsDuringScan(page)).toEqual([]);
      for (const request of requests) {
        expect(request).toMatch(/^GET http:\/\/127\.0\.0\.1:3000\//);
        expect(request).not.toContain('scanned');
      }

      // Closing the scanner without a code releases the camera too.
      await showOnCamera(page, null);
      await openScanner(page);
      await expect.poll(() => liveCameraTracks(page)).toBe(1);
      await page.getByRole('button', { name: 'Close scanner' }).click();
      await expect.poll(() => liveCameraTracks(page)).toBe(0);
    });

    test('asks for an HD back camera at 30 fps (#1100)', async ({ page, context }) => {
      await installFakeCamera(context);
      await openGenerator(page);
      await showOnCamera(page, null);
      await openScanner(page);
      await expect.poll(() => liveCameraTracks(page)).toBe(1);

      const [first] = await requestedCameraConstraints(page);
      expect(first).toMatchObject({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
      });
      await page.getByRole('button', { name: 'Close scanner' }).click();
      await expect.poll(() => liveCameraTracks(page)).toBe(0);
    });

    test('decodes at once when reopened after a long session with no code', async ({ page, context }, testInfo) => {
      await installFakeCamera(context);
      await openGenerator(page);
      const baseline = await scanWith(page);
      report(testInfo, 'baseline', baseline);

      // The shared worker served a long session with no code (#1095): the next one must not wait.
      await page.locator('#url-input').fill('https://example.com/');
      await showOnCamera(page, null);
      await openScanner(page);
      await delay(LONG_SESSION_MS);
      await page.getByRole('button', { name: 'Close scanner' }).click();

      const reopened = await scanWith(page);
      report(testInfo, `reopened after ${LONG_SESSION_MS / 1000} s with no code`, reopened);
      expect(reopened).toBeLessThan(REOPEN_BUDGET_MS);
      expect(reopened).toBeLessThan(Math.max(2 * baseline, BASELINE_BUDGET_MS));
    });

    test('keeps sampling at full speed on a slow device (4x CPU throttle)', async ({ page, context }, testInfo) => {
      test.setTimeout(60_000);
      await installFakeCamera(context);
      await openGenerator(page);
      // Light sensor noise, as indoors: frames with no code cost a full decode each.
      await showOnCamera(page, { noise: 6 });
      await throttleCpu(page, 4);
      await openScanner(page);
      await expect.poll(() => liveCameraTracks(page)).toBe(1);

      // Ten seconds of frames with no code used to back sampling off towards 1 fps (#1096).
      await delay(10_000);
      await startDecodeTimer(page);
      await showOnCamera(page, codeScene(CODE, { noise: 6 }));
      const ms = await decodeTime(page);
      report(testInfo, 'code appears after 10 s with no code, 4x throttle', ms);
      expect(ms).toBeLessThan(THROTTLED_APPEAR_BUDGET_MS);
    });

    test('does not restart a slow but working decoder on grainy frames (6x CPU throttle)', async ({ page, context }, testInfo) => {
      test.setTimeout(60_000);
      const watchdog: string[] = [];
      page.on('console', (message) => {
        if (/watchdog/i.test(message.text())) watchdog.push(message.text());
      });
      await installFakeCamera(context);
      await openGenerator(page);
      await showOnCamera(page, { noise: 14 });
      await throttleCpu(page, 6);
      await openScanner(page);
      await expect.poll(() => liveCameraTracks(page)).toBe(1);
      await delay(8_000);
      expect(watchdog).toEqual([]);

      await startDecodeTimer(page);
      await showOnCamera(page, codeScene(CODE, { noise: 14 }));
      const ms = await decodeTime(page);
      report(testInfo, 'grainy code, 6x throttle', ms);
      expect(ms).toBeLessThan(NOISY_THROTTLED_BUDGET_MS);
      expect(watchdog).toEqual([]);
    });

    test('decodes small modules and inverted codes', async ({ page, context }, testInfo) => {
      await installFakeCamera(context);
      await openGenerator(page);

      const small = await scanWith(page, { modulePx: 2 });
      report(testInfo, 'small modules (2 px)', small);
      expect(small).toBeLessThan(3000);

      await page.locator('#url-input').fill('https://example.com/');
      const inverted = await scanWith(page, { invert: true });
      report(testInfo, 'inverted', inverted);
      expect(inverted).toBeLessThan(3000);
    });
  });

  test.describe('All browsers', () => {
    test('leads with the image fallback when the camera is denied', async ({ page, context }) => {
      await installFakeCamera(context, { deny: true });
      await openGenerator(page);
      await openScanner(page);

      await expect(page.getByRole('heading', { name: 'Camera Access Denied' })).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('Camera Access Denied');
      await expect(page.getByRole('button', { name: /retry permission/i })).toBeVisible();
      await page.getByRole('button', { name: 'Scan from an image instead' }).click();
      await expect(page.getByRole('radio', { name: 'Image' })).toHaveAttribute('aria-checked', 'true');
      expect(await liveCameraTracks(page)).toBe(0);
    });

    test('decodes a 12 MP phone photo with an EXIF orientation from the file upload (#1098)', async ({ page, context }, testInfo) => {
      test.setTimeout(60_000);
      await installFakeCamera(context);
      await openGenerator(page);
      await openScanner(page);
      await page.getByRole('radio', { name: 'Image' }).click();
      // A portrait phone photo: stored 3000x4000 with EXIF orientation 6 (shown rotated 90 degrees).
      const photo = withExifOrientation(await renderPhoto(page, CODE, { width: 3000, height: 4000 }), 6);
      await startDecodeTimer(page);
      await page.getByLabel('Upload QR code image file').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo });
      const ms = await decodeTime(page, 20_000);
      report(testInfo, '12 MP photo upload with EXIF orientation 6', ms);
      await editInGenerator(page);
    });

    test('releases the camera while the tab is hidden and resumes when it is shown (#1097)', async ({ page, context, browserName }) => {
      // WebKit refuses the canvas-stream fake camera (the scanner shows its denied card), as in the
      // file-transfer spec's synthetic camera; the hidden-tab behaviour is unit-tested in cameraSession.test.ts.
      test.skip(browserName === 'webkit', 'canvas-stream fake camera does not stream in WebKit');
      await installFakeCamera(context);
      await openGenerator(page);
      await showOnCamera(page, null);
      await openScanner(page);
      await expect.poll(() => liveCameraTracks(page)).toBe(1);

      const setHidden = (hidden: boolean) =>
        page.evaluate((value) => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
          document.dispatchEvent(new Event('visibilitychange'));
        }, hidden);

      await setHidden(true);
      await expect.poll(() => liveCameraTracks(page)).toBe(0);
      await setHidden(false);
      await expect.poll(() => liveCameraTracks(page)).toBe(1);

      // The resumed camera still scans.
      await showOnCamera(page, codeScene(CODE));
      await expect(page.getByTestId('scan-result')).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => liveCameraTracks(page)).toBe(0);
    });
  });
});
