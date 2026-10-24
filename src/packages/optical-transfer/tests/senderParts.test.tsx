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
// The four parts `useOpticalSender` is composed of (#1511), each on its own: start, stop,
// unmount cleanup and a second stop.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import {
  useSenderRefs,
  useFrameLoop,
  useSliceWorker,
  useSteering,
  useSenderSettings,
  planStream,
  PROFILE_FOR_DENSITY,
  type SenderRefs,
  type SliceWorkerEvents,
} from '../client';

/** Shared refs with a spy renderer and a gate that always passes. */
function useTestRefs() {
  return useSenderRefs(vi.fn(), vi.fn(async () => true));
}

/** A manual rAF queue: `step` runs the callbacks asked for so far, one display refresh. */
function fakeAnimationFrames() {
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = next++;
    queue.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id));
  return {
    pending: () => queue.size,
    step: (now: number) => {
      const due = [...queue.values()];
      queue.clear();
      due.forEach((callback) => callback(now));
    },
  };
}

beforeEach(() => {
  globalThis.mockWorkerControl.reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  globalThis.mockWorkerControl.reset();
});

describe('useSenderSettings', () => {
  it('takes changes while unlocked and ignores them while a stream runs', () => {
    const { result, rerender } = renderHook(({ locked }) => {
      const lockRef = useRef(false);
      return useSenderSettings(locked, lockRef);
    }, { initialProps: { locked: false } });
    act(() => result.current.setDensity('fast'));
    expect(result.current.density).toBe('fast');

    rerender({ locked: true });
    act(() => {
      result.current.setDensity('reliable');
      result.current.setIsPrivate(true);
    });
    expect(result.current.density).toBe('fast');
    expect(result.current.isPrivate).toBe(false);

    // The frame rate is not a locked setting.
    act(() => result.current.setFps(30));
    expect(result.current.fps).toBe(30);
  });

  it('plans one code per frame unless several codes are asked for and the canvas is there', () => {
    expect(planStream(null, { multiCode: true, steer: true, density: 'balanced', fps: 15 })).toEqual({ plan: null, beacon: null, profile: null, targetFps: null });
    const canvas = document.createElement('canvas');
    expect(planStream(canvas, { multiCode: false, steer: true, density: 'balanced', fps: 15 }).profile).toBeNull();
  });

  it('pairs each density with its speed profile', () => {
    expect(PROFILE_FOR_DENSITY).toEqual({ reliable: 'steady', balanced: 'balanced', fast: 'fast' });
  });
});

describe('useFrameLoop', () => {
  it('plays pooled frames in order on display refreshes, then stops on request', () => {
    const frames = fakeAnimationFrames();
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { result } = renderHook(() => {
      const refs = useTestRefs();
      return { refs, loop: useFrameLoop(refs) };
    });
    const { refs } = result.current;
    refs.canvasRef.current = document.createElement('canvas');
    refs.isTransferringRef.current = true;
    refs.totalFramesRef.current = 4;
    refs.framePoolRef.current.storeFrame(0, 21, new Uint8Array(21 * 21));
    refs.framePoolRef.current.storeFrame(1, 21, new Uint8Array(21 * 21));

    act(() => result.current.loop.play());
    expect(frames.pending()).toBe(1);
    act(() => frames.step(1000));
    expect(refs.renderFrameRef.current).toHaveBeenCalledTimes(1);
    expect(result.current.loop.currentFrameIndex).toBe(1);
    expect(result.current.loop.progress).toBe(25);

    act(() => result.current.loop.freeze());
    expect(frames.pending()).toBe(0);
    // A second stop has nothing left to cancel.
    act(() => result.current.loop.freeze());
    expect(frames.pending()).toBe(0);
  });

  it('resets the playback state and is safe to reset twice', () => {
    fakeAnimationFrames();
    const { result } = renderHook(() => {
      const refs = useTestRefs();
      return { refs, loop: useFrameLoop(refs) };
    });
    const { refs } = result.current;
    refs.framePoolRef.current.storeFrame(0, 21, new Uint8Array(21 * 21));
    refs.currentPlayIndexRef.current = 7;
    act(() => {
      result.current.loop.resetPlayback();
      result.current.loop.resetPlayback();
    });
    expect(refs.framePoolRef.current.hasFrame(0)).toBe(false);
    expect(refs.currentPlayIndexRef.current).toBe(0);
    expect(result.current.loop.progress).toBe(0);
    expect(result.current.loop.currentPass).toBe(1);
  });

  it('asks for no frame after unmount', () => {
    const frames = fakeAnimationFrames();
    const { result, unmount } = renderHook(() => {
      const refs = useTestRefs();
      return { refs, loop: useFrameLoop(refs) };
    });
    result.current.refs.isTransferringRef.current = true;
    act(() => result.current.loop.play());
    expect(frames.pending()).toBe(1);
    unmount();
    expect(frames.pending()).toBe(0);
  });
});

describe('useSliceWorker', () => {
  /** Renders the worker part with spy events. */
  function renderWorker(events: Partial<SliceWorkerEvents> = {}) {
    const spies: SliceWorkerEvents = { onSteerable: vi.fn(), onSwitched: vi.fn(), onFirstFrame: vi.fn(), onError: vi.fn(), ...events };
    const sent: unknown[] = [];
    globalThis.mockWorkerControl.setInterceptor((message: unknown) => sent.push(message));
    const hook = renderHook(() => {
      const refs = useTestRefs();
      return { refs, worker: useSliceWorker(refs, spies) };
    });
    return { ...hook, spies, sent };
  }

  /** Delivers a message as the worker would. */
  function emit(refs: SenderRefs, data: unknown) {
    const worker = refs.workerRef.current;
    if (!worker?.onmessage) throw new Error('no worker');
    act(() => worker.onmessage?.(new MessageEvent('message', { data })));
  }

  it('spawns one worker however often it is asked for', () => {
    const { result } = renderWorker();
    act(() => {
      result.current.worker.ensureWorker();
      result.current.worker.ensureWorker();
    });
    expect(globalThis.mockWorkerControl.getInstances()).toHaveLength(1);
  });

  it('stops with STOP and keeps the worker; a second stop is harmless', async () => {
    const { result, sent } = renderWorker();
    act(() => result.current.worker.ensureWorker());
    const worker = result.current.refs.workerRef.current;
    act(() => {
      result.current.worker.stop();
      result.current.worker.stop();
    });
    await waitFor(() => expect(sent).toEqual([{ type: 'STOP' }, { type: 'STOP' }]));
    expect(result.current.refs.workerRef.current).toBe(worker);
    expect(worker?.terminate).not.toHaveBeenCalled();
  });

  it('ends the worker on terminate, once', () => {
    const { result } = renderWorker();
    act(() => result.current.worker.ensureWorker());
    const worker = result.current.refs.workerRef.current;
    act(() => {
      result.current.worker.terminate();
      result.current.worker.terminate();
    });
    expect(worker?.terminate).toHaveBeenCalledTimes(1);
    expect(result.current.refs.workerRef.current).toBeNull();
  });

  it('ends the worker on unmount', () => {
    const { result, unmount } = renderWorker();
    act(() => result.current.worker.ensureWorker());
    const worker = result.current.refs.workerRef.current;
    unmount();
    expect(worker?.terminate).toHaveBeenCalledTimes(1);
  });

  it('pools frames, hands frame 0 to the gate while it waits, and reports errors', () => {
    const { result, spies } = renderWorker();
    act(() => result.current.worker.ensureWorker());
    const { refs } = result.current;
    refs.isVerifyingHandshakeRef.current = true;
    const data = new Uint8Array(21 * 21);
    emit(refs, { type: 'PROGRESS', index: 0, total: 9 });
    emit(refs, { type: 'FRAME', index: 0, total: 9, size: 21, data });
    expect(result.current.worker.totalFrames).toBe(9);
    expect(refs.totalFramesRef.current).toBe(9);
    expect(refs.framePoolRef.current.hasFrame(0)).toBe(true);
    expect(spies.onFirstFrame).toHaveBeenCalledWith({ size: 21, data });

    emit(refs, { type: 'ERROR', message: 'Too big' });
    expect(spies.onError).toHaveBeenCalledWith('Too big');
  });
});

describe('useSteering', () => {
  /** A webcam stream whose one track is live until it is stopped. */
  function fakeWebcam() {
    const track = { readyState: 'live', stop: vi.fn(() => { track.readyState = 'ended'; }) };
    return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream };
  }

  /** Renders the steering part around a webcam opener. */
  function renderSteering(requestWebcam: (() => Promise<MediaStream>) | undefined) {
    const onAllDone = vi.fn();
    const hook = renderHook(() => {
      const refs = useTestRefs();
      return { refs, steering: useSteering(refs, { requestWebcam, onAllDone, runTileLoop: vi.fn(), setTileInfo: vi.fn() }) };
    });
    return { ...hook, onAllDone };
  }

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  it('listens once the webcam is granted, and lets it go on reset; a second reset is harmless', async () => {
    const webcam = fakeWebcam();
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const { result } = renderSteering(async () => webcam.stream);
    act(() => result.current.steering.startSteering('a1b2c3d4e5f6'));
    expect(result.current.steering.steerState).toEqual({ status: 'requesting' });
    await waitFor(() => expect(result.current.steering.steerState).toEqual({ status: 'listening' }));

    act(() => {
      result.current.steering.resetSteering();
      result.current.steering.resetSteering();
    });
    expect(webcam.track.stop).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalled();
    expect(result.current.steering.steerState).toEqual({ status: 'off' });
    expect(result.current.steering.steeredProfile).toBeNull();
  });

  it('carries on one way when there is no webcam', async () => {
    const { result } = renderSteering(undefined);
    act(() => result.current.steering.startSteering('a1b2c3d4e5f6'));
    await waitFor(() => expect(result.current.steering.steerState).toEqual({ status: 'one-way', reason: 'unavailable' }));
  });

  it('releases the webcam and the steer timer on unmount', async () => {
    const webcam = fakeWebcam();
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const { result, unmount } = renderSteering(async () => webcam.stream);
    act(() => result.current.steering.startSteering('a1b2c3d4e5f6'));
    await waitFor(() => expect(result.current.steering.steerState).toEqual({ status: 'listening' }));
    unmount();
    expect(webcam.track.stop).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalled();
  });
});
