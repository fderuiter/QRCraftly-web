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

/**
 * Computes maze paths for the preview off the main thread, in the maze worker, restarting the
 * worker if it crashes and falling back to idle-time work on the main thread without one.
 * Only the reply to the latest request is kept.
 * @param configRef - The current config; read when a maze is requested, so `requestMaze` stays stable.
 */
export function useMazeData(configRef: RefObject<QRConfig>): MazeDataState {
  const workerRef = useRef<Worker | null>(null);
  const sequenceIdRef = useRef(0);
  const isFallbackRef = useRef(false);
  const cacheKeyRef = useRef<string | null>(null);
  const [mazeData, setMazeData] = useState<MazeData | null>(null);
  const mazeDataRef = useRef<MazeData | null>(null);

  useLayoutEffect(() => {
    mazeDataRef.current = mazeData;
  }, [mazeData]);

  const initWorker = useCallback(() => {
    if (isFallbackRef.current) return;

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
        // Strictly validate message format at runtime
        assertMazeWorkerResponse(e.data);

        const { status, sequenceId, mazeData: result, error } = e.data;
        if (sequenceId !== sequenceIdRef.current) {
          return;
        }

        if (status === 'success' && result) {
          setMazeData(result);
          if (cacheKeyRef.current) {
            storeMaze(cacheKeyRef.current, result);
          }
        } else {
          console.warn("Background maze calculation failed:", error);
        }
      };

      worker.onerror = (e) => {
        console.error("Maze background worker error, restarting:", e);
        // Crash recovery: terminate current process and spin up replacement
        initWorker();
      };

      workerRef.current = worker;
    } catch (err) {
      console.warn("Failed to initialize background maze worker, falling back:", err);
      isFallbackRef.current = true;
    }
  }, []);

  useEffect(() => {
    initWorker();
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [initWorker]);

  const requestMaze = useCallback((modules: QRModules) => {
    const config = configRef.current;
    if (!config.isMazeEnabled) {
      setMazeData(null);
      return;
    }

    sequenceIdRef.current += 1;
    const currentSeqId = sequenceIdRef.current;

    const size = modules.size;
    cacheKeyRef.current = getMazeCacheKey(config, size, modules);
    const matrix = new Uint8Array(size * size);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        matrix[r * size + c] = modules.get(r, c) ? 1 : 0;
      }
    }

    if (workerRef.current && !isFallbackRef.current) {
      const requestPayload = { size, matrix, config, sequenceId: currentSeqId };

      // Strict validation before posting
      if (!isMazeWorkerRequest(requestPayload)) {
        throw new Error('Invalid MazeWorkerRequest payload built on main thread');
      }

      workerRef.current.postMessage(requestPayload);
    } else {
      // Fallback: run pathfinding on the main thread during idle time
      const runner = () => {
        if (currentSeqId !== sequenceIdRef.current) return;
        try {
          setMazeData(generateMaze(modules, config, size));
        } catch (e) {
          console.warn("Main thread fallback maze generation failed:", e);
        }
      };

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        window.requestIdleCallback(runner);
      } else {
        setTimeout(runner, 0);
      }
    }
  }, [configRef]);

  return { mazeData, mazeDataRef, requestMaze };
}
