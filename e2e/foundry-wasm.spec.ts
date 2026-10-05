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
 * Cross-engine test for our Rust modules (#1182, ADR 0033). Each engine compiles a committed
 * module from the page's own origin, hands the compiled module to a worker the way the scanner
 * does (ADR 0023), runs the module's fixed battery there, and must return exactly the bytes Node
 * returns.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { test, expect } from './fixtures';
import { runPrismFecBattery, PRISM_FEC_BATTERY_SHA256 } from '../tests/foundry/prismFecBattery';
import { runQrDecodeBattery, QR_DECODE_BATTERY_SHA256 } from '../tests/foundry/qrDecodeBattery';
import { runQrEncodeBattery, QR_ENCODE_BATTERY_SHA256 } from '../tests/foundry/qrEncodeBattery';
import { runSelftestBattery, SELFTEST_BATTERY_SHA256 } from '../tests/foundry/selftestBattery';

const BATTERIES = [
  { module: 'selftest', battery: runSelftestBattery, sha256: SELFTEST_BATTERY_SHA256 },
  { module: 'qr-encode', battery: runQrEncodeBattery, sha256: QR_ENCODE_BATTERY_SHA256 },
  { module: 'qr-decode', battery: runQrDecodeBattery, sha256: QR_DECODE_BATTERY_SHA256 },
  { module: 'prism-fec', battery: runPrismFecBattery, sha256: PRISM_FEC_BATTERY_SHA256 },
];

for (const { module: name, battery, sha256 } of BATTERIES) {
  const modulePath = `/__foundry/${name}.wasm`;
  const workerPath = `/__foundry/${name}-worker.js`;
  const moduleBytes = fs.readFileSync(new URL(`../src/wasm/${name}.wasm`, import.meta.url));

  /** The worker: instantiates the module it is sent and runs the battery on it. */
  const workerSource = `const runBattery = ${battery.toString()};
onmessage = async (event) => {
  try {
    const { exports } = await WebAssembly.instantiate(event.data, {});
    const bytes = runBattery(exports);
    postMessage({ hex: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') });
  } catch (error) {
    postMessage({ error: String(error) });
  }
};`;

  test(`the ${name} module gives the same output in a worker as in Node`, async ({ page }) => {
    // Both files are served from the page's own origin, as the site serves its modules. A blob:
    // worker would not do: WebKit does not load one through Playwright's request interception.
    await page.context().route(`**${modulePath}`, (route) => route.fulfill({ body: moduleBytes, contentType: 'application/wasm' }));
    await page.context().route(`**${workerPath}`, (route) => route.fulfill({ body: workerSource, contentType: 'text/javascript' }));
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
      { modulePath, workerPath }
    );

    expect(result.error).toBeUndefined();
    expect(result.hex?.length ?? 0).toBeGreaterThan(0);
    const digest = createHash('sha256').update(Buffer.from(result.hex ?? '', 'hex')).digest('hex');
    expect(digest).toBe(sha256);
  });
}
