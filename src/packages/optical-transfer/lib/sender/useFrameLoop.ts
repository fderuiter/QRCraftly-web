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

import { useCallback, useEffect, useState } from 'react';
import type { MultiCodePlan } from '../multicode/plan';
import { transferProgress } from '../progress';
import type { SenderRefs } from './senderRefs';
import type { SenderTileInfo, TransferFrame } from './senderTypes';
import { startTileLoop } from './tileLoop';
import type { WalletStream } from './walletStream';

/**
 * The sender's three display loops and the vsync pacer (#1511): one code per frame, the
 * wallet-compatible stream, and the multi-code tiles. The loops were moved here verbatim from
 * `useOpticalSender`; the tile loop lives in `startTileLoop`. The 100 ms HEAL/ACK throttle dates
 * from 7b67bcd6 and 0fcfcbf8 (kept by 404d9f72).
 * @param refs - The sender's shared refs.
 */
export function useFrameLoop(refs: SenderRefs) {
  const {
    canvasRef, workerRef, framePoolRef, passCountRef, renderFrameRef, isTransferringRef, isPausedRef,
    currentPlayIndexRef, fpsRef, totalFramesRef, animationIdRef, lastFrameTimeRef, lastRenderSuccessTimeRef,
    pacerRef, tileShownRef, lastDenseRef, beaconPoolRef, beaconShownRef, refreshBaseRef, lastRefreshRef, walletRef,
  } = refs;
  const [progress, setProgress] = useState(0);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [currentPass, setCurrentPass] = useState(1);
  /** The running multi-code stream's layout and pacing, or null. */
  const [tileInfo, setTileInfo] = useState<SenderTileInfo | null>(null);

  /** Paints a frame in the fixed transfer look. */
  const paint = useCallback((frame: TransferFrame) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderFrameRef.current(canvas, frame);
  }, [canvasRef, renderFrameRef]);

  const runAnimationLoop = useCallback(() => {
    const loop = () => {
      if (!isTransferringRef.current || isPausedRef.current) return;

      const now = performance.now();

      if (!framePoolRef.current.hasFrame(currentPlayIndexRef.current)) {
        if (now - lastRenderSuccessTimeRef.current >= 100) {
          lastRenderSuccessTimeRef.current = now;
          if (workerRef.current) {
            const lastRenderedIdx = currentPlayIndexRef.current - 1;
            workerRef.current.postMessage({
              type: 'HEAL',
              payload: { lastAckedIndex: lastRenderedIdx },
            });
            workerRef.current.postMessage({
              type: 'ACK',
              payload: { index: lastRenderedIdx },
            });
          }
        }
      }

      const interval = 1000 / fpsRef.current;
      const elapsed = now - lastFrameTimeRef.current;

      if (elapsed >= interval) {
        lastFrameTimeRef.current = now - (elapsed % interval);

        const playIdx = currentPlayIndexRef.current;
        const pool = framePoolRef.current;

        const frame = pool.getFrame(playIdx);
        if (frame) {
          paint(frame);

          const total = totalFramesRef.current || 1;
          setCurrentFrameIndex(playIdx + 1);

          if (workerRef.current) {
            workerRef.current.postMessage({
              type: 'ACK',
              payload: { index: playIdx },
            });
          }

          // Rateless: frames play once in order and their pool slot is recycled.
          pool.delete(playIdx);
          const { percent, loop: passNumber } = transferProgress(playIdx + 1, total);
          setProgress(percent);
          if (passNumber !== passCountRef.current) {
            passCountRef.current = passNumber;
            setCurrentPass(passNumber);
          }
          currentPlayIndexRef.current = playIdx + 1;

          lastRenderSuccessTimeRef.current = now;
        }
      }

      animationIdRef.current = requestAnimationFrame(loop);
    };

    animationIdRef.current = requestAnimationFrame(loop);
  }, [paint, isTransferringRef, isPausedRef, framePoolRef, currentPlayIndexRef, lastRenderSuccessTimeRef, workerRef, fpsRef, lastFrameTimeRef, totalFramesRef, passCountRef, animationIdRef]);

  /** Plays a wallet-compatible stream: a new BC-UR part every frame, endlessly, as wallets expect. */
  const runWalletLoop = useCallback(() => {
    const loop = () => {
      const wallet = walletRef.current;
      if (!wallet || !isTransferringRef.current || isPausedRef.current) return;
      const now = performance.now();
      const interval = 1000 / fpsRef.current;
      const elapsed = now - lastFrameTimeRef.current;
      if (elapsed >= interval) {
        lastFrameTimeRef.current = now - (elapsed % interval);
        paint(wallet.nextFrame());
        const shown = wallet.shown;
        setCurrentFrameIndex(shown);
        const { percent, loop: passNumber } = transferProgress(shown, wallet.fragmentCount);
        setProgress(percent);
        if (passNumber !== passCountRef.current) {
          passCountRef.current = passNumber;
          setCurrentPass(passNumber);
        }
      }
      animationIdRef.current = requestAnimationFrame(loop);
    };
    animationIdRef.current = requestAnimationFrame(loop);
  }, [paint, walletRef, isTransferringRef, isPausedRef, fpsRef, lastFrameTimeRef, passCountRef, animationIdRef]);

  /** Plays a multi-code stream (#1142); see `startTileLoop`. */
  const runTileLoop = useCallback((plan: MultiCodePlan) => {
    startTileLoop(refs, plan, { setTileInfo, setCurrentFrameIndex, setProgress, setPassCount: setCurrentPass });
  }, [refs]);

  /** Cancels the running loop and the pacer. Safe to call when nothing runs. */
  const stopLoop = useCallback(() => {
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }
    pacerRef.current?.stop();
    pacerRef.current = null;
  }, [animationIdRef, pacerRef]);

  /** Stops the loop and empties the screen's bookkeeping, as a stopped stream needs. */
  const resetPlayback = useCallback(() => {
    stopLoop();
    tileShownRef.current = [];
    lastDenseRef.current = [];
    beaconPoolRef.current.clear();
    beaconShownRef.current = null;
    refreshBaseRef.current = 0;
    lastRefreshRef.current = -1;
    setTileInfo(null);
    framePoolRef.current.clear();
    passCountRef.current = 1;
    setCurrentPass(1);
    currentPlayIndexRef.current = 0;
    setCurrentFrameIndex(0);
    setProgress(0);
  }, [stopLoop, tileShownRef, lastDenseRef, beaconPoolRef, beaconShownRef, refreshBaseRef, lastRefreshRef, framePoolRef, passCountRef, currentPlayIndexRef]);

  /** Plays whichever loop the running stream needs: the wallet parts, the tiles, or one code per frame. */
  const play = useCallback(() => {
    if (walletRef.current) runWalletLoop();
    else if (refs.tilePlanRef.current) runTileLoop(refs.tilePlanRef.current);
    else runAnimationLoop();
  }, [refs, walletRef, runWalletLoop, runTileLoop, runAnimationLoop]);

  /** Shows a checked wallet stream's first part and plays the rest. */
  const playWallet = useCallback((wallet: WalletStream, first: TransferFrame) => {
    walletRef.current = wallet;
    paint(first);
    setCurrentFrameIndex(1);
    lastFrameTimeRef.current = performance.now();
    runWalletLoop();
  }, [walletRef, paint, lastFrameTimeRef, runWalletLoop]);

  /** Freezes the stream on its current frame; `play` carries on from the next refresh. */
  const freeze = useCallback(() => {
    stopLoop();
    refreshBaseRef.current = lastRefreshRef.current + 1;
  }, [stopLoop, refreshBaseRef, lastRefreshRef]);

  // No frame is requested after unmount.
  useEffect(() => () => {
    if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
    pacerRef.current?.stop();
  }, [animationIdRef, pacerRef]);

  return {
    progress, currentFrameIndex, currentPass, setCurrentPass, tileInfo, setTileInfo,
    runTileLoop, play, playWallet, freeze, resetPlayback,
  };
}
