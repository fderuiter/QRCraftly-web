// @vitest-environment jsdom
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
 * The mock Worker in vitest.setup.ts runs tasks under a concurrency cap. A task still waiting on its
 * delay when `reset()` runs must neither run nor free a slot afterwards, or the next test's cap is
 * exceeded (#1608).
 */
import { describe, it, expect, vi } from 'vitest';

const WORKER_URL = new URL('../src/packages/scannability/worker.ts', import.meta.url);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('mock worker reset', () => {
  it('cancels tasks in flight and keeps the concurrency cap for tasks started after it', async () => {
    const control = globalThis.mockWorkerControl;
    const worker = new Worker(WORKER_URL, { type: 'module' });
    await (worker as unknown as { ready: Promise<void> }).ready;

    control.setDelay(50);
    control.setConcurrencyLimit(1);
    control.setInterceptor(() => {});
    worker.postMessage({ id: 'old-1' });
    worker.postMessage({ id: 'old-2' });
    worker.postMessage({ id: 'old-3' });
    expect(control.runningCount()).toBe(1);

    // reset() clears the interceptor, delay and cap, so the next phase sets them again.
    control.reset();
    expect(control.runningCount()).toBe(0);

    // The delay timer of the task that was in flight must not fire into the new phase.
    const ranAfterReset: string[] = [];
    control.setDelay(50);
    control.setConcurrencyLimit(1);
    control.setInterceptor(message => {
      ranAfterReset.push(message.id);
    });
    await sleep(120);
    expect(ranAfterReset).toEqual([]);
    expect(control.runningCount()).toBe(0);

    // Tasks started after the reset run one at a time, and never with a negative count.
    const delivered: string[] = [];
    const activeAtDelivery: number[] = [];
    control.setInterceptor(message => {
      delivered.push(message.id);
      activeAtDelivery.push(control.runningCount());
    });
    worker.postMessage({ id: 'new-1' });
    worker.postMessage({ id: 'new-2' });
    worker.postMessage({ id: 'new-3' });

    await vi.waitFor(() => expect(delivered).toEqual(['new-1', 'new-2', 'new-3']), { timeout: 2000, interval: 5 });
    expect(activeAtDelivery).toEqual([1, 1, 1]);
    expect(control.runningCount()).toBe(0);

    worker.terminate();
  });
});
