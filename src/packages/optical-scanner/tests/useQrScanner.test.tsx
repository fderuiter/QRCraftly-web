// @vitest-environment jsdom
/**
 * Smoke tests for the thin React adapter over the Camera Scanner Engine.
 * Engine behaviour (watchdog, backoff, fallback, backpressure) is covered headlessly in
 * cameraScannerEngine.test.ts; here we only check that the hook proxies events and tears down.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React, { useEffect } from 'react';
import { useQrScanner } from '../client';
import { terminateScannerWorker } from '../scheduler';

interface MockWorkerLike {
  dispatchMessage: (data: unknown) => void;
  removeEventListener: { mock: { calls: unknown[][] } };
}

function makeLiveVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'paused', { value: false });
  Object.defineProperty(video, 'srcObject', { value: { id: 'camera' }, writable: true });
  Object.defineProperty(video, 'videoWidth', { value: 640 });
  Object.defineProperty(video, 'videoHeight', { value: 480 });
  Object.defineProperty(video, 'readyState', { value: 4 });
  return video;
}

describe('useQrScanner adapter', () => {
  let posted: Array<{ message: { sequenceId: number; epochId?: number }; worker: MockWorkerLike }>;

  beforeEach(() => {
    vi.useFakeTimers();
    posted = [];
    globalThis.mockWorkerControl.setInterceptor((message, worker) => {
      posted.push({ message, worker });
    });
  });

  afterEach(() => {
    globalThis.mockWorkerControl.setInterceptor(null);
    terminateScannerWorker();
    vi.useRealTimers();
  });

  const flushFrames = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it('proxies scan results and batched status into React state without exposing the worker', async () => {
    const onScanSuccess = vi.fn();
    const videoRef = { current: makeLiveVideo() };
    const { result } = renderHook(() => useQrScanner({ videoRef, onScanSuccess, confirmations: 1 }));

    expect(result.current).not.toHaveProperty('workerRef');
    expect(result.current.status).toBe('idle');

    act(() => result.current.startScanning());
    expect(result.current.isScanning).toBe(true);

    await flushFrames(100);
    expect(posted.length).toBeGreaterThan(0);

    const { message, worker } = posted[posted.length - 1];
    act(() => {
      worker.dispatchMessage({
        status: 'pass',
        decodedData: 'HELLO',
        sequenceId: message.sequenceId,
        epochId: message.epochId,
      });
    });
    await flushFrames(20);
    expect(onScanSuccess).toHaveBeenCalledWith('HELLO', expect.objectContaining({ text: 'HELLO', source: 'qr-decode' }));

    await flushFrames(250);
    expect(result.current.latencyHistory.length).toBeGreaterThan(0);

    act(() => result.current.stopScanning());

    expect(result.current.isScanning).toBe(false);
    expect(result.current.status).toBe('idle');
  });

  it('stops sampling and detaches from the worker on unmount', async () => {
    const videoRef = { current: makeLiveVideo() };
    const { result, unmount } = renderHook(() => useQrScanner({ videoRef }));

    act(() => result.current.startScanning());
    await flushFrames(100);
    expect(posted.length).toBe(1);
    const { worker } = posted[0];

    unmount();
    const removed = worker.removeEventListener.mock.calls.map((call) => call[0]);
    expect(removed).toEqual(expect.arrayContaining(['message', 'error', 'messageerror']));

    await flushFrames(5000);
    expect(posted.length).toBe(1);
  });

  it('opens one camera and starts sampling when a StrictMode effect starts it twice (#1097)', async () => {
    const tracks: Array<{ live: boolean }> = [];
    const getUserMedia = vi.fn(async () => {
      const track = { live: true };
      tracks.push(track);
      return {
        getTracks: () => [{ stop: () => { track.live = false; } }],
      };
    });
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true, writable: true });
    const video = makeLiveVideo();
    video.play = vi.fn(async () => {});
    video.pause = vi.fn();
    const videoRef = { current: video };

    try {
      const { result, unmount } = renderHook(
        () => {
          const scanner = useQrScanner({ videoRef });
          const { start, stop } = scanner;
          useEffect(() => {
            void start();
            return () => stop();
          }, [start, stop]);
          return scanner;
        },
        { wrapper: React.StrictMode }
      );
      await flushFrames(100);

      expect(tracks.filter((track) => track.live)).toHaveLength(1);
      expect(result.current.state.status).toBe('streaming');
      expect(result.current.isScanning).toBe(true);
      expect(posted.length).toBeGreaterThan(0);

      unmount();
      expect(tracks.filter((track) => track.live)).toHaveLength(0);
      expect(video.srcObject).toBeNull();
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true, writable: true });
    }
  });
});
