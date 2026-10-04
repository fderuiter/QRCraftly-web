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

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { useOpticalSender } from '../client';
import { senderOptions } from './fixtures';
import { QRStyle } from '@/types';


describe('useOpticalSender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (globalThis.mockWorkerControl) {
      globalThis.mockWorkerControl.reset();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    if (globalThis.mockWorkerControl) {
      globalThis.mockWorkerControl.reset();
    }
  });

  it('should initialize with standard defaults', () => {
    const { result } = renderHook(() =>
      useOpticalSender(senderOptions())
    );

    expect(result.current.selectedFile).toBeNull();
    expect(result.current.isTransferring).toBe(false);
    expect(result.current.progress).toBe(0);
    expect(result.current.fps).toBe(15);
    // The balanced density sizes the symbols.
    expect(result.current.density).toBe('balanced');
    expect(result.current.currentPass).toBe(1);
  });

  it('should handle simulated 50MB file selection', () => {
    const { result } = renderHook(() =>
      useOpticalSender(senderOptions())
    );

    act(() => {
      result.current.simulate50MBFile();
    });

    expect(result.current.selectedFile).not.toBeNull();
    expect(result.current.selectedFile?.name).toBe('simulation_50mb_payload.bin');
    expect(result.current.selectedFile?.size).toBe(50 * 1024 * 1024);
  });

  it('sends the fps parameter to the worker on START', async () => {
    const { result } = renderHook(() =>
      useOpticalSender(senderOptions())
    );

    act(() => {
      result.current.setSelectedFile(new File(['test content'], 'test.txt', { type: 'text/plain' }));
    });

    let startMessage: any = null;
    globalThis.mockWorkerControl.setInterceptor((message: any) => {
      if (message.type === 'START') {
        startMessage = message;
      }
    });

    act(() => {
      result.current.startTransfer();
    });

    await waitFor(() => {
      expect(startMessage).not.toBeNull();
    });
    expect(startMessage.payload.fps).toBe(15);
  });

  it('triggers the self-healing watch loop when frame generation is stalled for 100ms', async () => {
    let nowTime = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowTime);
    vi.useFakeTimers();

    const { result } = renderHook(() =>
      useOpticalSender(senderOptions())
    );

    act(() => {
      result.current.setSelectedFile(new File(['test content'], 'test.txt', { type: 'text/plain' }));
    });

    const sentMessages: any[] = [];
    globalThis.mockWorkerControl.setInterceptor((message: any, worker: any) => {
      sentMessages.push(message);
      if (message.type === 'START') {
        worker.dispatchMessage({
          type: 'PROGRESS',
          total: 10,
        });
        worker.dispatchMessage({
          type: 'FRAME',
          index: 0,
          total: 10,
          size: 21,
          data: new Uint8Array(21 * 21),
        });
      }
    });

    await act(async () => {
      result.current.startTransfer();
    });

    // Advance fake timer 1ms to fire worker postMessage task for START
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    // Advance 70ms so frame 0 renders and currentPlayIndex becomes 1
    nowTime += 70;
    act(() => {
      vi.advanceTimersByTime(70);
      vi.advanceTimersByTime(10);
    });

    // Clear initial messages (like START and ACK 0)
    sentMessages.length = 0;

    // Advance time by 120ms (>= 100ms) with frame 1 missing
    nowTime += 120;
    act(() => {
      vi.advanceTimersByTime(120);
    });

    // Advance 10ms to fire MockWorker postMessage task for HEAL
    nowTime += 10;
    act(() => {
      vi.advanceTimersByTime(10);
    });

    // Check if self-healing (HEAL and ACK messages) were sent to the worker
    const healMessages = sentMessages.filter(m => m.type === 'HEAL');
    const ackMessages = sentMessages.filter(m => m.type === 'ACK');

    expect(healMessages.length).toBeGreaterThan(0);
    expect(ackMessages.length).toBeGreaterThan(0);
    expect(healMessages[0].payload.lastAckedIndex).toBe(0);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('supports adaptive density and frame memory pool caching across multiple passes', () => {
    const { result } = renderHook(() =>
      useOpticalSender(senderOptions())
    );

    const dummyFile = new File(['Hello World Payload Array For Testing Animated Transfers'], 'test.txt', {
      type: 'text/plain',
    });

    act(() => {
      result.current.setSelectedFile(dummyFile);
    });

    expect(result.current.selectedFile).toBe(dummyFile);
    expect(result.current.currentPass).toBe(1);

    // Simulate pre-allocated memory pool frame population
    act(() => {
      result.current.framePoolRef.current.storeFrame(0, 29, new Uint8Array(29 * 29).fill(1));
      result.current.framePoolRef.current.storeFrame(1, 29, new Uint8Array(29 * 29).fill(2));
    });

    expect(result.current.framePoolRef.current.size).toBe(2);
    expect(result.current.framePoolRef.current.hasFrame(0)).toBe(true);
    expect(result.current.framePoolRef.current.hasFrame(1)).toBe(true);
  });

  it('unconditionally clears target value synchronously on every handleFileChange event', () => {
    const { result } = renderHook(() =>
      useOpticalSender(senderOptions())
    );

    // Scenario 1: File selected
    const dummyFile = new File(['content'], 'sample.txt', { type: 'text/plain' });
    const mockTarget1 = { files: [dummyFile], value: 'C:\\fakepath\\sample.txt' };
    
    act(() => {
      result.current.handleFileChange({ target: mockTarget1 } as any);
    });

    expect(result.current.selectedFile).toBe(dummyFile);
    expect(mockTarget1.value).toBe('');

    // Scenario 2: Selection canceled (empty files list)
    const mockTarget2 = { files: [], value: 'C:\\fakepath\\sample2.txt' };
    
    act(() => {
      result.current.handleFileChange({ target: mockTarget2 } as any);
    });

    // File selection should remain or not crash, target value must be cleared synchronously
    expect(mockTarget2.value).toBe('');
  });

  /** Starts a transfer whose slice worker answers START with `frames` frames. */
  async function startWithFrames(options: ReturnType<typeof senderOptions>, frames = 3) {
    const hook = renderHook(() => useOpticalSender(options));
    hook.result.current.canvasRef.current = document.createElement('canvas');
    act(() => {
      hook.result.current.setSelectedFile(new File(['payload'], 'p.txt', { type: 'text/plain' }));
    });
    globalThis.mockWorkerControl.setInterceptor((message: any, worker: any) => {
      if (message.type === 'START') {
        worker.dispatchMessage({ type: 'PROGRESS', index: 0, total: frames });
        for (let index = 0; index < frames; index++) {
          worker.dispatchMessage({ type: 'FRAME', index, total: frames, size: 21, data: new Uint8Array(441) });
        }
      }
    });
    await act(async () => {
      hook.result.current.startTransfer();
    });
    return hook;
  }

  it('gates playback on the injected verifier and paints frames with the injected renderer', async () => {
    const options = senderOptions();
    const { result } = await startWithFrames(options);

    await waitFor(() => expect(result.current.isTransferring).toBe(true));
    expect(options.verifyFrame).toHaveBeenCalledTimes(1);
    // Fountain frames are checked as they are shown: sanitized, without logos.
    expect(options.verifyFrame).toHaveBeenCalledWith(
      expect.objectContaining({ size: 21 }),
      expect.objectContaining({ style: QRStyle.STANDARD, logoUrl: null }),
      null,
      null
    );
    await waitFor(() => expect(options.renderFrame).toHaveBeenCalled());
    expect(options.renderFrame).toHaveBeenCalledWith(
      result.current.canvasRef.current,
      expect.objectContaining({ size: 21 }),
      expect.objectContaining({ fgColor: '#000000' }),
      null,
      null
    );
    act(() => result.current.stopTransfer());
    globalThis.mockWorkerControl.setInterceptor(null);
  });

  it('pauses on the current frame at once, paints nothing while paused, and resumes (#1148)', async () => {
    const options = senderOptions();
    const { result } = await startWithFrames(options);
    await waitFor(() => expect(result.current.isTransferring).toBe(true));
    await waitFor(() => expect(options.renderFrame).toHaveBeenCalled());
    expect(result.current.isPaused).toBe(false);

    act(() => result.current.pauseTransfer());
    expect(result.current.isPaused).toBe(true);
    expect(result.current.isTransferring).toBe(true);
    const paintedAtPause = vi.mocked(options.renderFrame).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(vi.mocked(options.renderFrame).mock.calls.length).toBe(paintedAtPause);

    act(() => result.current.resumeTransfer());
    expect(result.current.isPaused).toBe(false);
    await waitFor(() => expect(vi.mocked(options.renderFrame).mock.calls.length).toBeGreaterThan(paintedAtPause));

    // Stopping clears the pause, and pausing a stream that is not playing does nothing.
    act(() => result.current.pauseTransfer());
    act(() => result.current.stopTransfer());
    expect(result.current.isPaused).toBe(false);
    act(() => result.current.pauseTransfer());
    expect(result.current.isPaused).toBe(false);
    globalThis.mockWorkerControl.setInterceptor(null);
  });

  it('keeps playback paused when the injected verifier rejects the first frame', async () => {
    const options = senderOptions({ verifyFrame: vi.fn(async () => false) });
    const { result } = await startWithFrames(options);

    await waitFor(() => expect(result.current.handshakeError).toMatch(/failed scannability check/));
    expect(result.current.isTransferring).toBe(false);
    expect(result.current.handshakeVerified).toBe(false);
    expect(options.renderFrame).not.toHaveBeenCalled();
    globalThis.mockWorkerControl.setInterceptor(null);
  });

  it('never paints decoration on transfer frames, whatever the page style', async () => {
    const options = senderOptions({
      config: { ...senderOptions().config, isMazeEnabled: true, isMazeBridgesEnabled: true },
    });
    const { result } = await startWithFrames(options);

    await waitFor(() => expect(result.current.isTransferring).toBe(true));
    expect(options.verifyFrame).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isMazeEnabled: false, isMazeBridgesEnabled: false }),
      null,
      null
    );
    await waitFor(() => expect(options.renderFrame).toHaveBeenCalled());
    expect(options.renderFrame).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ isMazeEnabled: false, isMazeBridgesEnabled: false }),
      null,
      null
    );
    act(() => result.current.stopTransfer());
    globalThis.mockWorkerControl.setInterceptor(null);
  });

  it('reports the frame pool buffer size as frame memory while transferring', async () => {
    const options = senderOptions();
    const { result } = await startWithFrames(options);
    expect(result.current.transferStats.fileName).toBe('p.txt');

    await waitFor(() => expect(result.current.isTransferring).toBe(true));
    const poolBytes = result.current.framePoolRef.current.byteLength;
    expect(poolBytes).toBeGreaterThan(0);
    expect(result.current.transferStats.frameBufferMemory).toBe(`${(poolBytes / 1024 / 1024).toFixed(2)} MB`);

    act(() => result.current.stopTransfer());
    expect(result.current.transferStats.frameBufferMemory).toBe('0.00 MB');
    globalThis.mockWorkerControl.setInterceptor(null);
  });
});
