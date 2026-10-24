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

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOpticalSender } from '../client';
import { senderOptions } from './fixtures';

type WorkerMessage = { type: string };
type ScriptedWorker = { dispatchMessage: (message: unknown) => void };

/** Renders the sender with a file chosen and a slice worker that answers START with `answer`. */
function renderSender(options: ReturnType<typeof senderOptions>, answer: (worker: ScriptedWorker) => void) {
  const hook = renderHook(() => useOpticalSender(options));
  hook.result.current.canvasRef.current = document.createElement('canvas');
  globalThis.mockWorkerControl.setInterceptor((message: WorkerMessage, worker: ScriptedWorker) => {
    if (message.type === 'START') answer(worker);
  });
  return hook;
}

/** Three small frames, so the first one passes the gate and playback starts. */
function threeFrames(worker: ScriptedWorker) {
  worker.dispatchMessage({ type: 'PROGRESS', index: 0, total: 3 });
  for (let index = 0; index < 3; index++) {
    worker.dispatchMessage({ type: 'FRAME', index, total: 3, size: 21, data: new Uint8Array(441) });
  }
}

const payload = () => new File(['payload'], 'p.txt', { type: 'text/plain' });

describe('useOpticalSender phase (#1510)', () => {
  beforeEach(() => {
    globalThis.mockWorkerControl?.reset();
  });

  afterEach(() => {
    globalThis.mockWorkerControl?.setInterceptor(null);
    globalThis.mockWorkerControl?.reset();
  });

  it('goes from idle through a whole run, and every flag follows the phase', async () => {
    const { result } = renderSender(senderOptions(), threeFrames);
    expect(result.current.phase).toBe('idle');

    act(() => result.current.setSelectedFile(payload()));
    expect(result.current.phase).toBe('ready');

    act(() => result.current.startTransfer());
    expect(result.current.phase).toBe('verifying');
    expect(result.current.isVerifyingHandshake).toBe(true);
    expect(result.current.settingsLocked).toBe(true);

    await waitFor(() => expect(result.current.phase).toBe('transmitting'));
    expect(result.current.isTransferring).toBe(true);
    expect(result.current.isVerifyingHandshake).toBe(false);

    act(() => result.current.pauseTransfer());
    expect(result.current.phase).toBe('paused');
    expect(result.current.isPaused).toBe(true);
    expect(result.current.isTransferring).toBe(true);

    act(() => result.current.resumeTransfer());
    expect(result.current.phase).toBe('transmitting');

    act(() => result.current.stopTransfer());
    expect(result.current.phase).toBe('ready');
    expect(result.current.isTransferring).toBe(false);

    act(() => result.current.setSelectedFiles([]));
    expect(result.current.phase).toBe('idle');
  });

  it('fails when the first frame does not scan, and a stop clears it', async () => {
    const { result } = renderSender(senderOptions({ verifyFrame: vi.fn(async () => false) }), threeFrames);
    act(() => result.current.setSelectedFile(payload()));
    act(() => result.current.startTransfer());
    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.isTransferring).toBe(false);
    expect(result.current.handshakeError).toMatch(/failed scannability check/);

    act(() => result.current.stopTransfer());
    expect(result.current.phase).toBe('ready');
    expect(result.current.handshakeError).toBeNull();
  });

  it('fails when the worker reports an error', async () => {
    const { result } = renderSender(senderOptions(), (worker) => worker.dispatchMessage({ type: 'ERROR', message: 'The file could not be read.' }));
    act(() => result.current.setSelectedFile(payload()));
    act(() => result.current.startTransfer());
    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.handshakeError).toBe('The file could not be read.');
  });

  it('asks once more under reduced motion: cancel goes back, the confirmed start verifies', async () => {
    const { result } = renderSender(senderOptions(), threeFrames);
    act(() => result.current.setSelectedFile(payload()));

    act(() => result.current.askToStart());
    expect(result.current.phase).toBe('confirmingMotion');
    act(() => result.current.cancelMotion());
    expect(result.current.phase).toBe('ready');

    act(() => result.current.askToStart());
    act(() => result.current.startTransfer());
    expect(result.current.phase).toBe('verifying');
    await waitFor(() => expect(result.current.phase).toBe('transmitting'));
    act(() => result.current.stopTransfer());
  });
});
