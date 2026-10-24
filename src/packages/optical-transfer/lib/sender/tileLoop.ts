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

import type { Dispatch, SetStateAction } from 'react';
import { holdForTargetFps, createVsyncPacer } from '../multicode/pacing';
import { isBeaconFrame } from '../multicode/multirate';
import type { MultiCodePlan } from '../multicode/plan';
import { tileFrameIndex, tileSlot } from '../multicode/stagger';
import { transferProgress } from '../progress';
import { clearTile, paintBeacon, paintTile, prepareTileCanvas } from './tiles';
import type { SenderRefs } from './senderRefs';
import type { SenderTileInfo } from './senderTypes';

/** The state the tile loop reports into, owned by `useFrameLoop`. */
export interface TileLoopReport {
  setTileInfo: Dispatch<SetStateAction<SenderTileInfo | null>>;
  setCurrentFrameIndex: Dispatch<SetStateAction<number>>;
  setProgress: Dispatch<SetStateAction<number>>;
  setPassCount: Dispatch<SetStateAction<number>>;
}

/**
 * Plays a multi-code stream (#1142): the pacer locks to the display's refreshes, each frame is
 * held for a whole number of them, and the two diagonal groups of tiles change on alternate
 * refreshes so a camera exposure that straddles a change still sees half the tiles whole.
 *
 * Moved verbatim from `useOpticalSender` (#1511); the pacer came in bc65ce56 (#1142) and 336e5d46.
 * @param refs - The sender's shared refs.
 * @param plan - The running transfer's multi-code plan.
 * @param report - Where progress and pacing go.
 */
export function startTileLoop(refs: SenderRefs, plan: MultiCodePlan, { setTileInfo, setCurrentFrameIndex, setProgress, setPassCount: setCurrentPass }: TileLoopReport): void {
  const {
    canvasRef, workerRef, framePoolRef, passCountRef, isTransferringRef, isPausedRef, fpsRef, totalFramesRef,
    lastRenderSuccessTimeRef, pacerRef, holdRef, tileShownRef, lastDenseRef, beaconPlanRef, beaconPoolRef,
    beaconShownRef, targetFpsRef, refreshBaseRef, lastRefreshRef,
  } = refs;
  const { layout } = plan;
  const canvas = canvasRef.current;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const modulePx = Math.max(1, Math.round(plan.modulePx * (window.devicePixelRatio || 1)));
  if (tileShownRef.current.length !== layout.tiles) {
    prepareTileCanvas(canvas, layout, modulePx);
    tileShownRef.current = Array.from({ length: layout.tiles }, () => -1);
  }
  const shown = tileShownRef.current;
  /**
   * The stream's own refresh count. The worker only makes frames a little past the last one shown,
   * so a timeline that ran ahead would ask for frames that never come and the stream would stop.
   * It stands still while a frame is missing, and moves at most one frame per tick when the
   * browser skips refreshes (a busy or throttled page) rather than jumping past frames.
   */
  let at = refreshBaseRef.current;
  let lastRefresh = -1;
  let waiting = false;
  const every = beaconPlanRef.current?.every ?? 0;
  /** Display slots before `slot` that were beacons, so dense slot numbers skip them. */
  const beaconsBefore = (slot: number) => (every >= 2 ? Math.floor((slot + 1) / every) : 0);
  const pacer = createVsyncPacer({
    clock: { request: (callback) => requestAnimationFrame(callback), cancel: (handle) => cancelAnimationFrame(handle) },
    hold: holdRef.current,
    onLocked: ({ refreshHz }) => {
      holdRef.current = holdForTargetFps(refreshHz, targetFpsRef.current ?? fpsRef.current);
      pacer.setHold(holdRef.current);
      setTileInfo({ layout: layout.id, hold: holdRef.current, refreshHz });
    },
    onTick: ({ refresh }) => {
      if (!isTransferringRef.current || isPausedRef.current) return;
      const now = performance.now();
      if (lastRefresh >= 0 && !waiting) at += Math.min(refresh - lastRefresh, holdRef.current);
      lastRefresh = refresh;
      lastRefreshRef.current = at;
      const hold = holdRef.current;
      const pool = framePoolRef.current;
      const staggered = layout.tiles > 1 && hold > 1;
      let newest = -1;
      let missing = false;

      // A beacon fills the whole canvas for the first group's slot; the tiles come back after it.
      const leadSlot = Math.floor(at / hold);
      if (every >= 2 && isBeaconFrame(leadSlot, every)) {
        const number = (leadSlot + 1) / every - 1;
        if (beaconShownRef.current !== number) {
          const beacon = beaconPoolRef.current.get(number);
          if (beacon) {
            paintBeacon(canvas, beacon);
            beaconPoolRef.current.delete(number);
            beaconShownRef.current = number;
            shown.fill(-2);
          } else {
            missing = true;
          }
        }
      } else {
        if (beaconShownRef.current !== null) {
          prepareTileCanvas(canvas, layout, modulePx);
          beaconShownRef.current = null;
        }
        for (let tile = 0; tile < layout.tiles; tile++) {
          const slot = staggered ? tileSlot(layout, tile, at, hold) : leadSlot;
          if (every >= 2 && isBeaconFrame(slot, every)) {
            // The lagging group's share of the beacon slot: an empty cell until its next frame.
            if (shown[tile] !== -2) {
              clearTile(ctx, layout, modulePx, tile);
              shown[tile] = -2;
            }
            continue;
          }
          const index = tileFrameIndex(layout, tile, slot - beaconsBefore(slot));
          if (index === shown[tile]) continue;
          const frame = pool.getFrame(index);
          if (!frame) {
            // The tile keeps its last frame until the worker catches up.
            missing = true;
            continue;
          }
          paintTile(ctx, layout, modulePx, tile, frame);
          // Recycle every slot this tile has moved past, skipped frames included.
          const last = lastDenseRef.current[tile] ?? -1;
          for (let old = Math.max(tile, last); old < index; old += layout.tiles) pool.delete(old);
          lastDenseRef.current[tile] = index;
          shown[tile] = index;
          newest = Math.max(newest, index);
        }
      }
      waiting = missing;
      const worker = workerRef.current;
      if (newest >= 0) {
        lastRenderSuccessTimeRef.current = now;
        worker?.postMessage({ type: 'ACK', payload: { index: newest } });
        const total = totalFramesRef.current || 1;
        setCurrentFrameIndex(newest + 1);
        const { percent, loop: passNumber } = transferProgress(newest + 1, total);
        setProgress(percent);
        if (passNumber !== passCountRef.current) {
          passCountRef.current = passNumber;
          setCurrentPass(passNumber);
        }
      } else if (missing && now - lastRenderSuccessTimeRef.current >= 100) {
        lastRenderSuccessTimeRef.current = now;
        worker?.postMessage({ type: 'HEAL', payload: { lastAckedIndex: Math.max(-1, ...lastDenseRef.current) } });
      }
    },
  });
  pacerRef.current = pacer;
}
