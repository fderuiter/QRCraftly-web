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

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { QRConfig, QRModules } from '@/packages/core/types';
import {
  generateMaze,
  getMazeCacheKey,
  storeMaze,
  isMazeWorkerRequest,
  assertMazeWorkerResponse,
  type MazeData,
} from '@/packages/qr-matrix/maze';
import { getQrCanvasRuntime } from '@/utils/qrCanvasRuntime';

/** The maze paths for the current matrix, and how to ask for new ones. */
export interface MazeDataState {
  /** The latest maze, or null without one; a change means the preview should repaint. */
  mazeData: MazeData | null;
  /** The same maze, readable from paint callbacks and the animation loop without re-subscribing. */
  mazeDataRef: RefObject<MazeData | null>;
  /** Computes the maze for a new matrix (or clears it when the maze is off). Stable across renders. */
  requestMaze: (modules: QRModules) => void;
}

/** Worker crashes in a row before the maze is computed on the main thread instead (#1709). */
export const MAX_MAZE_WORKER_RESTARTS = 2;

/** The newest maze calculation, kept so a crashed worker's replacement can redo it. */
interface MazeRequest {
  sequenceId: number;
  modules: QRModules;
  config: QRConfig;
  size: number;
  matrix: Uint8Array;
  cacheKey: string;
}

/**
 * Computes maze paths for the preview off the main thread, in the maze worker, falling back to
 * idle-time work on the main thread without one. Only the reply to the latest request is kept.
 *
 * The hook owns its calculation revision (#1709). A worker crash replays the newest request on a
 * replacement worker, up to {@link MAX_MAZE_WORKER_RESTARTS} crashes in a row; after that the maze
 * is computed on the main thread. Turning the maze off and unmounting retire the revision, so a
 * late answer or queued main-thread run never fills the maze, and unmounting starts no new worker.
 * @param configRef - The current config; read when a maze is requested, so `requestMaze` stays stable.
 */
export function useMazeData(configRef: RefObject<QRConfig>): MazeDataState {
  const workerRef = useRef<Worker | null>(null);
  const sequenceIdRef = useRef(0);
  const isFallbackRef = useRef(false);
  const pendingRef = useRef<MazeRequest | null>(null);
  const crashesRef = useRef(0);
  const disposedRef = useRef(false);
  const idleRef = useRef<{ cancel: () => void } | null>(null);
  const [mazeData, setMazeData] = useState<MazeData | null>(null);
  const mazeDataRef = useRef<MazeData | null>(null);

  useLayoutEffect(() => {
    mazeDataRef.current = mazeData;
  }, [mazeData]);

  /** Runs a calculation on the main thread when the browser is idle, unless a newer one replaces it. */
  const runOnMainThread = useCallback((request: MazeRequest) => {
    idleRef.current?.cancel();
    const runner = () => {
      idleRef.current = null;
      if (disposedRef.current || request.sequenceId !== sequenceIdRef.current) return;
      pendingRef.current = null;
      try {
        setMazeData(generateMaze(request.modules, request.config, request.size));
      } catch (e) {
        console.warn("Main thread fallback maze generation failed:", e);
      }
    };
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(runner);
      idleRef.current = { cancel: () => window.cancelIdleCallback?.(handle) };
    } else {
      const handle = setTimeout(runner, 0);
      idleRef.current = { cancel: () => clearTimeout(handle) };
    }
  }, []);

  const dispatchRef = useRef<(request: MazeRequest) => void>(() => undefined);

  const initWorker = useCallback(() => {
    if (isFallbackRef.current || disposedRef.current) return;

    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    try {
      const worker = getQrCanvasRuntime().createMazeWorker();
      if (!worker) {
        isFallbackRef.current = true;
        return;
      }

      worker.onmessage = (e) => {
        if (workerRef.current !== worker) return;
        // Strictly validate message format at runtime
        assertMazeWorkerResponse(e.data);

        const { status, sequenceId, mazeData: result, error } = e.data;
        const request = pendingRef.current;
        if (disposedRef.current || sequenceId !== sequenceIdRef.current || !request || request.sequenceId !== sequenceId) {
          return;
        }
        pendingRef.current = null;
        crashesRef.current = 0;

        if (status === 'success' && result) {
          setMazeData(result);
          storeMaze(request.cacheKey, result);
        } else {
          console.warn("Background maze calculation failed:", error);
        }
      };

      worker.onerror = (e) => {
        // A crash of a worker already replaced, or after unmount, changes nothing.
        if (workerRef.current !== worker || disposedRef.current) return;
        e.preventDefault?.();
        crashesRef.current += 1;
        if (crashesRef.current > MAX_MAZE_WORKER_RESTARTS) {
          console.warn("Maze background worker keeps failing, computing the maze on the main thread.");
          worker.terminate();
          workerRef.current = null;
          isFallbackRef.current = true;
        } else {
          console.error("Maze background worker error, restarting:", e);
          initWorker();
        }
        // Redo the calculation the crash interrupted, on the replacement or the main thread.
        const request = pendingRef.current;
        if (request && request.sequenceId === sequenceIdRef.current) dispatchRef.current(request);
      };

      workerRef.current = worker;
    } catch (err) {
      console.warn("Failed to initialize background maze worker, falling back:", err);
      isFallbackRef.current = true;
    }
  }, []);

  const dispatch = useCallback((request: MazeRequest) => {
    const worker = workerRef.current;
    if (!worker || isFallbackRef.current) {
      runOnMainThread(request);
      return;
    }
    const requestPayload = { size: request.size, matrix: request.matrix, config: request.config, sequenceId: request.sequenceId };

    // Strict validation before posting
    if (!isMazeWorkerRequest(requestPayload)) {
      throw new Error('Invalid MazeWorkerRequest payload built on main thread');
    }

    worker.postMessage(requestPayload);
  }, [runOnMainThread]);

  useLayoutEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    disposedRef.current = false;
    initWorker();
    return () => {
      // Unmount retires the revision: no late answer applies and no replacement worker starts.
      disposedRef.current = true;
      sequenceIdRef.current += 1;
      pendingRef.current = null;
      idleRef.current?.cancel();
      idleRef.current = null;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [initWorker]);

  const requestMaze = useCallback((modules: QRModules) => {
    const config = configRef.current;
    // Every request, turning the maze off included, retires the calculation before it.
    sequenceIdRef.current += 1;
    const currentSeqId = sequenceIdRef.current;
    if (!config.isMazeEnabled) {
      pendingRef.current = null;
      idleRef.current?.cancel();
      idleRef.current = null;
      setMazeData(null);
      return;
    }

    const size = modules.size;
    const matrix = new Uint8Array(size * size);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        matrix[r * size + c] = modules.get(r, c) ? 1 : 0;
      }
    }
    const request: MazeRequest = { sequenceId: currentSeqId, modules, config, size, matrix, cacheKey: getMazeCacheKey(config, size, modules) };
    pendingRef.current = request;
    dispatch(request);
  }, [configRef, dispatch]);

  return { mazeData, mazeDataRef, requestMaze };
}
