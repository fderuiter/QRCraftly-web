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

import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import type { QRConfig, QRModules } from '@/packages/core/types';
import type { MazeData, MazeWorkerRequest } from '@/packages/qr-matrix/maze';
import { setQrCanvasRuntime } from '@/utils/qrCanvasRuntime';
import { MAX_MAZE_WORKER_RESTARTS, useMazeData } from './useMazeData';

const generated: MazeData = { nodes: [], edges: [], start: null, end: null, key: null, solution: [] };
const fromWorker = (tag: number): MazeData => ({ nodes: [], edges: [], start: { r: tag, c: tag }, end: null, key: null, solution: [] });

vi.mock('@/packages/qr-matrix/maze', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/packages/qr-matrix/maze')>();
  return { ...actual, generateMaze: vi.fn(() => generated), storeMaze: vi.fn() };
});

const { generateMaze } = await import('@/packages/qr-matrix/maze');

/** A maze worker the test drives: it records requests, answers, crashes and terminates on demand. */
class FakeMazeWorker extends EventTarget implements Worker {
  onmessage: ((this: Worker, event: MessageEvent) => void) | null = null;
  onmessageerror: ((this: Worker, event: MessageEvent) => void) | null = null;
  onerror: ((this: AbstractWorker, event: ErrorEvent) => void) | null = null;
  readonly posted: MazeWorkerRequest[] = [];
  terminated = false;
  postMessage(message: MazeWorkerRequest): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(request: MazeWorkerRequest, mazeData: MazeData): void {
    this.onmessage?.call(this, new MessageEvent('message', { data: { status: 'success', sequenceId: request.sequenceId, mazeData } }));
  }
  crash(): void {
    this.onerror?.call(this, new ErrorEvent('error', { message: 'worker script failed' }));
  }
}

const modules: QRModules = { size: 21, get: (row, col) => (row + col) % 2 === 0 };
const mazeOn: QRConfig = { ...DEFAULT_CONFIG, isMazeEnabled: true };

function setup(createMazeWorker: () => Worker | null) {
  const restore = setQrCanvasRuntime({ createMazeWorker });
  const configRef: RefObject<QRConfig> = { current: mazeOn };
  const view = renderHook(() => useMazeData(configRef));
  return { ...view, configRef, restore };
}

/** Spawns fake workers and keeps every one it made. */
function workerFactory() {
  const workers: FakeMazeWorker[] = [];
  const create = vi.fn(() => {
    const worker = new FakeMazeWorker();
    workers.push(worker);
    return worker;
  });
  return { workers, create };
}

describe('useMazeData worker recovery (#1709)', () => {
  let restore: () => void = () => undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(generateMaze).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    restore();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('replays the interrupted calculation on a replacement worker after one crash', () => {
    const { workers, create } = workerFactory();
    const hook = setup(create);
    restore = hook.restore;
    act(() => hook.result.current.requestMaze(modules));
    expect(workers[0].posted).toHaveLength(1);

    act(() => workers[0].crash());
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1].posted).toHaveLength(1);
    expect(workers[1].posted[0].sequenceId).toBe(workers[0].posted[0].sequenceId);

    act(() => workers[1].answer(workers[1].posted[0], fromWorker(1)));
    expect(hook.result.current.mazeData).toEqual(fromWorker(1));
  });

  it('falls back to the main thread after repeated crashes instead of restarting forever', () => {
    const { workers, create } = workerFactory();
    const hook = setup(create);
    restore = hook.restore;
    act(() => hook.result.current.requestMaze(modules));
    for (let crash = 0; crash <= MAX_MAZE_WORKER_RESTARTS; crash++) {
      act(() => workers.at(-1)?.crash());
    }
    expect(create).toHaveBeenCalledTimes(MAX_MAZE_WORKER_RESTARTS + 1);
    expect(workers.every((worker) => worker.terminated)).toBe(true);

    act(() => vi.runAllTimers());
    expect(generateMaze).toHaveBeenCalledTimes(1);
    expect(hook.result.current.mazeData).toEqual(generated);

    // Later designs stay on the main thread; no new worker is started.
    act(() => hook.result.current.requestMaze(modules));
    act(() => vi.runAllTimers());
    expect(create).toHaveBeenCalledTimes(MAX_MAZE_WORKER_RESTARTS + 1);
    expect(generateMaze).toHaveBeenCalledTimes(2);
  });

  it('ignores a late answer after the maze is turned off', () => {
    const { workers, create } = workerFactory();
    const hook = setup(create);
    restore = hook.restore;
    act(() => hook.result.current.requestMaze(modules));
    const request = workers[0].posted[0];

    hook.configRef.current = { ...mazeOn, isMazeEnabled: false };
    act(() => hook.result.current.requestMaze(modules));
    act(() => workers[0].answer(request, fromWorker(7)));
    expect(hook.result.current.mazeData).toBeNull();
  });

  it('keeps only the newest request when an older one crashes', () => {
    const { workers, create } = workerFactory();
    const hook = setup(create);
    restore = hook.restore;
    act(() => hook.result.current.requestMaze(modules));
    act(() => hook.result.current.requestMaze(modules));
    const newest = workers[0].posted[1];

    act(() => workers[0].crash());
    expect(workers[1].posted).toEqual([expect.objectContaining({ sequenceId: newest.sequenceId })]);
    act(() => workers[0].answer(workers[0].posted[0], fromWorker(3)));
    expect(hook.result.current.mazeData).toBeNull();
  });

  it('starts no replacement and applies nothing after unmount', () => {
    const { workers, create } = workerFactory();
    const hook = setup(create);
    restore = hook.restore;
    act(() => hook.result.current.requestMaze(modules));
    const request = workers[0].posted[0];
    hook.unmount();
    expect(workers[0].terminated).toBe(true);

    workers[0].crash();
    workers[0].answer(request, fromWorker(9));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('cancels a queued main-thread calculation when the maze is turned off', () => {
    const hook = setup(() => null);
    restore = hook.restore;
    act(() => hook.result.current.requestMaze(modules));
    hook.configRef.current = { ...mazeOn, isMazeEnabled: false };
    act(() => hook.result.current.requestMaze(modules));
    act(() => vi.runAllTimers());
    expect(generateMaze).not.toHaveBeenCalled();
    expect(hook.result.current.mazeData).toBeNull();
  });
});
