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

import { sameOriginWorker } from '@/packages/core/security';

/**
 * Spawns a dedicated Scannability Worker. This is the only place the worker script is
 * referenced by path, so other packages and pages never reach into this package's files.
 * Requests must satisfy `assertWorkerRequest`; responses satisfy `isWorkerResponse`.
 * @returns The worker, or null where Web Workers are unavailable (SSR, old browsers).
 */
export function createScannabilityWorker(): Worker | null {
  if (typeof globalThis.Worker === 'undefined') return null;
  try {
    const Worker = sameOriginWorker();
    return new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
  } catch (err) {
    console.error('Failed to spawn the Scannability Worker:', err);
    return null;
  }
}

/** Callbacks a Scannability Health Evaluator attaches to its worker. */
export interface ScannabilityWorkerHandlers {
  onMessage: (data: unknown) => void;
  onError: (reason: unknown) => void;
}

/** The evaluator's private view of one worker generation. */
export interface ScannabilityWorkerHandle {
  /** Posts a validated request, transferring ownership of the listed objects. */
  post: (request: unknown, transfer: Transferable[]) => void;
  /** Detaches the listeners and terminates the worker thread. */
  terminate: () => void;
}

/**
 * Spawns a worker generation for the evaluator, or returns null where workers are unavailable
 * (the evaluator then runs every check on the main thread).
 */
export type ScannabilityWorkerFactory = (
  handlers: ScannabilityWorkerHandlers
) => ScannabilityWorkerHandle | null;

/**
 * Default evaluator worker factory, wrapping `createScannabilityWorker`.
 */
export const connectScannabilityWorker: ScannabilityWorkerFactory = (handlers) => {
  const worker = createScannabilityWorker();
  if (!worker) return null;
  const onMessage = (event: MessageEvent) => handlers.onMessage(event.data);
  const onError = (event: Event) => handlers.onError(event);
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
  return {
    post: (request, transfer) => worker.postMessage(request, transfer),
    terminate: () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      try {
        worker.terminate();
      } catch {
        // Already gone; nothing left to release.
      }
    },
  };
};
