/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import { startModuleWorker } from '@/packages/core/trustedTypes';
import workerMatrixUrl from '../worker-matrix.ts?worker&url';
import workerMazeUrl from '../worker-maze.ts?worker&url';
const hasWorker = (): boolean => typeof window !== 'undefined' && typeof Worker !== 'undefined';

/**
 * Spawns the Matrix Worker, which validates a configuration and encodes its module matrix
 * off the main thread. This is the only place the worker script is referenced by path.
 * @returns The worker, or null where Web Workers are unavailable (SSR, jsdom, old browsers).
 */
export function createMatrixWorker(): Worker | null {
  return hasWorker() ? startModuleWorker(workerMatrixUrl) : null;
}

/**
 * Spawns the Maze Worker, which runs maze generation and A* pathfinding off the main thread.
 * Requests must satisfy `isMazeWorkerRequest`; responses satisfy `isMazeWorkerResponse`.
 * @returns The worker, or null where Web Workers are unavailable (SSR, jsdom, old browsers).
 */
export function createMazeWorker(): Worker | null {
  return hasWorker() ? startModuleWorker(workerMazeUrl) : null;
}
