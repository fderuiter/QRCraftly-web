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

import { useCallback, useEffect, useRef } from 'react';
import type { PrismManifestInfo } from '../prism/manifest';
import { spawnReassemblyWorker } from './media';
import type { ReassemblyWorkerMessage } from './receiverTypes';

/** What the receiver does with the worker's news. Read through a ref, so these may change every render. */
export interface ReassemblyWorkerEvents {
  /** The sender's manifest was accepted. */
  onManifest: (manifest: PrismManifestInfo, needsKey: boolean) => void;
  /** Whether the key code given last was readable. */
  onKeyStatus: (accepted: boolean) => void;
  /** Another stream is in view. */
  onSwitchOffer: (offer: PrismManifestInfo) => void;
  /** The decode moved on. */
  onProgress: (message: ReassemblyWorkerMessage) => void;
  /** A file or a bundle was reassembled. */
  onComplete: (message: ReassemblyWorkerMessage) => void;
  /** The worker failed. */
  onError: (message: string) => void;
}

/**
 * The reassembly worker (#1514): spawning it, its run id, its message protocol, and CLEAR on
 * terminate. Moved from `useOpticalReceiver`; the worker is also ended on unmount.
 * @param events - What to do with the worker's news.
 */
export function useReassemblyWorker(events: ReassemblyWorkerEvents) {
  const workerRef = useRef<Worker | null>(null);
  /** Bumped whenever the worker stops (Clear, a reset), so a completion still being checked is dropped (#1304). */
  const workerRunRef = useRef(0);
  /** True once the Prism stream in view has a manifest or progress: a wallet code must not end it (#1300). */
  const prismActiveRef = useRef(false);
  /** The last session received, so a fresh worker ignores its frames. */
  const finishedSessionRef = useRef<string | null>(null);
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  });

  const initWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = spawnReassemblyWorker();

      worker.onmessage = (e: MessageEvent<ReassemblyWorkerMessage>) => {
        // A worker that was stopped (a reset, or a BC-UR stream that turned out to be the real one)
        // may still have messages in flight; they no longer describe this receiver.
        if (workerRef.current !== worker) return;
        const message = e.data;
        const { type } = message;
        const on = eventsRef.current;

        if (type === 'MANIFEST' && message.manifest) {
          prismActiveRef.current = true;
          on.onManifest(message.manifest, Boolean(message.needsKey));
        } else if (type === 'KEY_STATUS') {
          on.onKeyStatus(Boolean(message.accepted));
        } else if (type === 'SWITCH_OFFER' && message.offer) {
          on.onSwitchOffer(message.offer);
        } else if (type === 'PROGRESS') {
          prismActiveRef.current = true;
          on.onProgress(message);
        } else if (type === 'COMPLETE') {
          if (message.session) finishedSessionRef.current = message.session;
          on.onComplete(message);
        } else if (type === 'ERROR') {
          on.onError(message.error || 'Failed to compile binary content.');
        }
      };

      worker.onerror = (e) => {
        if (workerRef.current !== worker) return;
        eventsRef.current.onError(e.message || 'Background worker error.');
      };

      // A camera still pointed at the stream that just finished must not receive it again.
      if (finishedSessionRef.current) worker.postMessage({ type: 'IGNORE_SESSION', session: finishedSessionRef.current });
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  const terminateWorker = useCallback(() => {
    workerRunRef.current += 1;
    prismActiveRef.current = false;
    if (workerRef.current) {
      try {
        workerRef.current.postMessage({ type: 'CLEAR' });
      } catch {
        // The worker may already be gone.
      }
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  /** The current run: a completion checked under an older run was cleared while it was checked. */
  const currentRun = useCallback(() => workerRunRef.current, []);
  /** Whether a Prism stream is being received, so a wallet code in view must not end it. */
  const prismActive = useCallback(() => prismActiveRef.current, []);

  useEffect(() => terminateWorker, [terminateWorker]);

  return { initWorker, terminateWorker, currentRun, prismActive };
}
