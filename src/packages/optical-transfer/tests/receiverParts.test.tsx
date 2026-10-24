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
// The parts `useOpticalReceiver` is composed of (#1514), each on its own: start, clear, unmount
// (every interval, track and URL released) and restart on a mode change.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { sha256Hex } from '@/packages/core/encoding';
import { useReassemblyWorker, useReceiverTelemetry, useFrameSource, useDelivery, type ReassemblyWorkerEvents, type FrameSourceOptions, type DeliveryOptions } from '../client';

vi.mock('@/packages/qr-matrix/encoder', () => ({
  loadQrEncoder: async () => ({ create: () => ({ version: 2, modules: { size: 25, data: new Uint8Array(625) } }) }),
}));

beforeEach(() => {
  globalThis.mockWorkerControl.reset();
  global.URL.createObjectURL = vi.fn(() => 'blob:video');
  global.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.mockWorkerControl.reset();
});

function workerEvents(): ReassemblyWorkerEvents {
  return { onManifest: vi.fn(), onKeyStatus: vi.fn(), onSwitchOffer: vi.fn(), onProgress: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };
}

/** Delivers a message as if the worker had posted it. */
function fromWorker(worker: Worker, data: unknown) {
  worker.onmessage?.(new MessageEvent('message', { data }));
}

describe('useReassemblyWorker', () => {
  it('spawns one worker, routes its messages, and marks a Prism stream active', () => {
    const events = workerEvents();
    const { result } = renderHook(() => useReassemblyWorker(events));
    const worker = result.current.initWorker();
    expect(result.current.initWorker()).toBe(worker);
    expect(result.current.prismActive()).toBe(false);
    const manifest = { sessionId: 'ab', fileName: 'a.txt' };
    fromWorker(worker, { type: 'MANIFEST', manifest, needsKey: true });
    expect(events.onManifest).toHaveBeenCalledWith(manifest, true);
    expect(result.current.prismActive()).toBe(true);
    fromWorker(worker, { type: 'KEY_STATUS', accepted: false });
    expect(events.onKeyStatus).toHaveBeenCalledWith(false);
    fromWorker(worker, { type: 'ERROR' });
    expect(events.onError).toHaveBeenCalledWith('Failed to compile binary content.');
  });

  it('posts CLEAR on terminate, bumps the run, and ignores a stopped worker', () => {
    const events = workerEvents();
    const { result } = renderHook(() => useReassemblyWorker(events));
    const worker = result.current.initWorker();
    const run = result.current.currentRun();
    act(() => result.current.terminateWorker());
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'CLEAR' });
    expect(worker.terminate).toHaveBeenCalled();
    expect(result.current.currentRun()).toBe(run + 1);
    expect(result.current.prismActive()).toBe(false);
    fromWorker(worker, { type: 'PROGRESS', rank: 1 });
    expect(events.onProgress).not.toHaveBeenCalled();
  });

  it('tells a fresh worker to ignore the session that just finished', () => {
    const events = workerEvents();
    const { result } = renderHook(() => useReassemblyWorker(events));
    fromWorker(result.current.initWorker(), { type: 'COMPLETE', session: 'done-session' });
    expect(events.onComplete).toHaveBeenCalled();
    act(() => result.current.terminateWorker());
    const fresh = result.current.initWorker();
    expect(fresh.postMessage).toHaveBeenCalledWith({ type: 'IGNORE_SESSION', session: 'done-session' });
  });

  it('ends the worker on unmount', () => {
    const { result, unmount } = renderHook(() => useReassemblyWorker(workerEvents()));
    const worker = result.current.initWorker();
    unmount();
    expect(worker.terminate).toHaveBeenCalled();
  });
});

describe('useReceiverTelemetry', () => {
  const scanning = { multiCode: true, isScanning: true, receiverSuccess: false, sessionId: '00'.repeat(8), fountainStats: null };

  it('runs the 1 s hint and the 250 ms feedback code, and stops both on unmount', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useReceiverTelemetry(scanning));
    expect(vi.getTimerCount()).toBe(1);
    act(() => result.current.setSteerSender(true));
    expect(result.current.feedbackActive).toBe(true);
    expect(vi.getTimerCount()).toBe(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops the hint when scanning stops', () => {
    vi.useFakeTimers();
    const { rerender } = renderHook((inputs) => useReceiverTelemetry(inputs), { initialProps: scanning });
    expect(vi.getTimerCount()).toBe(1);
    rerender({ ...scanning, isScanning: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hints at a stall after the manifest, and Clear forgets it', () => {
    vi.useFakeTimers();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { result } = renderHook(() => useReceiverTelemetry(scanning));
    act(() => result.current.noteManifest());
    now += 6000;
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.layerHint).not.toBeNull();
    act(() => result.current.reset());
    expect(result.current.layerHint).toBeNull();
  });

  it('counts a higher rank as progress', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { result } = renderHook(() => useReceiverTelemetry(scanning));
    result.current.recordDroplet();
    now += 500;
    const stats = result.current.noteProgress({ k: 10, rank: 4, resolved: 4, dropletsReceived: 4, progress: 0.4 });
    expect(stats).toMatchObject({ k: 10, rank: 4 });
  });
});

function frameSourceOptions(overrides: Partial<FrameSourceOptions> = {}): FrameSourceOptions {
  return { initialMode: 'file', multiCode: false, dispatch: vi.fn(), onFrame: vi.fn(), onFrameRead: vi.fn(), onRelease: vi.fn(), ...overrides };
}

const video = (name = 'clip.mp4') => new File([new Uint8Array(16)], name, { type: 'video/mp4' });

describe('useFrameSource', () => {
  it('loads a video, and Clear revokes its object URL', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useFrameSource(frameSourceOptions({ dispatch })));
    act(() => {
      expect(result.current.handleFileUpload(video())).toBe(true);
    });
    expect(result.current.videoObjectUrl).toBe('blob:video');
    expect(result.current.isScanning).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'loadVideo' });
    act(() => result.current.clearVideo());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video');
    expect(result.current.videoFile).toBeNull();
  });

  it('refuses a file that is not a video, as a file failure', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useFrameSource(frameSourceOptions({ dispatch })));
    act(() => {
      expect(result.current.handleFileUpload(new File(['x'], 'note.txt', { type: 'text/plain' }))).toBe(false);
    });
    expect(result.current.fileValidationError).not.toBeNull();
    expect(dispatch).toHaveBeenCalledWith({ type: 'fail', error: { source: 'file', message: expect.any(String) } });
  });

  it('revokes the URL when switching to the camera', () => {
    const { result } = renderHook(() => useFrameSource(frameSourceOptions()));
    act(() => {
      result.current.handleFileUpload(video());
    });
    act(() => result.current.setReceiverMode('camera'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video');
    expect(result.current.isScanning).toBe(false);
  });

  it('on unmount, releases the video, then runs onRelease, then revokes the URL', () => {
    const order: string[] = [];
    const onRelease = vi.fn(() => order.push('release'));
    vi.mocked(URL.revokeObjectURL).mockImplementation(() => order.push('revoke'));
    const { result, unmount } = renderHook(() => useFrameSource(frameSourceOptions({ onRelease })));
    act(() => {
      result.current.handleFileUpload(video());
    });
    unmount();
    expect(order).toEqual(['release', 'revoke']);
  });

  describe('camera', () => {
    let originalMediaDevices: MediaDevices | undefined;
    let track: { stop: ReturnType<typeof vi.fn> };
    let getUserMedia: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      originalMediaDevices = navigator.mediaDevices;
      track = { stop: vi.fn() };
      getUserMedia = vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }));
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true, writable: true });
    });

    afterEach(() => {
      Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true, writable: true });
    });

    function withVideo(ref: { current: HTMLVideoElement | null }) {
      const element = document.createElement('video');
      element.play = vi.fn(async () => {});
      ref.current = element;
    }

    it('starts the camera and stops its track on unmount', async () => {
      const dispatch = vi.fn();
      const { result, unmount } = renderHook(() => useFrameSource(frameSourceOptions({ initialMode: 'camera', dispatch })));
      withVideo(result.current.videoRef);
      await act(async () => {
        await result.current.startCameraStream();
      });
      expect(dispatch).toHaveBeenCalledWith({ type: 'startCamera' });
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      unmount();
      expect(track.stop).toHaveBeenCalled();
    });

    it('restarts the camera when the multi-code reader is switched while it streams', async () => {
      const { result, rerender } = renderHook((options) => useFrameSource(options), { initialProps: frameSourceOptions({ initialMode: 'camera' }) });
      withVideo(result.current.videoRef);
      await act(async () => {
        await result.current.startCameraStream();
      });
      await waitFor(() => expect(result.current.camera).not.toBeNull());
      rerender(frameSourceOptions({ initialMode: 'camera', multiCode: true }));
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    });
  });
});

function deliveryOptions(overrides: Partial<DeliveryOptions> = {}): DeliveryOptions {
  return { dispatch: vi.fn(), saveFile: vi.fn(), autoDownload: true, setReceiverError: vi.fn(), currentRun: () => 0, onStreamDone: vi.fn(), ...overrides };
}

const bytes = new TextEncoder().encode('delivered bytes');

async function handshakeFor(fileName = 'note.txt', data = bytes) {
  return { fileName, fileSize: data.byteLength, mimeType: 'text/plain', sha256: await sha256Hex(data) };
}

describe('useDelivery', () => {
  it('checks the file, saves it automatically and ends the stream', async () => {
    const options = deliveryOptions();
    const { result } = renderHook(() => useDelivery(options));
    const handshake = await handshakeFor();
    await act(async () => {
      await result.current.handleWorkerComplete({ type: 'COMPLETE', buffer: bytes.slice().buffer, handshake });
    });
    expect(options.onStreamDone).toHaveBeenCalled();
    expect(result.current.receiverSuccess).toBe(true);
    expect(options.saveFile).toHaveBeenCalledWith(expect.any(Uint8Array), 'note.txt', 'text/plain');
    expect(result.current.downloadTriggered).toBe(true);
  });

  it('fails on a hash mismatch and saves nothing', async () => {
    const options = deliveryOptions();
    const { result } = renderHook(() => useDelivery(options));
    const handshake = { ...(await handshakeFor()), sha256: '00'.repeat(32) };
    await act(async () => {
      await result.current.handleWorkerComplete({ type: 'COMPLETE', buffer: bytes.slice().buffer, handshake });
    });
    expect(result.current.receiverSuccess).toBe(false);
    expect(options.setReceiverError).toHaveBeenCalledWith(expect.stringContaining('Integrity validation failed'));
    expect(options.saveFile).not.toHaveBeenCalled();
  });

  it('drops a completion that Clear overtook while it was checked', async () => {
    let run = 0;
    const options = deliveryOptions({ currentRun: () => run });
    const { result } = renderHook(() => useDelivery(options));
    const handshake = await handshakeFor();
    await act(async () => {
      const done = result.current.handleWorkerComplete({ type: 'COMPLETE', buffer: bytes.slice().buffer, handshake });
      run += 1;
      await done;
    });
    expect(result.current.receiverSuccess).toBe(false);
    expect(options.saveFile).not.toHaveBeenCalled();
  });

  it('holds a risky file for the person to confirm, then saves it on request', async () => {
    const options = deliveryOptions();
    const { result } = renderHook(() => useDelivery(options));
    const handshake = { ...(await handshakeFor('run.exe')), mimeType: 'application/octet-stream' };
    await act(async () => {
      await result.current.handleWorkerComplete({ type: 'COMPLETE', buffer: bytes.slice().buffer, handshake });
    });
    expect(result.current.receiverSuccess).toBe(true);
    expect(options.saveFile).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.saveReceivedFile();
    });
    expect(options.saveFile).toHaveBeenCalledTimes(1);
  });

  it('keeps a bundle for saving by hand, and Clear forgets it', async () => {
    const options = deliveryOptions();
    const { result } = renderHook(() => useDelivery(options));
    const handshake = await handshakeFor();
    await act(async () => {
      await result.current.handleWorkerComplete({ type: 'COMPLETE', files: [{ buffer: bytes.slice().buffer, handshake }] });
    });
    expect(result.current.bundle).toHaveLength(1);
    expect(options.saveFile).not.toHaveBeenCalled();
    act(() => result.current.reset());
    expect(result.current.bundle).toBeNull();
    expect(result.current.receiverSuccess).toBe(false);
  });
});
