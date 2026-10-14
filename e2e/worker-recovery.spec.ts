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

import { test, expect } from './fixtures';

/**
 * Isolated Web Worker Recovery E2E Testing
 * 
 * Verifies that the background worker failures are safely intercepted and handled.
 * Ensures the warning badge is shown, no diagnostics are reported or asked for,
 * and the export bypass flow allows downloading anyway despite background thread errors.
 */

test.describe('Isolated Web Worker Recovery & Export Bypass', () => {
  test.beforeEach(async ({ page }) => {
    // Overwrite globalThis.Worker directly in the browser environment to intercept thread creation.
    // This allows simulating background exceptions in an isolated test context.
    await page.addInitScript(() => {
      const OriginalWorker = globalThis.Worker;
      class MockWorker extends OriginalWorker {
        lastConfigId: any;
        constructor(scriptURL: string | URL, options?: WorkerOptions) {
          super(scriptURL, options);
          this.lastConfigId = undefined;
          // Expose the scannability worker instance on the window object
          const url = String(scriptURL);
          const isScannabilityWorker =
            (url.includes('scannability') || url.includes('worker-') || url.includes('worker.ts') || url.includes('scannabilityWorker')) &&
            !url.includes('worker-matrix') &&
            !url.includes('worker-maze') &&
            !url.includes('fileSliceWorker') &&
            !url.includes('imageResizeWorker');

          if (isScannabilityWorker) {
            (window as any).activeWorker = this;
          }
        }

        postMessage(message: any, transfer?: any) {
          if (message && message.configId) {
            this.lastConfigId = message.configId;
          }
          if (this === (window as any).activeWorker && (window as any).simulateFailure !== false) {
            const configId = message?.configId;
            // Simulate background worker crash/failure asynchronously
            setTimeout(() => {
              this.dispatchEvent(new MessageEvent('message', {
                data: { success: false, physicalReady: false, error: 'NOT_FOUND', configId }
              }));
            }, 10);
          } else {
            if (transfer) {
              super.postMessage(message, transfer);
            } else {
              super.postMessage(message);
            }
          }
        }
      }
      globalThis.Worker = MockWorker as any;
      // Initialize simulateFailure as true from the start of the session
      (window as any).simulateFailure = true;
    });

    // Navigate to homepage
    await page.goto('/');

    // Wait for application hydration indicator to prevent race conditions
    await page.waitForSelector('main[data-hydrated="true"]');

    // Make sure url input is fully loaded and visible before simulating failure
    const urlInput = page.locator('#url-input');
    await urlInput.waitFor({ state: 'visible' });

    // Wait for the active worker instance to be instantiated and captured with an active message configId
    await expect.poll(async () => {
      return await page.evaluate(() => !!((window as any).activeWorker && (window as any).activeWorker.lastConfigId !== undefined));
    }, {
      timeout: 15000,
      intervals: [250]
    }).toBe(true);
  });

  test('Requirement 1 & 2: Mock Worker background thread exception and verify the failing verdict and its alert', async ({ page }) => {
    // Dispatch simulated background process failure message event
    await page.evaluate(() => {
      (window as any).simulateFailure = true;
      if ((window as any).activeWorker) {
        const configId = (window as any).activeWorker.lastConfigId;
        (window as any).activeWorker.dispatchEvent(new MessageEvent('message', {
          data: { success: false, physicalReady: false, error: 'NOT_FOUND', configId }
        }));
      }
    });

    // Assert that a red warning badge with an alert role displays on the page with 15-second polling threshold
    const alertBadge = page.getByRole('alert');
    await expect(alertBadge).toContainText(/won't scan reliably/i, { timeout: 15000 });
    await expect(page.getByTestId('scannability-verdict')).toHaveText("Won't scan reliably");
  });

  test('Requirement 3 & 4: Triggering download during background error displays warning modal and allows bypass', async ({ page }) => {
    // Inject background failure
    await page.evaluate(() => {
      (window as any).simulateFailure = true;
      if ((window as any).activeWorker) {
        const configId = (window as any).activeWorker.lastConfigId;
        (window as any).activeWorker.dispatchEvent(new MessageEvent('message', {
          data: { success: false, physicalReady: false, error: 'NOT_FOUND', configId }
        }));
      }
    });

    // Verify warning badge is visible
    const alertBadge = page.getByRole('alert');
    await expect(alertBadge).toContainText(/won't scan reliably/i, { timeout: 15000 });
    await expect(page.getByTestId('scannability-verdict')).toHaveText("Won't scan reliably");

    // The download command uses the error style for an unsafe code
    const downloadButton = page.getByRole('button', { name: 'Download PNG' });
    await expect(downloadButton).toBeVisible();
    // Wait for the button to transition to the error variant style (bg-rose-50, bg-rose-700, or text-rose-700)
    await expect(downloadButton).toHaveClass(/bg-danger-action|bg-danger-soft|text-danger/);
    // Downloading triggers the safety gate
    await downloadButton.click();

    // Verify that the "Scan Safety Warning" warning dialog/modal is open
    const warningModalTitle = page.getByRole('heading', { name: 'This Code May Not Scan' });
    await expect(warningModalTitle).toBeVisible({ timeout: 15000 });

    // Assert that the active bypass trigger button "Export Anyway" is present in the warning dialog
    const exportAnywayButton = page.getByRole('button', { name: 'Export anyway' });
    await expect(exportAnywayButton).toBeVisible();

    // Click the active bypass trigger to ignore error and proceed
    await exportAnywayButton.click();

    // Assert that the warning modal closes
    await expect(warningModalTitle).not.toBeVisible({ timeout: 15000 });
  });

  test('Requirement 5: A scan failure sends no diagnostics and asks for no consent', async ({ page }) => {
    const reportRequests: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/')) reportRequests.push(request.url());
    });

    // Inject background failure
    await page.evaluate(() => {
      (window as any).simulateFailure = true;
      if ((window as any).activeWorker) {
        const configId = (window as any).activeWorker.lastConfigId;
        (window as any).activeWorker.dispatchEvent(new MessageEvent('message', {
          data: { success: false, physicalReady: false, error: 'NOT_FOUND', configId }
        }));
      }
    });

    // Verify scannability alert/badge is active
    const alertBadge = page.getByRole('alert');
    await expect(alertBadge).toContainText(/won't scan reliably/i, { timeout: 15000 });
    await expect(page.getByTestId('scannability-verdict')).toHaveText("Won't scan reliably");

    // Exactly one alert announces the failure; no consent popup interrupts it (#800, #802)
    await expect(page.getByRole('alert')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /No thanks/i })).toHaveCount(0);

    // No diagnostics prompt, and nothing is reported anywhere
    await expect(page.getByText(/Anonymous diagnostics/i)).toHaveCount(0);
    expect(reportRequests).toEqual([]);
    await expect(page.getByRole('switch', { name: /diagnostics/i })).toHaveCount(0);
  });
});
