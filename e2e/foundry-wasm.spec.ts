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
 * Cross-engine test for our Rust modules (#1182, ADR 0033). Each engine compiles the committed
 * self-test module from the page's own origin, hands the compiled module to a worker the way the
 * scanner does (ADR 0023), runs the fixed battery there, and must return exactly the bytes Node
 * returns.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { test, expect } from './fixtures';
import { runSelftestBattery, SELFTEST_BATTERY_SHA256 } from '../tests/foundry/selftestBattery';

const MODULE_PATH = '/__foundry/selftest.wasm';
const WORKER_PATH = '/__foundry/selftest-worker.js';
const moduleBytes = fs.readFileSync(new URL('../src/wasm/selftest.wasm', import.meta.url));

/** The worker: instantiates the module it is sent and runs the battery on it. */
const workerSource = `const runSelftestBattery = ${runSelftestBattery.toString()};
onmessage = async (event) => {
  try {
    const { exports } = await WebAssembly.instantiate(event.data, {});
    const bytes = runSelftestBattery(exports);
    postMessage({ hex: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') });
  } catch (error) {
    postMessage({ error: String(error) });
  }
};`;

test('the self-test module gives the same output in a worker as in Node', async ({ page }) => {
  // Both files are served from the page's own origin, as the site serves its modules. A blob: worker
  // would not do: WebKit does not load one through Playwright's request interception.
  await page.context().route(`**${MODULE_PATH}`, (route) => route.fulfill({ body: moduleBytes, contentType: 'application/wasm' }));
  await page.context().route(`**${WORKER_PATH}`, (route) => route.fulfill({ body: workerSource, contentType: 'text/javascript' }));
  await page.goto('/about');

  const result = await page.evaluate(
    async ({ modulePath, workerPath }) => {
      const module = await WebAssembly.compileStreaming(fetch(new URL(modulePath, location.href)));
      const worker = new Worker(new URL(workerPath, location.href));
      try {
        return await new Promise<{ hex?: string; error?: string }>((resolve) => {
          worker.onmessage = (event) => resolve(event.data);
          worker.onmessageerror = () => resolve({ error: 'the compiled module could not be sent to the worker' });
          worker.onerror = (event) => resolve({ error: `worker failed: ${event.message || 'no message'}` });
          worker.postMessage(module);
        });
      } finally {
        worker.terminate();
      }
    },
    { modulePath: MODULE_PATH, workerPath: WORKER_PATH }
  );

  expect(result.error).toBeUndefined();
  expect(result.hex?.length ?? 0).toBeGreaterThan(0);
  const digest = createHash('sha256').update(Buffer.from(result.hex ?? '', 'hex')).digest('hex');
  expect(digest).toBe(SELFTEST_BATTERY_SHA256);
});
