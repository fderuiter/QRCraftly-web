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

import { useState, type RefObject } from 'react';
import { PreallocatedFramePool } from '../framePool';
import type { BeaconPlan } from '../contracts';
import type { VsyncPacer } from '../multicode/pacing';
import type { MultiRateProfileName } from '../multicode/multirate';
import type { MultiCodePlan } from '../multicode/plan';
import type { WalletStream } from './walletStream';
import type { TransferFrame, TransferFrameRenderer } from './senderTypes';
import type { HandshakeFrameVerifier } from '../handshake';

/**
 * The refs the sender's sub-hooks share. The frame loops read them on every display refresh, so
 * they are refs rather than state, and each is read and written exactly as before the split (#1511).
 */
export interface SenderRefs {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  workerRef: RefObject<Worker | null>;
  framePoolRef: RefObject<PreallocatedFramePool>;
  passCountRef: RefObject<number>;
  renderFrameRef: RefObject<TransferFrameRenderer>;
  verifyFrameRef: RefObject<HandshakeFrameVerifier>;
  isTransferringRef: RefObject<boolean>;
  isPausedRef: RefObject<boolean>;
  isVerifyingHandshakeRef: RefObject<boolean>;
  settingsLockedRef: RefObject<boolean>;
  currentPlayIndexRef: RefObject<number>;
  fpsRef: RefObject<number>;
  totalFramesRef: RefObject<number>;
  animationIdRef: RefObject<number | null>;
  lastFrameTimeRef: RefObject<number>;
  lastRenderSuccessTimeRef: RefObject<number>;
  /** The multi-code plan of the running transfer, or null when it shows one code per frame. */
  tilePlanRef: RefObject<MultiCodePlan | null>;
  pacerRef: RefObject<VsyncPacer | null>;
  /** Display refreshes held per frame; 1 until the pacer has measured the display. */
  holdRef: RefObject<number>;
  /** Frame index each tile shows: -1 before its first, -2 while it is cleared for a beacon. */
  tileShownRef: RefObject<number[]>;
  /** The last dense frame index painted in each tile, for recycling and healing. */
  lastDenseRef: RefObject<number[]>;
  /** The beacons of the running multi-rate stream (#1143), or null. */
  beaconPlanRef: RefObject<BeaconPlan | null>;
  /** Beacon matrices from the worker, by beacon number. */
  beaconPoolRef: RefObject<Map<number, TransferFrame>>;
  /** The beacon on the canvas, or null while it shows tiles. */
  beaconShownRef: RefObject<number | null>;
  /** Frames a second a steered stream aims at: its profile's, in place of the page's setting. */
  targetFpsRef: RefObject<number | null>;
  /** The profile on screen; frames of the old layout are dropped while `switchingRef` is set. */
  profileRef: RefObject<MultiRateProfileName | null>;
  switchingRef: RefObject<{ plan: MultiCodePlan; beacon: BeaconPlan | null; profile: MultiRateProfileName } | null>;
  /** Refreshes played before the last pause, so a resumed stream carries on where it stopped. */
  refreshBaseRef: RefObject<number>;
  lastRefreshRef: RefObject<number>;
  /** The running wallet-compatible stream, or null. */
  walletRef: RefObject<WalletStream | null>;
  /** Bumped on every start and stop, so a wallet stream that opens late is dropped. */
  walletRunRef: RefObject<number>;
}

/**
 * Creates the shared refs once per sender: one stable object for its whole life, like `useRef`. The frame rate starts at the default 15.
 * @param renderFrame - The frame renderer it starts with.
 * @param verifyFrame - The first-frame check it starts with.
 */
export function useSenderRefs(renderFrame: TransferFrameRenderer, verifyFrame: HandshakeFrameVerifier): SenderRefs {
  const [refs] = useState<SenderRefs>(() => ({
    canvasRef: { current: null },
    workerRef: { current: null },
    framePoolRef: { current: new PreallocatedFramePool(64) },
    passCountRef: { current: 1 },
    renderFrameRef: { current: renderFrame },
    verifyFrameRef: { current: verifyFrame },
    isTransferringRef: { current: false },
    isPausedRef: { current: false },
    isVerifyingHandshakeRef: { current: false },
    settingsLockedRef: { current: false },
    currentPlayIndexRef: { current: 0 },
    fpsRef: { current: 15 },
    totalFramesRef: { current: 0 },
    animationIdRef: { current: null },
    lastFrameTimeRef: { current: 0 },
    lastRenderSuccessTimeRef: { current: 0 },
    tilePlanRef: { current: null },
    pacerRef: { current: null },
    holdRef: { current: 1 },
    tileShownRef: { current: [] },
    lastDenseRef: { current: [] },
    beaconPlanRef: { current: null },
    beaconPoolRef: { current: new Map() },
    beaconShownRef: { current: null },
    targetFpsRef: { current: null },
    profileRef: { current: null },
    switchingRef: { current: null },
    refreshBaseRef: { current: 0 },
    lastRefreshRef: { current: -1 },
    walletRef: { current: null },
    walletRunRef: { current: 0 },
  }));
  return refs;
}
