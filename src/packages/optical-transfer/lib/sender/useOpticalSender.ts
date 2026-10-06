/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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


import type React from 'react';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PreallocatedFramePool } from '../framePool';
import { verifyHandshakeFrame, type HandshakeFrameVerifier } from '../handshake';
import type { BeaconPlan, SliceWorkerOutgoingMessage, TransferStats } from '../contracts';
import { DEFAULT_TRANSFER_DENSITY, type TransferCompression, type TransferDensity } from '../fountain/session';
import type { TileLayoutId } from '../multicode/layout';
import { holdForTargetFps, createVsyncPacer, type VsyncPacer } from '../multicode/pacing';
import { MULTI_RATE_PROFILES, isBeaconFrame, type MultiRateProfileName } from '../multicode/multirate';
import { planMultiCode, type MultiCodePlan } from '../multicode/plan';
import { tileFrameIndex, tileSlot } from '../multicode/stagger';
import type { OuterCode } from '../prism/session';
import { createSpeedController, switchableProfile, type ControllerDecision, type SpeedController } from '../feedback/controller';
import { createFeedbackLink, type CameraPermission, type FeedbackLink, type FeedbackLinkState } from '../feedback/link';
import { decodeFrame } from '../prism/frame';
import { spawnTileWorker } from '../receiver/media';
import { createTileReader, type TileReader } from '../receiver/tileReader';
import { clearTile, paintBeacon, paintTile, prepareTileCanvas, tileScreenOf } from './tiles';
import { formatMegabytes, spawnSliceWorker } from './workers';
import { openWalletStream, type WalletStream } from './walletStream';

/** One QR module matrix produced by the slice worker. */
export interface TransferFrame {
  size: number;
  data: Uint8Array;
}

/**
 * Paints one frame onto the transfer canvas in the fixed transfer look (`TRANSFER_FRAME_CONFIG`):
 * a transfer frame carries no styling that could cost a read (#1307). Injected by the page so the
 * package does not depend on the app's canvas renderer.
 */
export type TransferFrameRenderer = (canvas: HTMLCanvasElement, frame: TransferFrame) => void;

export interface UseOpticalSenderOptions {
  /** Paints each frame onto `canvasRef`. */
  renderFrame: TransferFrameRenderer;
  /** Scannability gate run on the first frame before playback. Defaults to `verifyHandshakeFrame`. */
  verifyFrame?: HandshakeFrameVerifier;
  /**
   * Opens the sending device's webcam for the back channel (#1146). Called only after the person
   * turned on "Let the receiver steer" and started a transfer. Without it, steering is unavailable.
   */
  requestWebcam?: () => Promise<MediaStream>;
}

/** What asking for the webcam came back with: a refusal and a missing camera are told apart. */
function permissionOf(error: unknown): CameraPermission {
  // A DOMException is not an Error everywhere, so read its name as a plain property.
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') return 'unavailable';
  throw error;
}

/** Session details reported by the slice worker. */
export interface SenderFountainInfo {
  /** Source block count K. */
  k: number;
  /** Effective bytes per symbol after the density's QR version clamp. */
  symbolSize: number;
  /** Density the frames were sized for. */
  density: TransferDensity;
  /** Whether the payload was deflate-raw compressed or sent verbatim. */
  compression: TransferCompression;
  /** Four words from the session ID, shown on both screens so the two can be compared. */
  fingerprint: string;
  /** Files in the transfer. */
  fileCount: number;
  /** The words of a private transfer's key code; absent when the transfer is not private. */
  keyCode?: string;
  /** The code the stream is sent with. */
  outerCode: OuterCode;
  /** The multi-code layout the stream is shown with, or null for one code per frame. */
  tiles: TileLayoutId | null;
  /** The beacons between the tiles, or null for none. */
  beacon: BeaconPlan | null;
  /** Whether the receiver can steer this transfer's speed (#1146). */
  steerable: boolean;
}

/** How a running multi-code stream is shown (#1142). */
export interface SenderTileInfo {
  layout: TileLayoutId;
  /** Display refreshes each frame is held for, once the refresh rate is measured. */
  hold: number | null;
  /** Measured display refresh rate, or null while measuring. */
  refreshHz: number | null;
}

/** The multi-rate profile (#1143) that goes with each density, as the page's speed presets pair them. */
/** Shown when wallet-compatible mode is asked to send several files. */
const WALLET_ONE_FILE = 'Wallet-compatible mode sends one file at a time. Pick a single file, or turn the mode off.';

const PROFILE_FOR_DENSITY: Readonly<Record<TransferDensity, MultiRateProfileName>> = { reliable: 'steady', balanced: 'balanced', fast: 'fast' };

const HANDSHAKE_FAILURE_SUFFIX = 'failed scannability check. Transfer playback remains paused. Try the Reliable density.';

/**
 * Headless React hook to coordinate asynchronous file slicing, animation playback,
 * flow-control feedback, and pre-allocated frame memory pooling for the sender.
 */
export function useOpticalSender({
  renderFrame,
  verifyFrame = verifyHandshakeFrame,
  requestWebcam,
}: UseOpticalSenderOptions) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  /** Encrypt the next transfer under a key code (#1144). */
  const [isPrivate, setIsPrivateState] = useState(false);
  /** The key QR, while the person holds the button that shows it. */
  const [keyFrame, setKeyFrame] = useState<TransferFrame | null>(null);
  const selectedFile = selectedFiles[0] ?? null;
  const setSelectedFile = useCallback((file: File | null) => setSelectedFiles(file ? [file] : []), []);
  const [isTransferring, setIsTransferring] = useState(false);
  /** True while a running stream is paused: the last frame stays on screen and nothing animates (#1148). */
  const [isPaused, setIsPaused] = useState(false);
  const [isVerifyingHandshake, setIsVerifyingHandshake] = useState(false);
  const [handshakeError, setHandshakeError] = useState<string | null>(null);
  const [handshakeVerified, setHandshakeVerified] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [density, setDensityState] = useState<TransferDensity>(DEFAULT_TRANSFER_DENSITY);
  /** The code to send with: the LT code by default, the outer code (#1141) when chosen under Advanced. */
  const [outerCode, setOuterCodeState] = useState<OuterCode>('lt');
  /** Several codes per frame (#1142), chosen under Advanced. Off by default. */
  const [multiCode, setMultiCodeState] = useState(false);
  /** The running multi-code stream's layout and pacing, or null. */
  const [tileInfo, setTileInfo] = useState<SenderTileInfo | null>(null);
  /** Let the receiver steer the speed through the webcam (#1146), chosen under Advanced. Off by default. */
  const [steer, setSteerSetting] = useState(false);
  /** The back channel: off, asking for the webcam, listening, or one-way after a refusal or loss. */
  const [steerState, setSteerState] = useState<FeedbackLinkState>({ status: 'off' });
  /** The profile a steered transfer shows now, or null. */
  const [steeredProfile, setSteeredProfile] = useState<MultiRateProfileName | null>(null);
  /** Receivers whose feedback code the webcam reads. */
  const [steeringReceivers, setSteeringReceivers] = useState(0);
  /** True when the sender stopped because every receiver it could see had the file. */
  const [autoStopped, setAutoStopped] = useState(false);
  /** Sends real BC-UR parts that wallets can read, in place of Prism (#1149). */
  const [walletCompat, setWalletCompatState] = useState(false);
  const [fountainInfo, setFountainInfo] = useState<SenderFountainInfo | null>(null);
  const [fps, setFps] = useState(15);
  const [currentPass, setCurrentPass] = useState(1);
  const [frameBufferBytes, setFrameBufferBytes] = useState(0);
  const [transferFile, setTransferFile] = useState<{ fileName: string; fileSize: number; startTime: number }>({
    fileName: '',
    fileSize: 0,
    startTime: 0,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Canvas of the key QR; painted whenever `keyFrame` is set. */
  const keyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const framePoolRef = useRef<PreallocatedFramePool>(new PreallocatedFramePool(64));
  const passCountRef = useRef<number>(1);

  // Refs for background loop
  const renderFrameRef = useRef(renderFrame);
  const verifyFrameRef = useRef(verifyFrame);
  const isTransferringRef = useRef(false);
  const isPausedRef = useRef(false);
  const isVerifyingHandshakeRef = useRef(false);
  const currentPlayIndexRef = useRef(0);
  const fpsRef = useRef(fps);
  const totalFramesRef = useRef(0);
  const animationIdRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef(0);
  const lastRenderSuccessTimeRef = useRef(0);
  /** The multi-code plan of the running transfer, or null when it shows one code per frame. */
  const tilePlanRef = useRef<MultiCodePlan | null>(null);
  const pacerRef = useRef<VsyncPacer | null>(null);
  /** Display refreshes held per frame; 1 until the pacer has measured the display. */
  const holdRef = useRef(1);
  /** Frame index each tile shows: -1 before its first, -2 while it is cleared for a beacon. */
  const tileShownRef = useRef<number[]>([]);
  /** The last dense frame index painted in each tile, for recycling and healing. */
  const lastDenseRef = useRef<number[]>([]);
  /** The beacons of the running multi-rate stream (#1143), or null. */
  const beaconPlanRef = useRef<BeaconPlan | null>(null);
  /** Beacon matrices from the worker, by beacon number. */
  const beaconPoolRef = useRef<Map<number, TransferFrame>>(new Map());
  /** The beacon on the canvas, or null while it shows tiles. */
  const beaconShownRef = useRef<number | null>(null);
  /** Frames a second a steered stream aims at: its profile's, in place of the page's setting. */
  const targetFpsRef = useRef<number | null>(null);
  const requestWebcamRef = useRef(requestWebcam);
  const linkRef = useRef<FeedbackLink | null>(null);
  const controllerRef = useRef<SpeedController | null>(null);
  const webcamRef = useRef<{ stream: MediaStream; video: HTMLVideoElement } | null>(null);
  const feedbackReaderRef = useRef<TileReader | null>(null);
  const steerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** The profile on screen and the one being switched to; frames of the old layout are dropped meanwhile. */
  const profileRef = useRef<MultiRateProfileName | null>(null);
  const switchingRef = useRef<{ plan: MultiCodePlan; beacon: BeaconPlan | null; profile: MultiRateProfileName } | null>(null);
  /** Applies a speed decision; set below, read by the webcam reader and the steering timer. */
  const applyDecisionRef = useRef<(decision: ControllerDecision) => void>(() => {});
  /** Refreshes played before the last pause, so a resumed stream carries on where it stopped. */
  const refreshBaseRef = useRef(0);
  const lastRefreshRef = useRef(-1);
  /** The running wallet-compatible stream, or null. */
  const walletRef = useRef<WalletStream | null>(null);
  /** Bumped on every start and stop, so a wallet stream that opens late is dropped. */
  const walletRunRef = useRef(0);

  useEffect(() => {
    renderFrameRef.current = renderFrame;
    verifyFrameRef.current = verifyFrame;
    isTransferringRef.current = isTransferring;
    isVerifyingHandshakeRef.current = isVerifyingHandshake;
    fpsRef.current = fps;
    totalFramesRef.current = totalFrames;
    requestWebcamRef.current = requestWebcam;
  }, [renderFrame, verifyFrame, isTransferring, isVerifyingHandshake, fps, totalFrames, requestWebcam]);

  /**
   * True from Start until the stream stops. A stream keeps the settings it was started with, so the
   * switches below cannot change while it starts or runs and never show something it is not doing.
   */
  const settingsLocked = isTransferring || isVerifyingHandshake;
  const settingsLockedRef = useRef(false);
  useEffect(() => {
    settingsLockedRef.current = settingsLocked;
  }, [settingsLocked]);
  const settingSetters = useMemo(() => {
    const unlessLocked =
      <T,>(set: (value: T) => void) =>
      (value: T) => {
        if (!settingsLockedRef.current) set(value);
      };
    return {
      setIsPrivate: unlessLocked(setIsPrivateState),
      setDensity: unlessLocked(setDensityState),
      setOuterCode: unlessLocked(setOuterCodeState),
      setMultiCode: unlessLocked(setMultiCodeState),
      setSteer: unlessLocked(setSteerSetting),
      setWalletCompat: unlessLocked(setWalletCompatState),
    };
  }, []);

  /** Turns the back channel off and lets the webcam go. */
  const endSteering = useCallback(() => {
    if (steerTimerRef.current) clearInterval(steerTimerRef.current);
    steerTimerRef.current = null;
    feedbackReaderRef.current?.stop();
    feedbackReaderRef.current = null;
    linkRef.current?.disable();
    linkRef.current = null;
    controllerRef.current = null;
    switchingRef.current = null;
  }, []);

  // Terminate background worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      pacerRef.current?.stop();
      endSteering();
    };
  }, [endSteering]);

  /** Paints a frame in the fixed transfer look. */
  const paint = useCallback((frame: TransferFrame) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderFrameRef.current(canvas, frame);
  }, []);

  useEffect(() => {
    if (keyFrame && keyCanvasRef.current) {
      renderFrameRef.current(keyCanvasRef.current, keyFrame);
    }
  }, [keyFrame]);

  const stopTransfer = useCallback(() => {
    setIsTransferring(false);
    isTransferringRef.current = false;
    setIsPaused(false);
    isPausedRef.current = false;
    setIsVerifyingHandshake(false);
    isVerifyingHandshakeRef.current = false;
    settingsLockedRef.current = false;
    setHandshakeError(null);
    setHandshakeVerified(false);
    setKeyFrame(null);
    walletRef.current = null;
    walletRunRef.current += 1;
    endSteering();
    setSteerState({ status: 'off' });
    setSteeredProfile(null);
    setSteeringReceivers(0);
    profileRef.current = null;
    targetFpsRef.current = null;
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'STOP' });
    }
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }
    pacerRef.current?.stop();
    pacerRef.current = null;
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
  }, [endSteering]);

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
          setProgress(Math.min(100, Math.round(((playIdx + 1) / total) * 100)));
          const passNumber = Math.floor(playIdx / total) + 1;
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
  }, [paint]);

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
        setProgress(Math.min(100, Math.round((shown / wallet.fragmentCount) * 100)));
        const passNumber = Math.floor((shown - 1) / wallet.fragmentCount) + 1;
        if (passNumber !== passCountRef.current) {
          passCountRef.current = passNumber;
          setCurrentPass(passNumber);
        }
      }
      animationIdRef.current = requestAnimationFrame(loop);
    };
    animationIdRef.current = requestAnimationFrame(loop);
  }, [paint]);

  /**
   * Opens and checks a wallet-compatible stream, then plays it. Only one file, sent as plain
   * `ur:bytes`: no name, type, compression or key, which BC-UR has no place for.
   * @param file The file to send.
   */
  const startWalletTransfer = useCallback((file: File) => {
    const run = walletRunRef.current;
    const fail = (message: string) => {
      if (run !== walletRunRef.current) return;
      isVerifyingHandshakeRef.current = false;
      setIsVerifyingHandshake(false);
      setHandshakeError(message);
    };
    file
      .arrayBuffer()
      .then((buffer) => openWalletStream(new Uint8Array(buffer), density))
      .then(async (wallet) => {
        if (run !== walletRunRef.current) return;
        const first = wallet.nextFrame();
        const isScannable = await verifyFrameRef.current(first);
        if (run !== walletRunRef.current) return;
        if (!isScannable) {
          fail(`Transfer QR frame ${HANDSHAKE_FAILURE_SUFFIX}`);
          return;
        }
        walletRef.current = wallet;
        totalFramesRef.current = wallet.fragmentCount;
        setTotalFrames(wallet.fragmentCount);
        setFountainInfo(null);
        isVerifyingHandshakeRef.current = false;
        setIsVerifyingHandshake(false);
        setHandshakeVerified(true);
        setIsTransferring(true);
        isTransferringRef.current = true;
        paint(first);
        setCurrentFrameIndex(1);
        lastFrameTimeRef.current = performance.now();
        runWalletLoop();
      })
      .catch((error: unknown) => fail(error instanceof Error ? error.message : 'Could not start the wallet-compatible stream.'));
  }, [density, paint, runWalletLoop]);

  /**
   * Plays a multi-code stream (#1142): the pacer locks to the display's refreshes, each frame is
   * held for a whole number of them, and the two diagonal groups of tiles change on alternate
   * refreshes so a camera exposure that straddles a change still sees half the tiles whole.
   */
  const runTileLoop = useCallback((plan: MultiCodePlan) => {
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
          setProgress(Math.min(100, Math.round(((newest + 1) / total) * 100)));
          const passNumber = Math.floor(newest / total) + 1;
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
  }, []);

  /** Runs the scannability gate on the first frame, then starts or refuses playback. */
  const gateFirstFrame = useCallback(async (frame: TransferFrame) => {
    isVerifyingHandshakeRef.current = false;

    // The first frame is checked as it will be shown. Tiles are painted by the sender itself, so they skip the check.
    const isScannable = tilePlanRef.current ? true : await verifyFrameRef.current(frame);

    setIsVerifyingHandshake(false);

    if (isScannable) {
      setHandshakeVerified(true);
      setHandshakeError(null);
      setIsTransferring(true);
      isTransferringRef.current = true;
      if (tilePlanRef.current) runTileLoop(tilePlanRef.current);
      else runAnimationLoop();
      return;
    }

    setHandshakeVerified(false);
    setHandshakeError(`Transfer QR frame ${HANDSHAKE_FAILURE_SUFFIX}`);
    setIsTransferring(false);
    isTransferringRef.current = false;
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'STOP' });
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, [runAnimationLoop, runTileLoop]);

  /** Asks the worker for a profile's layout; the stream changes over when SWITCHED comes back. */
  const requestSwitch = useCallback((name: MultiRateProfileName) => {
    const canvas = canvasRef.current;
    const worker = workerRef.current;
    if (!canvas || !worker || switchingRef.current) return;
    const profile = switchableProfile(name);
    const plan = planMultiCode({ enabled: true, screen: tileScreenOf(canvas), refreshHz: 60, targetFps: profile.targetFps, layoutId: profile.layoutId });
    // A screen too small for the profile's layout stays where it is.
    if (!plan || plan.layout.id !== profile.layoutId) return;
    const beacon = profile.beaconVersion > plan.layout.version ? { version: profile.beaconVersion, every: profile.beaconEvery } : null;
    switchingRef.current = { plan, beacon, profile: name };
    worker.postMessage({ type: 'SWITCH', payload: { tiles: plan.layout.id, beacon: beacon ?? undefined } });
  }, []);

  /** Shows the new layout from its first frame once the worker has switched. */
  const finishSwitch = useCallback((tiles: TileLayoutId) => {
    const next = switchingRef.current;
    if (!next || next.plan.layout.id !== tiles) return;
    pacerRef.current?.stop();
    pacerRef.current = null;
    framePoolRef.current.clear();
    tileShownRef.current = [];
    lastDenseRef.current = [];
    beaconPoolRef.current.clear();
    beaconShownRef.current = null;
    refreshBaseRef.current = 0;
    lastRefreshRef.current = -1;
    tilePlanRef.current = next.plan;
    beaconPlanRef.current = next.beacon;
    targetFpsRef.current = MULTI_RATE_PROFILES[next.profile].targetFps;
    holdRef.current = 1;
    profileRef.current = next.profile;
    switchingRef.current = null;
    setSteeredProfile(next.profile);
    setTileInfo({ layout: next.plan.layout.id, hold: null, refreshHz: null });
    if (isTransferringRef.current && !isPausedRef.current) runTileLoop(next.plan);
  }, [runTileLoop]);
  const finishSwitchRef = useRef(finishSwitch);

  /** Follows the speed controller: stops once every receiver is done, else shows the profile it asks for. */
  const applyDecision = useCallback((decision: ControllerDecision) => {
    const link = linkRef.current;
    const current = profileRef.current;
    if (!link || !current) return;
    setSteeringReceivers(decision.receivers);
    if (link.shouldStop(decision.stop)) {
      stopTransfer();
      setAutoStopped(true);
      return;
    }
    const wanted = link.profileFor(current, decision.profile);
    if (wanted !== current) requestSwitch(wanted);
  }, [stopTransfer, requestSwitch]);

  /**
   * Opens the back channel for a steerable transfer: asks for the webcam, then reads the receivers'
   * feedback codes with one decoder worker and runs the controller's timers every 100 ms.
   */
  const startSteering = useCallback((sessionId: string) => {
    endSteering();
    const initial = profileRef.current ?? 'balanced';
    const controller = createSpeedController({ sessionId, initial });
    const releaseCamera = () => {
      const webcam = webcamRef.current;
      webcamRef.current = null;
      webcam?.stream.getTracks().forEach((track) => track.stop());
      if (webcam) webcam.video.srcObject = null;
    };
    const requestCamera = async (): Promise<CameraPermission> => {
      const open = requestWebcamRef.current;
      if (!open) return 'unavailable';
      let stream: MediaStream;
      try {
        stream = await open();
      } catch (error) {
        return permissionOf(error);
      }
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      webcamRef.current = { stream, video };
      try {
        await video.play();
      } catch {
        // A video that will not autoplay still delivers frames once it can; the reader waits for them.
      }
      return 'granted';
    };
    const link = createFeedbackLink({ requestCamera, releaseCamera });
    linkRef.current = link;
    controllerRef.current = controller;
    setSteerState({ status: 'requesting' });
    void link.enable().then((state) => {
      if (linkRef.current !== link) return;
      setSteerState(state);
      if (state.status !== 'listening') return;
      const reader = createTileReader({
        getVideo: () => webcamRef.current?.video ?? null,
        poolSize: 1,
        onText: () => undefined,
        onFrameRead: (codes) => {
          for (const code of codes) {
            const decoded = decodeFrame(code.text);
            if (!decoded.ok || decoded.frame.type !== 'feedback') continue;
            applyDecisionRef.current(controller.report(decoded.frame, decoded.frame.sessionId, performance.now()));
          }
        },
        spawnWorker: spawnTileWorker,
      });
      feedbackReaderRef.current = reader;
      reader.start();
      steerTimerRef.current = setInterval(() => {
        const live = webcamRef.current?.stream.getVideoTracks().some((track) => track.readyState === 'live') ?? false;
        if (!live) {
          // The camera went away: carry on one way with the profile on screen, and no auto-stop.
          link.cameraLost();
          setSteerState(link.state);
          feedbackReaderRef.current?.stop();
          if (steerTimerRef.current) clearInterval(steerTimerRef.current);
          steerTimerRef.current = null;
          return;
        }
        applyDecisionRef.current(controller.tick(performance.now()));
      }, 100);
    });
  }, [endSteering]);
  const startSteeringRef = useRef(startSteering);
  useEffect(() => {
    finishSwitchRef.current = finishSwitch;
    applyDecisionRef.current = applyDecision;
    startSteeringRef.current = startSteering;
  }, [finishSwitch, applyDecision, startSteering]);

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
        if (message.fountain.steerable) startSteeringRef.current(message.fountain.sessionId);
        break;
      }

      case 'BEACON': {
        if (switchingRef.current) break;
        beaconPoolRef.current.set(message.index, { size: message.size, data: message.data });
        break;
      }

      case 'SWITCHED': {
        finishSwitchRef.current(message.tiles);
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
          void gateFirstFrame({ size, data });
        }
        break;
      }

      case 'ERROR': {
        stopTransfer();
        setHandshakeError(message.message);
        break;
      }

      default:
        break;
    }
  }, [gateFirstFrame, stopTransfer]);

  const startTransfer = useCallback(() => {
    if (selectedFiles.length === 0) return;

    stopTransfer();
    setAutoStopped(false);

    setIsVerifyingHandshake(true);
    isVerifyingHandshakeRef.current = true;
    settingsLockedRef.current = true;
    setHandshakeError(null);
    setHandshakeVerified(false);

    currentPlayIndexRef.current = 0;
    passCountRef.current = 1;
    setCurrentPass(1);
    framePoolRef.current.clear();
    lastFrameTimeRef.current = performance.now();
    lastRenderSuccessTimeRef.current = performance.now();

    setTransferFile({
      fileName: selectedFiles.length > 1 ? `${selectedFiles.length} files` : selectedFiles[0].name,
      fileSize: selectedFiles.reduce((sum, item) => sum + item.size, 0),
      startTime: Date.now(),
    });

    if (walletCompat && !isPrivate) {
      if (selectedFiles.length > 1) {
        isVerifyingHandshakeRef.current = false;
        setIsVerifyingHandshake(false);
        setHandshakeError(WALLET_ONE_FILE);
        return;
      }
      tilePlanRef.current = null;
      startWalletTransfer(selectedFiles[0]);
      return;
    }

    if (!workerRef.current) {
      const worker = spawnSliceWorker();
      workerRef.current = worker;
      worker.onmessage = (e: MessageEvent<SliceWorkerOutgoingMessage | null>) => handleWorkerMessage(e.data);
    }

    // A screen too small for 3 CSS px modules keeps one code per frame.
    const canvas = canvasRef.current;
    // The speed profile of the same name (#1143) prefers a layout and sets how often a beacon comes.
    const profile = MULTI_RATE_PROFILES[PROFILE_FOR_DENSITY[density]];
    const plan = multiCode && canvas
      ? planMultiCode({ enabled: true, screen: tileScreenOf(canvas), refreshHz: 60, targetFps: fpsRef.current, layoutId: profile.layoutId })
      : null;
    tilePlanRef.current = plan;
    beaconPlanRef.current = plan && profile.beaconVersion > plan.layout.version ? { version: profile.beaconVersion, every: profile.beaconEvery } : null;
    holdRef.current = 1;
    if (plan) setTileInfo({ layout: plan.layout.id, hold: null, refreshHz: null });
    // A steered stream (#1146) starts on the density's profile and runs at that profile's pace.
    const steered = plan !== null && steer;
    profileRef.current = steered ? PROFILE_FOR_DENSITY[density] : null;
    targetFpsRef.current = steered ? profile.targetFps : null;
    setSteeredProfile(profileRef.current);

    const files = selectedFiles.length > 1 ? { files: selectedFiles } : { file: selectedFiles[0] };
    workerRef.current.postMessage({
      type: 'START',
      payload: {
        ...files,
        fps: fpsRef.current,
        density,
        private: isPrivate,
        outerCode,
        tiles: plan?.layout.id,
        beacon: beaconPlanRef.current ?? undefined,
        steer: steered,
      },
    });
  }, [selectedFiles, density, isPrivate, outerCode, multiCode, steer, walletCompat, stopTransfer, handleWorkerMessage, startWalletTransfer]);

  /** Shows the key QR for as long as the person holds the button; it never plays with the stream. */
  const showKeyQr = useCallback(() => workerRef.current?.postMessage({ type: 'KEY_QR' }), []);
  const hideKeyQr = useCallback(() => setKeyFrame(null), []);

  /** Freezes the stream on its current frame at once. Escape and the Pause button call this. */
  const pauseTransfer = useCallback(() => {
    if (!isTransferringRef.current || isPausedRef.current) return;
    isPausedRef.current = true;
    setIsPaused(true);
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }
    pacerRef.current?.stop();
    pacerRef.current = null;
    refreshBaseRef.current = lastRefreshRef.current + 1;
  }, []);

  /** Carries on from the frame where the stream was paused. */
  const resumeTransfer = useCallback(() => {
    if (!isTransferringRef.current || !isPausedRef.current) return;
    isPausedRef.current = false;
    setIsPaused(false);
    lastFrameTimeRef.current = performance.now();
    lastRenderSuccessTimeRef.current = performance.now();
    if (walletRef.current) runWalletLoop();
    else if (tilePlanRef.current) runTileLoop(tilePlanRef.current);
    else runAnimationLoop();
  }, [runAnimationLoop, runTileLoop, runWalletLoop]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      setSelectedFiles(Array.from(fileList));
      stopTransfer();
    }
    if (e.target) {
      e.target.value = '';
    }
  };

  const simulate50MBFile = () => {
    const dummyBlob = new Blob([new Uint8Array(50 * 1024 * 1024)], { type: 'application/octet-stream' });
    const dummyFile = new File([dummyBlob], 'simulation_50mb_payload.bin', { type: 'application/octet-stream' });
    setSelectedFile(dummyFile);
    stopTransfer();
  };

  // The frame pool is the transfer's own memory: one preallocated buffer that only grows when
  // every slot is live at once. Report its real size instead of an estimate.
  const transferStats: TransferStats = {
    ...transferFile,
    frameBufferMemory: formatMegabytes(isTransferring ? frameBufferBytes : 0),
  };

  return {
    selectedFile,
    selectedFiles,
    setSelectedFile,
    setSelectedFiles,
    isPrivate,
    setIsPrivate: settingSetters.setIsPrivate,
    keyFrame,
    keyCanvasRef,
    showKeyQr,
    hideKeyQr,
    isTransferring,
    isPaused,
    isVerifyingHandshake,
    settingsLocked,
    handshakeVerified,
    handshakeError,
    progress,
    currentFrameIndex,
    totalFrames,
    density,
    setDensity: settingSetters.setDensity,
    outerCode,
    setOuterCode: settingSetters.setOuterCode,
    multiCode,
    setMultiCode: settingSetters.setMultiCode,
    tileInfo,
    steer,
    setSteer: settingSetters.setSteer,
    steerState,
    steeredProfile,
    steeringReceivers,
    autoStopped,
    walletCompat,
    setWalletCompat: settingSetters.setWalletCompat,
    fps,
    setFps,
    currentPass,
    fountainInfo,
    framePoolRef,
    transferStats,
    canvasRef,
    startTransfer,
    stopTransfer,
    pauseTransfer,
    resumeTransfer,
    handleFileChange,
    simulate50MBFile,
  };
}
