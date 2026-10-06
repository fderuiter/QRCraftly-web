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

/**
 * Optical file transfer, end to end: a sender page streams a real file as
 * animated QR codes, and a receiver page scans them through a synthetic camera
 * (see `utils/opticalLink.ts`) with the production scanner worker, rebuilds the
 * file, verifies its SHA-256 and downloads it. Every transfer test compares the
 * downloaded bytes with the original.
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { installSyntheticCamera, relayFrames, type CameraCondition } from './utils/opticalLink';

interface TransferFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

async function openSender(sender: Page, file: TransferFile, speed?: 'Steady' | 'Balanced' | 'Fast', options: { outerCode?: boolean; multiCode?: boolean } = {}) {
  await sender.goto('/file-transfer');
  await sender.waitForSelector('main[data-hydrated="true"]');
  await sender.getByLabel('Choose a file to send').setInputFiles(file);
  if (speed) await sender.getByRole('radio', { name: speed, exact: true }).click();
  if (options.outerCode) {
    await sender.getByRole('button', { name: 'Advanced', exact: true }).click();
    // The switch's visible track covers its input, so click the label, as a person would.
    await sender.getByText('New transfer format (preview)', { exact: true }).click();
    await expect(sender.getByLabel('New transfer format (preview)')).toBeChecked();
  }
  if (options.multiCode) {
    await sender.getByRole('button', { name: 'Advanced', exact: true }).click();
    await sender.getByText('Several codes per frame (preview)', { exact: true }).click();
    await expect(sender.getByLabel('Several codes per frame (preview)')).toBeChecked();
  }
  await sender.getByRole('button', { name: 'Start file transfer' }).click();
  await expect(sender.getByRole('button', { name: 'Stop file transfer' })).toBeVisible({ timeout: 20_000 });
}

async function openReceiver(receiver: Page, options: { multiCode?: boolean } = {}) {
  await receiver.goto('/file-transfer/receive');
  await receiver.waitForSelector('main[data-hydrated="true"]');
  if (options.multiCode) {
    await receiver.getByText('Read several codes per frame (preview)', { exact: true }).click();
    await expect(receiver.getByLabel('Read several codes per frame (preview)')).toBeChecked();
  }
  await receiver.getByRole('button', { name: 'Activate camera scanner' }).click();
  await expect(receiver.getByRole('button', { name: 'Deactivate camera scanner' })).toBeVisible();
}

const isComplete = (receiver: Page) => () => receiver.getByTestId('inline-complete-panel').isVisible();

async function blocksDecoded(receiver: Page): Promise<number> {
  const text = (await receiver.getByTestId('fountain-rank').textContent({ timeout: 500 }).catch(() => null)) ?? '';
  return Number(/^(\d+)/.exec(text)?.[1] ?? 0);
}

async function relayUntilComplete(
  sender: Page,
  receiver: Page,
  options: { condition?: CameraCondition; drop?: (n: number) => boolean } = {}
) {
  await relayFrames(sender, receiver, { ...options, until: isComplete(receiver), timeoutMs: 90_000 });
}

/** Downloads the received file and checks its name, its bytes and the SHA-256 shown to the user. */
async function expectDownloadedCopy(receiver: Page, file: TransferFile) {
  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  const summary = receiver.getByTestId('received-file-summary');
  await expect(summary).toContainText(file.name);
  await expect(summary.getByTitle(sha256)).toBeVisible();

  const downloadPromise = receiver.waitForEvent('download');
  await receiver.getByRole('button', { name: 'Save', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(file.name);
  const received = await readFile(await download.path());
  expect(received.length).toBe(file.buffer.length);
  expect(received.equals(file.buffer)).toBe(true);
}

test.describe('Optical file transfer', () => {
  test.describe('through a synthetic camera', () => {
    // The camera stand-in feeds canvas.captureStream() into the real scanner worker. Its frame
    // timing is calibrated for Chromium only; the protocol itself is covered by the unit suites.
    test.skip(({ browserName }) => browserName !== 'chromium', 'synthetic camera relay is Chromium-only');
    test.setTimeout(150_000);

    test('sends a binary file and downloads a byte-identical, SHA-256-verified copy', { tag: '@prod' }, async ({ page: receiver, context }) => {
      await installSyntheticCamera(context);
      const sender = await context.newPage();
      const file = { name: 'firmware.bin', mimeType: 'application/octet-stream', buffer: randomBytes(6 * 1024) };

      // The receiver joins after the stream has started and misses a quarter of the frames.
      await openSender(sender, file);
      await expect(sender.getByTestId('fountain-symbol-info')).toContainText('bytes (uncompressed)');
      await expect
        .poll(async () => Number(/^(\d+)/.exec((await sender.getByTestId('sender-frames').textContent()) ?? '')?.[1] ?? 0))
        .toBeGreaterThanOrEqual(5);
      await openReceiver(receiver);

      // The manifest shows the file's name and type before any of its data has decoded, and its
      // transfer code matches the one on the sender's screen.
      await relayFrames(sender, receiver, { drop: n => n % 4 === 0, until: () => receiver.getByTestId('manifest-info').isVisible(), timeoutMs: 30_000 });
      await expect(receiver.getByTestId('manifest-name')).toHaveText('firmware.bin');
      await expect(receiver.getByTestId('manifest-type')).toHaveText('application/octet-stream');
      const code = await sender.getByTestId('sender-fingerprint').locator('span').textContent();
      await expect(receiver.getByTestId('manifest-fingerprint')).toHaveText(code ?? 'missing');
      await expect(receiver.getByTestId('inline-complete-panel')).toBeHidden();

      await relayUntilComplete(sender, receiver, { drop: n => n % 4 === 0 });

      await expectDownloadedCopy(receiver, file);
    });

    test('sends with the new outer code when it is chosen under Advanced (#1141)', { tag: '@prod' }, async ({ page: receiver, context }) => {
      await installSyntheticCamera(context);
      const sender = await context.newPage();
      const file = { name: 'outer.bin', mimeType: 'application/octet-stream', buffer: randomBytes(5 * 1024) };
      await openSender(sender, file, undefined, { outerCode: true });
      await expect(sender.getByTestId('outer-code-hint')).not.toContainText('standard format:');
      await openReceiver(receiver);
      await relayUntilComplete(sender, receiver, { drop: n => n % 3 === 0 });
      await expectDownloadedCopy(receiver, file);
    });

    test('shows several codes per frame and reads them all when both sides choose it (#1142)', async ({ page: receiver, context }) => {
      await installSyntheticCamera(context);
      const sender = await context.newPage();
      // A laptop-sized window has room for a 2x2 grid at 3 CSS px a module.
      await sender.setViewportSize({ width: 1400, height: 1000 });
      const file = { name: 'tiles.bin', mimeType: 'application/octet-stream', buffer: randomBytes(12 * 1024) };
      await openSender(sender, file, undefined, { multiCode: true });
      await expect(sender.getByTestId('multi-code-hint')).not.toContainText('too small');
      await expect(sender.getByTestId('fountain-symbol-info')).toContainText('Each code carries');
      await openReceiver(receiver, { multiCode: true });
      await relayUntilComplete(sender, receiver, { condition: { scale: 0.95 } });
      await expectDownloadedCopy(receiver, file);
    });

    test('keeps progress when the scanner pauses and the sender restarts', async ({ page: receiver, context }) => {
      await installSyntheticCamera(context);
      const sender = await context.newPage();
      const file = { name: 'notes.bin', mimeType: 'application/octet-stream', buffer: randomBytes(5 * 1024) };
      await openSender(sender, file, 'Steady');
      await openReceiver(receiver);

      await relayFrames(sender, receiver, { until: async () => (await blocksDecoded(receiver)) >= 40, timeoutMs: 60_000 });
      await receiver.getByRole('button', { name: 'Deactivate camera scanner' }).click();
      await sender.getByRole('button', { name: 'Stop file transfer' }).click();
      const before = await blocksDecoded(receiver);
      expect(before).toBeGreaterThanOrEqual(40);

      await sender.getByRole('button', { name: 'Start file transfer' }).click();
      await receiver.getByRole('button', { name: 'Activate camera scanner' }).click();
      await relayUntilComplete(sender, receiver);
      await expectDownloadedCopy(receiver, file);
    });

    test('reads dense frames through a small, dim and blurred camera view', async ({ page: receiver, context }) => {
      await installSyntheticCamera(context);
      const sender = await context.newPage();
      const file = { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: randomBytes(8 * 1024) };
      await openSender(sender, file, 'Fast');
      await openReceiver(receiver);
      await relayUntilComplete(sender, receiver, { condition: { scale: 0.5, blurPx: 1, brightness: 0.5, contrast: 0.7 } });
      await expectDownloadedCopy(receiver, file);
    });

    test('receives a second file after the first one completes', async ({ page: receiver, context }) => {
      await installSyntheticCamera(context);
      const sender = await context.newPage();
      const first = { name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('first file\n'.repeat(80)) };
      const rows = Array.from({ length: 200 }, (_, i) => `${i},${i * i}`).join('\n');
      const second = { name: 'second.csv', mimeType: 'text/csv', buffer: Buffer.from(`id,value\n${rows}\n`) };

      await openSender(sender, first);
      await openReceiver(receiver);
      await relayUntilComplete(sender, receiver);
      await expectDownloadedCopy(receiver, first);

      await sender.getByRole('button', { name: 'Stop file transfer' }).click();
      await sender.getByLabel('Choose a file to send').setInputFiles(second);
      await sender.getByRole('button', { name: 'Start file transfer' }).click();
      await receiver.getByRole('button', { name: 'Receive another file' }).click();
      await expect(receiver.getByTestId('inline-complete-panel')).not.toBeVisible();
      await expect(receiver.getByRole('button', { name: 'Deactivate camera scanner' })).toBeVisible();
      await relayUntilComplete(sender, receiver);
      await expectDownloadedCopy(receiver, second);
    });

    test('does not receive the same file again while the camera still sees it', async ({ page: receiver, context }) => {
      await installSyntheticCamera(context);
      const sender = await context.newPage();
      const file = { name: 'again.txt', mimeType: 'text/plain', buffer: Buffer.from('same file\n'.repeat(60)) };
      await openSender(sender, file);
      await openReceiver(receiver);
      await relayUntilComplete(sender, receiver);
      await expectDownloadedCopy(receiver, file);

      // The sender keeps looping the finished file while the receiver gets ready for the next one.
      await receiver.getByRole('button', { name: 'Receive another file' }).click();
      await expect(receiver.getByRole('button', { name: 'Deactivate camera scanner' })).toBeVisible();
      const deadline = Date.now() + 4_000;
      await relayFrames(sender, receiver, { until: async () => Date.now() > deadline || (await isComplete(receiver)()), timeoutMs: 10_000 });
      await expect(receiver.getByTestId('inline-complete-panel')).not.toBeVisible();
      // No droplet of the finished stream was accepted, so no decode progress is shown.
      await expect(receiver.getByTestId('fountain-rank')).toHaveCount(0);
    });

    test('asks before saving risky file types and shows the real extension', async ({ page: receiver, context }) => {
      await installSyntheticCamera(context);
      const sender = await context.newPage();
      // The name hides an executable behind a document extension.
      const exe = { name: 'invoice.pdf.exe', mimeType: 'application/x-msdownload', buffer: randomBytes(1024) };
      const html = { name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<p>hello</p>'.repeat(40)) };

      await openSender(sender, exe);
      await openReceiver(receiver);
      await relayUntilComplete(sender, receiver);

      // The whole name wraps in view, with the type called out on its own line.
      await expect(receiver.getByTestId('received-file-name')).toHaveText('invoice.pdf.exe');
      await expect(receiver.getByTestId('received-file-type')).toContainText('.exe, application/x-msdownload');
      await expect(receiver.getByTestId('received-file-notices')).toContainText('The real type is .exe');

      // First click opens the confirmation; nothing is saved yet.
      await receiver.getByRole('button', { name: 'Save', exact: true }).click();
      const confirmation = receiver.getByTestId('risky-file-confirmation');
      await expect(confirmation).toContainText('can run programs on your device');
      await receiver.getByRole('button', { name: 'Cancel' }).click();
      await expect(confirmation).not.toBeVisible();

      await receiver.getByRole('button', { name: 'Save', exact: true }).click();
      const downloadPromise = receiver.waitForEvent('download');
      await receiver.getByRole('button', { name: 'Save anyway' }).click();
      expect((await downloadPromise).suggestedFilename()).toBe(exe.name);

      // An .html file is active content too.
      await sender.getByRole('button', { name: 'Stop file transfer' }).click();
      await sender.getByLabel('Choose a file to send').setInputFiles(html);
      await sender.getByRole('button', { name: 'Start file transfer' }).click();
      await receiver.getByRole('button', { name: 'Receive another file' }).click();
      await relayUntilComplete(sender, receiver);
      await receiver.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(receiver.getByTestId('risky-file-confirmation')).toBeVisible();
    });

    test('works between two phone-sized screens', async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      try {
        await installSyntheticCamera(context);
        const sender = await context.newPage();
        const receiver = await context.newPage();
        const vcard = 'BEGIN:VCARD\nVERSION:4.0\nFN:Ada Lovelace\nEND:VCARD\n';
        const file = { name: 'contact.vcf', mimeType: 'text/vcard', buffer: Buffer.from(vcard.repeat(20)) };
        await openSender(sender, file);
        await sender.getByRole('img', { name: 'Transfer QR code' }).scrollIntoViewIfNeeded();
        await openReceiver(receiver);
        await relayUntilComplete(sender, receiver);
        await expectDownloadedCopy(receiver, file);
      } finally {
        await context.close();
      }
    });
  });

  test.describe('photosensitivity safeguards (#1148)', () => {
    const notice = 'This screen will flash a rapidly changing pattern.';
    const file = { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello '.repeat(200)) };

    async function chooseFile(sender: Page) {
      await sender.goto('/file-transfer');
      await sender.waitForSelector('main[data-hydrated="true"]');
      await sender.getByLabel('Choose a file to send').setInputFiles(file);
    }

    test('warns before the first start, then Pause and Escape freeze the stream on screen', async ({ page }) => {
      await chooseFile(page);
      await expect(page.getByTestId('photosensitivity-notice')).toContainText(notice);
      await expect(page.getByRole('status').filter({ hasText: notice })).toHaveCount(1);

      await page.getByRole('button', { name: 'Start file transfer' }).click();
      await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('photosensitivity-notice')).toHaveCount(0);

      // Pause freezes the canvas: two reads a moment apart are the same picture.
      const picture = () => page.getByRole('img', { name: 'Transfer QR code' }).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
      await page.getByRole('button', { name: 'Pause' }).click();
      await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
      const frozen = await picture();
      await page.waitForTimeout(600);
      expect(await picture()).toBe(frozen);

      // Escape does the same from wherever focus is.
      await page.getByRole('button', { name: 'Resume' }).click();
      await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    });

    test.describe('with reduced motion', () => {
      test.use({ contextOptions: { reducedMotion: 'reduce' } });

      test('starts at the slowest pace and needs a second confirm', async ({ page }) => {
        await chooseFile(page);
        await expect(page.getByRole('radio', { name: 'Steady', exact: true })).toBeChecked();

        await page.getByRole('button', { name: 'Start file transfer' }).click();
        await expect(page.getByTestId('reduced-motion-confirm')).toContainText('Your device asks for reduced motion');
        await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);

        await page.getByRole('button', { name: 'Start anyway' }).click();
        await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 20_000 });
      });
    });
  });

  test('explains a blocked camera and offers the video file route', async ({ page, context }) => {
    await installSyntheticCamera(context, { deny: true });
    await page.goto('/file-transfer/receive');
    await page.waitForSelector('main[data-hydrated="true"]');
    await page.getByRole('button', { name: 'Activate camera scanner' }).click();

    const alert = page.getByTestId('camera-error');
    await expect(alert).toContainText('Camera access was blocked');
    await alert.getByRole('button', { name: 'Use a video file instead' }).click();
    await expect(page.getByRole('button', { name: 'Select Video File' })).toBeVisible();
    await expect(alert).toBeHidden();
  });
});
