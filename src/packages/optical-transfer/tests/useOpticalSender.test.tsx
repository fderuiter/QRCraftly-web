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
import { encodeFeedbackFrame } from '../index';

/**
 * Gives a canvas a 2D context that only takes fills. The multi-code tests check the timeline, not
 * pixels, and the setup's per-pixel canvas mock takes most of a second to fill a 1000 px tile
 * canvas, which raced the default `waitFor` timeout on a busy machine (#1246).
 * @param canvas - The transfer canvas.
 */
function giveFillOnlyContext(canvas: HTMLCanvasElement) {
  const ctx = { fillStyle: '', fillRect: vi.fn() };
  canvas.getContext = vi.fn(() => ctx) as unknown as HTMLCanvasElement['getContext'];
}

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

  describe('several codes per frame (#1142)', () => {
    /** Attaches a transfer canvas inside a container of the given width. */
    function attachCanvas(current: { canvasRef: React.MutableRefObject<HTMLCanvasElement | null> }, width: number) {
      const container = document.createElement('div');
      Object.defineProperty(container, 'clientWidth', { value: width, configurable: true });
      const canvas = document.createElement('canvas');
      giveFillOnlyContext(canvas);
      container.appendChild(canvas);
      current.canvasRef.current = canvas;
      return canvas;
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('keeps one code per frame when the screen is too small for tiles', async () => {
      const { result } = renderHook(() => useOpticalSender(senderOptions()));
      act(() => {
        result.current.setSelectedFile(new File(['tiny'], 'tiny.txt', { type: 'text/plain' }));
        result.current.setMultiCode(true);
      });
      attachCanvas(result.current, 200);
      let start: any = null;
      globalThis.mockWorkerControl.setInterceptor((message: any) => {
        if (message.type === 'START') start = message;
      });
      act(() => result.current.startTransfer());
      await waitFor(() => expect(start).not.toBeNull());
      expect(start.payload.tiles).toBeUndefined();
      expect(result.current.tileInfo).toBeNull();
    });

    it('holds every frame for whole display refreshes, staggers the diagonal tile groups and slots in beacons', async () => {
      vi.stubGlobal('innerHeight', 1000);
      vi.stubGlobal('devicePixelRatio', 1);
      const callbacks: Array<(time: number) => void> = [];
      vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => callbacks.push(callback));
      vi.stubGlobal('cancelAnimationFrame', () => undefined);

      const options = senderOptions();
      const { result } = renderHook(() => useOpticalSender(options));
      act(() => {
        result.current.setSelectedFile(new File(['tile content'], 'tiles.txt', { type: 'text/plain' }));
        result.current.setMultiCode(true);
      });
      attachCanvas(result.current, 1000);

      let start: any = null;
      let refresh = -1;
      const acks: Array<{ refresh: number; index: number }> = [];
      let heals = 0;
      const sentHeal = () => heals > 0;
      globalThis.mockWorkerControl.setInterceptor((message: any, worker: any) => {
        if (message.type === 'ACK') acks.push({ refresh, index: message.payload.index });
        if (message.type === 'HEAL') heals += 1;
        if (message.type !== 'START') return;
        start = message;
        worker.dispatchMessage({ type: 'PROGRESS', total: 64 });
        // Balanced prefers a 2x2 v20 layout (tiles of 97 modules) with a v30 beacon every 8th frame.
        for (let index = 0; index < 40; index++) worker.dispatchMessage({ type: 'FRAME', index, total: 64, size: 97, data: new Uint8Array(97 * 97) });
        worker.dispatchMessage({ type: 'BEACON', index: 0, size: 137, data: new Uint8Array(137 * 137) });
      });

      act(() => result.current.startTransfer());
      await waitFor(() => expect(result.current.isTransferring).toBe(true));
      expect(start.payload.tiles).toBe('2x2-v20');
      expect(start.payload.beacon).toEqual({ version: 30, every: 8 });
      // Tiles are painted dark on light whatever the page's colours, so the colour gate does not run.
      expect(options.verifyFrame).not.toHaveBeenCalled();

      // 20 refreshes at 60 Hz measure the display; the next callback is the first locked refresh.
      const interval = 1000 / 60;
      for (let step = 0; step < 55; step++) {
        const callback = callbacks.shift();
        expect(callback).toBeDefined();
        if (step >= 19) refresh = step - 19;
        await act(async () => {
          callback?.(step * interval);
          // The mock worker takes messages on a timer.
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }

      // 15 frames/sec on a 60 Hz display holds each frame for 4 refreshes.
      expect(result.current.tileInfo).toEqual({ layout: '2x2-v20', hold: 4, refreshHz: 60 });
      // Tiles 0 and 3 change every 4 refreshes; tiles 1 and 2 two refreshes later. Display frame 7
      // (refreshes 28 to 31) is the beacon, and the tiles carry on with the next dense frame after it.
      expect(acks.map((ack) => ack.refresh)).toEqual([0, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 32, 34]);
      expect(acks.map((ack) => ack.index)).toEqual([3, 7, 6, 11, 10, 15, 14, 19, 18, 23, 22, 27, 26, 31, 30]);
      expect(sentHeal()).toBe(false);
    });

    it('waits for a worker that falls behind and carries on with its next frames', async () => {
      vi.stubGlobal('innerHeight', 1000);
      vi.stubGlobal('devicePixelRatio', 1);
      const callbacks: Array<(time: number) => void> = [];
      vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => callbacks.push(callback));
      vi.stubGlobal('cancelAnimationFrame', () => undefined);

      const { result } = renderHook(() => useOpticalSender(senderOptions()));
      act(() => {
        result.current.setSelectedFile(new File(['tile content'], 'tiles.txt', { type: 'text/plain' }));
        result.current.setMultiCode(true);
      });
      attachCanvas(result.current, 1000);

      const acks: number[] = [];
      let sendFrames: (from: number, to: number) => void = () => undefined;
      globalThis.mockWorkerControl.setInterceptor((message: any, worker: any) => {
        if (message.type === 'ACK') acks.push(message.payload.index);
        if (message.type !== 'START') return;
        sendFrames = (from, to) => {
          for (let index = from; index < to; index++) worker.dispatchMessage({ type: 'FRAME', index, total: 64, size: 97, data: new Uint8Array(97 * 97) });
        };
        worker.dispatchMessage({ type: 'PROGRESS', total: 64 });
        // Only the first two display frames are ready; the worker is busy for a while after them.
        sendFrames(0, 8);
      });

      act(() => result.current.startTransfer());
      await waitFor(() => expect(result.current.isTransferring).toBe(true));

      const interval = 1000 / 60;
      let step = 0;
      const run = async (refreshes: number) => {
        for (let end = step + refreshes; step < end; step++) {
          const callback = callbacks.shift();
          await act(async () => {
            callback?.(step * interval);
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
        }
      };
      // Two seconds pass with the worker stalled: the stream shows what it has and then waits.
      await run(140);
      expect(Math.max(...acks)).toBe(7);

      // The worker catches up: the next frames are shown rather than skipped for ones it never made.
      await act(async () => {
        sendFrames(8, 16);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await run(30);
      expect(Math.max(...acks)).toBe(15);
    });

    it('shows every frame in turn when the browser skips refreshes', async () => {
      vi.stubGlobal('innerHeight', 1000);
      vi.stubGlobal('devicePixelRatio', 1);
      const callbacks: Array<(time: number) => void> = [];
      vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => callbacks.push(callback));
      vi.stubGlobal('cancelAnimationFrame', () => undefined);

      const { result } = renderHook(() => useOpticalSender(senderOptions()));
      act(() => {
        result.current.setSelectedFile(new File(['tile content'], 'tiles.txt', { type: 'text/plain' }));
        result.current.setMultiCode(true);
      });
      attachCanvas(result.current, 1000);

      const acks: number[] = [];
      // Like the slice worker, frames are made only a few past the last one acknowledged.
      let made = 0;
      const makeUpTo = (worker: any, lastAcked: number) => {
        for (; made <= lastAcked + 12; made++) worker.dispatchMessage({ type: 'FRAME', index: made, total: 64, size: 97, data: new Uint8Array(97 * 97) });
      };
      globalThis.mockWorkerControl.setInterceptor((message: any, worker: any) => {
        if (message.type === 'ACK') {
          acks.push(message.payload.index);
          makeUpTo(worker, message.payload.index);
        }
        if (message.type === 'HEAL') makeUpTo(worker, Math.min(message.payload.lastAckedIndex, made - 1));
        if (message.type !== 'START') return;
        worker.dispatchMessage({ type: 'PROGRESS', total: 64 });
        makeUpTo(worker, -1);
      });

      act(() => result.current.startTransfer());
      await waitFor(() => expect(result.current.isTransferring).toBe(true));

      const interval = 1000 / 60;
      let time = 0;
      const tick = async (refreshes: number) => {
        const callback = callbacks.shift();
        await act(async () => {
          callback?.(time);
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        time += refreshes * interval;
      };
      // 20 regular refreshes measure the display.
      for (let step = 0; step < 21; step++) await tick(1);
      // A busy page then gets a callback only every 30 refreshes: the stream slows down instead of
      // asking for frames the worker has not made yet.
      for (let step = 0; step < 30; step++) await tick(30);
      expect(Math.max(...acks)).toBeGreaterThanOrEqual(24);
    });
  });

  describe('the receiver steers the speed (#1146)', () => {
    const SESSION = 'a1b2c3d4e5f6';
    const sessionBytes = new Uint8Array(SESSION.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? []);

    /** A receiver's feedback code: how well it reads, and whether it has the file. */
    function feedbackText(densestLayer: 'none' | 'steady' | 'balanced' | 'fast', done = false) {
      return encodeFeedbackFrame({ sessionId: sessionBytes, nonce: new Uint8Array([1, 2, 3, 4]), fractionDecoded: done ? 1 : 0.3, frameSuccessRate: 1, densestLayer, done });
    }

    /** A webcam stream whose one track is live until it is stopped. */
    function fakeWebcam() {
      const track = { readyState: 'live', stop: vi.fn(() => { track.readyState = 'ended'; }) };
      return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream };
    }

    beforeEach(() => {
      vi.stubGlobal('innerHeight', 1000);
      vi.stubGlobal('devicePixelRatio', 1);
      // jsdom has no media pipeline: the webcam's video reports a playing 640x480 frame.
      vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
      vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(640);
      vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(480);
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    /** Starts a steered multi-code transfer against a scripted worker and feedback reader. */
    async function startSteered(requestWebcam: () => Promise<MediaStream>) {
      const options = senderOptions({ requestWebcam });
      const { result, unmount } = renderHook(() => useOpticalSender(options));
      act(() => {
        result.current.setSelectedFile(new File(['steered content'], 'steer.txt', { type: 'text/plain' }));
        result.current.setMultiCode(true);
        result.current.setSteer(true);
      });
      const container = document.createElement('div');
      Object.defineProperty(container, 'clientWidth', { value: 1000, configurable: true });
      const canvas = document.createElement('canvas');
      giveFillOnlyContext(canvas);
      container.appendChild(canvas);
      result.current.canvasRef.current = canvas;

      const script = { feedback: feedbackText('balanced') };
      const sent: any[] = [];
      globalThis.mockWorkerControl.setInterceptor((message: any, worker: any) => {
        if (message.image) {
          // The webcam's decoder worker reads the receiver's feedback code.
          worker.dispatchMessage({ id: message.id, codes: [{ text: script.feedback, corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], version: 2, level: 'M' }] });
          return;
        }
        sent.push(message);
        if (message.type === 'START') {
          worker.dispatchMessage({ type: 'PROGRESS', total: 64 });
          worker.dispatchMessage({
            type: 'INITIALIZED',
            totalFrames: 64,
            sha256: '',
            fountain: { k: 64, density: 'balanced', symbolSize: 350, compression: 'none', messageLength: 9000, fingerprint: 'a b c d', fileCount: 1, outerCode: 'lt', tiles: '2x2-v20', beacon: { version: 30, every: 8 }, sessionId: SESSION, steerable: true },
          });
          for (let index = 0; index < 8; index++) worker.dispatchMessage({ type: 'FRAME', index, total: 64, size: 97, data: new Uint8Array(97 * 97) });
        }
        if (message.type === 'SWITCH') worker.dispatchMessage({ type: 'SWITCHED', tiles: message.payload.tiles, beacon: message.payload.beacon ?? null });
      });
      return { result, unmount, script, sent, requestWebcam };
    }

    it('asks for the webcam only once a steered transfer starts, drops to what the receiver reads and stops when it is done', async () => {
      const webcam = fakeWebcam();
      const requestWebcam = vi.fn(async () => webcam.stream);
      const { result, script, sent } = await startSteered(requestWebcam);
      expect(requestWebcam).not.toHaveBeenCalled();

      act(() => result.current.startTransfer());
      await waitFor(() => expect(result.current.steerState).toEqual({ status: 'listening' }));
      expect(requestWebcam).toHaveBeenCalledTimes(1);
      expect(sent.find((message) => message.type === 'START').payload.steer).toBe(true);
      expect(result.current.steeredProfile).toBe('balanced');
      await waitFor(() => expect(result.current.steeringReceivers).toBe(1));

      // A receiver that reads only the Steady layer pulls the sender down to it at once.
      script.feedback = feedbackText('steady');
      await waitFor(() => expect(result.current.steeredProfile).toBe('steady'));
      expect(sent.find((message) => message.type === 'SWITCH').payload).toEqual({ tiles: '1xv30', beacon: { version: 40, every: 4 } });

      // Done: the sender stops by itself and lets the webcam go.
      script.feedback = feedbackText('steady', true);
      await waitFor(() => expect(result.current.autoStopped).toBe(true));
      expect(result.current.isTransferring).toBe(false);
      expect(webcam.track.stop).toHaveBeenCalled();
      expect(result.current.steerState).toEqual({ status: 'off' });
    });

    it('carries on one way at the chosen speed when the webcam is refused', async () => {
      const requestWebcam = vi.fn(async (): Promise<MediaStream> => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      });
      const { result } = await startSteered(requestWebcam);
      act(() => result.current.startTransfer());
      await waitFor(() => expect(result.current.steerState).toEqual({ status: 'one-way', reason: 'denied' }));
      expect(result.current.isTransferring).toBe(true);
      expect(result.current.steeredProfile).toBe('balanced');
      expect(result.current.autoStopped).toBe(false);
    });

    it('never asks for a webcam when the page cannot open one', async () => {
      const { result } = await startSteered(undefined as unknown as () => Promise<MediaStream>);
      act(() => result.current.startTransfer());
      await waitFor(() => expect(result.current.steerState).toEqual({ status: 'one-way', reason: 'unavailable' }));
    });
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
    // Frames are checked and painted in the one fixed transfer look: no style travels with them.
    expect(options.verifyFrame).toHaveBeenCalledWith(expect.objectContaining({ size: 21 }));
    await waitFor(() => expect(options.renderFrame).toHaveBeenCalled());
    expect(options.renderFrame).toHaveBeenCalledWith(result.current.canvasRef.current, expect.objectContaining({ size: 21 }));
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

  it('keeps the settings a stream was started with from Start until Stop', async () => {
    const options = senderOptions({ verifyFrame: vi.fn(() => new Promise<boolean>(() => {})) });
    const hook = renderHook(() => useOpticalSender(options));
    hook.result.current.canvasRef.current = document.createElement('canvas');
    act(() => {
      hook.result.current.setSelectedFile(new File(['payload'], 'p.txt', { type: 'text/plain' }));
    });
    let start: any = null;
    globalThis.mockWorkerControl.setInterceptor((message: any, worker: any) => {
      if (message.type !== 'START') return;
      start = message;
      worker.dispatchMessage({ type: 'PROGRESS', index: 0, total: 1 });
      worker.dispatchMessage({ type: 'FRAME', index: 0, total: 1, size: 21, data: new Uint8Array(441) });
    });
    await act(async () => {
      hook.result.current.startTransfer();
    });
    // Still checking the first frame: nothing the person switches now can differ from the stream.
    await waitFor(() => expect(options.verifyFrame).toHaveBeenCalled());
    expect(hook.result.current.isVerifyingHandshake).toBe(true);
    expect(hook.result.current.settingsLocked).toBe(true);
    act(() => {
      hook.result.current.setIsPrivate(true);
      hook.result.current.setWalletCompat(true);
      hook.result.current.setDensity('fast');
      hook.result.current.setOuterCode('fec');
      hook.result.current.setMultiCode(true);
      hook.result.current.setSteer(true);
    });
    expect(start.payload.private).toBe(false);
    expect(hook.result.current).toMatchObject({ isPrivate: false, walletCompat: false, density: 'balanced', outerCode: 'lt', multiCode: false, steer: false });

    act(() => hook.result.current.stopTransfer());
    expect(hook.result.current.settingsLocked).toBe(false);
    act(() => hook.result.current.setIsPrivate(true));
    expect(hook.result.current.isPrivate).toBe(true);
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
