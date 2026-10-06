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


import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  verifyHandshakeFrame,
  HANDSHAKE_WATCHDOG_MS,
  type HandshakeVerifierDeps,
} from '../index';

/** A Scannability Worker stand-in the test answers by hand. */
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const frame = { size: 21, data: new Uint8Array(21 * 21).fill(1) };

function deps(worker: FakeWorker | null, mainThreadVerdict: boolean) {
  const checkOnMainThread = vi.fn(() => mainThreadVerdict);
  const verifierDeps: HandshakeVerifierDeps = {
    createWorker: () => worker as unknown as Worker | null,
    checkOnMainThread,
    createCanvas: () => document.createElement('canvas'),
    watchdogMs: HANDSHAKE_WATCHDOG_MS,
  };
  return { verifierDeps, checkOnMainThread };
}

/** Lets the verifier's synchronous setup run. */
const flush = () => Promise.resolve();

describe('verifyHandshakeFrame', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the worker verdict when it arrives after 100ms but inside the watchdog', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const { verifierDeps, checkOnMainThread } = deps(worker, false);

    const verdict = verifyHandshakeFrame(frame, verifierDeps);
    await flush();
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ configId: 'handshake-gate', moduleCount: 21, width: 512, height: 512 })
    );

    await vi.advanceTimersByTimeAsync(300);
    worker.reply({ success: true, physicalReady: true, configId: 'handshake-gate' });

    await expect(verdict).resolves.toBe(true);
    expect(checkOnMainThread).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('reports a failing worker verdict without consulting the main thread', async () => {
    const worker = new FakeWorker();
    const { verifierDeps, checkOnMainThread } = deps(worker, true);

    const verdict = verifyHandshakeFrame(frame, verifierDeps);
    await flush();
    worker.reply({ success: false, physicalReady: false, configId: 'handshake-gate' });

    await expect(verdict).resolves.toBe(false);
    expect(checkOnMainThread).not.toHaveBeenCalled();
  });

  it('falls back to the main-thread check once the watchdog fires, and ignores a late worker reply', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const { verifierDeps, checkOnMainThread } = deps(worker, false);

    const verdict = verifyHandshakeFrame(frame, verifierDeps);
    await flush();
    await vi.advanceTimersByTimeAsync(HANDSHAKE_WATCHDOG_MS);
    worker.reply({ success: true, physicalReady: true, configId: 'handshake-gate' });

    await expect(verdict).resolves.toBe(false);
    expect(checkOnMainThread).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('runs the main-thread check when no worker can be spawned', async () => {
    const { verifierDeps, checkOnMainThread } = deps(null, true);

    await expect(verifyHandshakeFrame(frame, verifierDeps)).resolves.toBe(true);
    expect(checkOnMainThread).toHaveBeenCalledWith(expect.objectContaining({ moduleCount: 21, width: 512, height: 512 }));
  });

  it('runs the main-thread check when the worker errors or drops the request', async () => {
    const erroring = new FakeWorker();
    const first = deps(erroring, true);
    const erroredVerdict = verifyHandshakeFrame(frame, first.verifierDeps);
    await flush();
    erroring.onerror?.(new Event('error'));
    await expect(erroredVerdict).resolves.toBe(true);
    expect(first.checkOnMainThread).toHaveBeenCalledTimes(1);

    const dropping = new FakeWorker();
    const second = deps(dropping, false);
    const droppedVerdict = verifyHandshakeFrame(frame, second.verifierDeps);
    await flush();
    dropping.reply({ dropped: true, configId: 'handshake-gate' });
    await expect(droppedVerdict).resolves.toBe(false);
    expect(second.checkOnMainThread).toHaveBeenCalledTimes(1);
  });

  it('treats a throwing main-thread check as not scannable', async () => {
    const { verifierDeps } = deps(null, true);
    verifierDeps.checkOnMainThread = () => {
      throw new Error('decoder crashed');
    };
    await expect(verifyHandshakeFrame(frame, verifierDeps)).resolves.toBe(false);
  });
});
