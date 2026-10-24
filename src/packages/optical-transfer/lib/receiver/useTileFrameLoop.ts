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

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ScanCorners } from '@/packages/optical-scanner/client';
import { decoderPoolSize } from '../multicode/pool';
import { spawnTileWorker } from './media';
import type { TileCode } from './tileContracts';
import { createTileReader, type TileReader } from './tileReader';

/** How long the lock-on brackets stay after the last code the camera read. */
const LOCK_ON_HOLD_MS = 400;

/** Where the multi-code reader sends what it reads. Read through the ref on every frame. */
export interface TileFrameHandlers {
  onFrame: (decodedText: string) => void;
  onFrameRead: (codes: readonly TileCode[]) => void;
}

/**
 * The lock-on brackets and the multi-code frame loop (#1514), moved from `useOpticalReceiver`.
 * @param videoRef - The video the camera streams into.
 * @param handlersRef - Where each code read goes.
 */
export function useTileFrameLoop(videoRef: RefObject<HTMLVideoElement | null>, handlersRef: RefObject<TileFrameHandlers>) {
  // Where the code the camera last read sits in the frame, for the lock-on brackets. It clears
  // when no code was read for a moment, so the brackets do not hang on an empty frame.
  const [lockOn, setLockOn] = useState<ScanCorners | null>(null);
  const lockOnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markLockOn = useCallback((corners: ScanCorners | null) => {
    if (lockOnTimer.current) clearTimeout(lockOnTimer.current);
    setLockOn(corners);
    if (corners) lockOnTimer.current = setTimeout(() => setLockOn(null), LOCK_ON_HOLD_MS);
  }, []);
  useEffect(() => () => {
    if (lockOnTimer.current) clearTimeout(lockOnTimer.current);
  }, []);

  // The multi-code reader takes the camera's frames in place of the scanner's one-code loop.
  const tileReaderRef = useRef<TileReader | null>(null);
  const tileReader = useMemo<TileReader>(
    () => ({
      start: () => {
        tileReaderRef.current ??= createTileReader({
          getVideo: () => videoRef.current,
          poolSize: decoderPoolSize(typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency),
          onText: (text) => handlersRef.current.onFrame(text),
          onCorners: (corners) => markLockOn(corners),
          onFrameRead: (codes) => handlersRef.current.onFrameRead(codes),
          spawnWorker: spawnTileWorker,
        });
        tileReaderRef.current.start();
      },
      stop: () => tileReaderRef.current?.stop(),
    }),
    [videoRef, handlersRef, markLockOn]
  );
  return { lockOn, markLockOn, tileReader };
}
