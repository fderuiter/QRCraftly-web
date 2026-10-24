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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SliceWorkerIncomingMessage, SliceWorkerOutgoingMessage } from '../contracts';
import type { TileLayoutId } from '../multicode/layout';
import type { SenderRefs } from './senderRefs';
import type { SenderFountainInfo, TransferFrame } from './senderTypes';
import { spawnSliceWorker } from './workers';

/** What the sender does with the worker's news. Read through a ref, so these may change every render. */
export interface SliceWorkerEvents {
  /** A steerable transfer started: open the back channel for this session. */
  onSteerable: (sessionId: string) => void;
  /** The worker changed layout. */
  onSwitched: (tiles: TileLayoutId) => void;
  /** Frame 0 arrived while the scannability gate waits for it. */
  onFirstFrame: (frame: TransferFrame) => void;
  /** The worker gave up. */
  onError: (message: string) => void;
}

/**
 * The slice worker (#1511): spawning it, its message protocol, and stopping or ending it.
 * Moved from `useOpticalSender`.
 *
 * Stopping and ending are different on purpose. `stop` posts STOP and keeps the worker, so the
 * next Start reuses it. `terminate` posts STOP and ends the worker; only a failed scannability
 * gate does that, and it has since the gate came in with 22e07a5a (#869), which recorded no
 * reason. `git log -S "workerRef.current.terminate();"` finds it. Keep both as they are.
 * @param refs - The sender's shared refs.
 * @param events - What to do with the worker's news.
 */
export function useSliceWorker(refs: SenderRefs, events: SliceWorkerEvents) {
  const { workerRef, framePoolRef, totalFramesRef, isVerifyingHandshakeRef, switchingRef, beaconPoolRef } = refs;
  const [totalFrames, setTotalFrames] = useState(0);
  const [fountainInfo, setFountainInfo] = useState<SenderFountainInfo | null>(null);
  /** The key QR, while the person holds the button that shows it. */
  const [keyFrame, setKeyFrame] = useState<TransferFrame | null>(null);
  const [frameBufferBytes, setFrameBufferBytes] = useState(0);
  /** Canvas of the key QR; painted whenever `keyFrame` is set. */
  const keyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eventsRef = useRef(events);

  useEffect(() => {
    eventsRef.current = events;
    totalFramesRef.current = totalFrames;
  }, [events, totalFrames, totalFramesRef]);

  useEffect(() => {
    if (keyFrame && keyCanvasRef.current) {
      refs.renderFrameRef.current(keyCanvasRef.current, keyFrame);
    }
  }, [keyFrame, refs]);

  const handleWorkerMessage = useCallback((message: SliceWorkerOutgoingMessage | null) => {
    if (!message) return;

    switch (message.type) {
      case 'PROGRESS': {
        if (message.total) {
          setTotalFrames(message.total);
          totalFramesRef.current = message.total;
        }
        break;
      }

      case 'INITIALIZED': {
        setFountainInfo({
          k: message.fountain.k,
          symbolSize: message.fountain.symbolSize,
          compression: message.fountain.compression,
          density: message.fountain.density,
          fingerprint: message.fountain.fingerprint,
          fileCount: message.fountain.fileCount,
          keyCode: message.fountain.keyCode,
          outerCode: message.fountain.outerCode,
          tiles: message.fountain.tiles,
          beacon: message.fountain.beacon,
          steerable: message.fountain.steerable,
        });
        if (message.fountain.steerable) eventsRef.current.onSteerable(message.fountain.sessionId);
        break;
      }

      case 'BEACON': {
        if (switchingRef.current) break;
        beaconPoolRef.current.set(message.index, { size: message.size, data: message.data });
        break;
      }

      case 'SWITCHED': {
        eventsRef.current.onSwitched(message.tiles);
        break;
      }

      case 'KEY_FRAME': {
        setKeyFrame({ size: message.size, data: message.data });
        break;
      }

      case 'FRAME': {
        // Frames of the old layout still in flight after a switch was asked for are not shown.
        if (switchingRef.current) break;
        const { index, size, data } = message;
        framePoolRef.current.storeFrame(index, size, data);
        setFrameBufferBytes(framePoolRef.current.byteLength);
        if (index === 0 && isVerifyingHandshakeRef.current) {
          eventsRef.current.onFirstFrame({ size, data });
        }
        break;
      }

      case 'ERROR': {
        eventsRef.current.onError(message.message);
        break;
      }

      default:
        break;
    }
  }, [totalFramesRef, switchingRef, beaconPoolRef, framePoolRef, isVerifyingHandshakeRef]);

  /** Spawns the worker unless one is alive already. */
  const ensureWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = spawnSliceWorker();
      workerRef.current = worker;
      worker.onmessage = (e: MessageEvent<SliceWorkerOutgoingMessage | null>) => handleWorkerMessage(e.data);
    }
  }, [workerRef, handleWorkerMessage]);

  /** Posts to the worker, if there is one. */
  const post = useCallback((message: SliceWorkerIncomingMessage) => {
    workerRef.current?.postMessage(message);
  }, [workerRef]);

  /** Stops the stream and keeps the worker for the next start. */
  const stop = useCallback(() => post({ type: 'STOP' }), [post]);

  /** Stops the stream and ends the worker. Only a failed scannability gate does this. */
  const terminate = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'STOP' });
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, [workerRef]);

  // Terminate background worker on unmount
  useEffect(() => () => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, [workerRef]);

  return {
    totalFrames, setTotalFrames, fountainInfo, setFountainInfo, keyFrame, setKeyFrame, keyCanvasRef,
    frameBufferBytes, ensureWorker, post, stop, terminate,
  };
}
