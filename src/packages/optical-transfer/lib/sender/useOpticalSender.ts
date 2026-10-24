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
import { useState, useEffect, useCallback, useReducer, useRef } from 'react';
import { verifyHandshakeFrame } from '../handshake';
import type { TransferStats } from '../contracts';
import { INITIAL_SENDER_STATE, senderReducer } from './machine';
import { useSenderRefs } from './senderRefs';
import type { TransferFrame, UseOpticalSenderOptions } from './senderTypes';
import { useFrameLoop } from './useFrameLoop';
import { planStream, useSenderSettings } from './useSenderSettings';
import { useSliceWorker } from './useSliceWorker';
import { useSteering } from './useSteering';
import { formatMegabytes } from './workers';
import { openWalletStream } from './walletStream';

/** Shown when wallet-compatible mode is asked to send several files. */
const WALLET_ONE_FILE = 'Wallet-compatible mode sends one file at a time. Pick a single file, or turn the mode off.';

const HANDSHAKE_FAILURE_SUFFIX = 'failed scannability check. Transfer playback remains paused. Try the Reliable density.';

/**
 * Headless React hook to coordinate asynchronous file slicing, animation playback,
 * flow-control feedback, and pre-allocated frame memory pooling for the sender.
 * It composes the slice worker, the frame loops, steering and the settings (#1511) with the phase reducer.
 */
export function useOpticalSender({
  renderFrame,
  verifyFrame = verifyHandshakeFrame,
  requestWebcam,
}: UseOpticalSenderOptions) {
  const [{ phase }, dispatch] = useReducer(senderReducer, INITIAL_SENDER_STATE);
  const [selectedFiles, setSelectedFilesState] = useState<File[]>([]);
  const setSelectedFiles = useCallback((files: File[]) => {
    setSelectedFilesState(files);
    dispatch({ type: files.length > 0 ? 'select' : 'clear' });
  }, []);
  const selectedFile = selectedFiles[0] ?? null;
  const setSelectedFile = useCallback((file: File | null) => setSelectedFiles(file ? [file] : []), [setSelectedFiles]);
  // The flags below are read from the phase, so they cannot disagree.
  const isTransferring = phase === 'transmitting' || phase === 'paused';
  /** True while a running stream is paused: the last frame stays on screen and nothing animates (#1148). */
  const isPaused = phase === 'paused';
  const isVerifyingHandshake = phase === 'verifying';
  /** True when the sender stopped because every receiver it could see had the file. */
  const autoStopped = phase === 'autoStopped';
  const [handshakeError, setHandshakeError] = useState<string | null>(null);
  const [handshakeVerified, setHandshakeVerified] = useState(false);
  const [transferFile, setTransferFile] = useState({ fileName: '', fileSize: 0, startTime: 0 });

  const refs = useSenderRefs(renderFrame, verifyFrame);
  const { canvasRef, framePoolRef, passCountRef, isTransferringRef, isPausedRef, isVerifyingHandshakeRef, settingsLockedRef } = refs;
  const settingsLocked = isTransferring || isVerifyingHandshake;
  const settings = useSenderSettings(settingsLocked, settingsLockedRef);
  const { isPrivate, density, outerCode, multiCode, steer, walletCompat, fps } = settings;
  const loop = useFrameLoop(refs);
  const { runTileLoop, play, playWallet, freeze, setTileInfo, setCurrentPass, resetPlayback } = loop;
  const { progress, currentFrameIndex, currentPass, tileInfo } = loop;

  useEffect(() => {
    refs.renderFrameRef.current = renderFrame;
    refs.verifyFrameRef.current = verifyFrame;
    isTransferringRef.current = isTransferring;
    isVerifyingHandshakeRef.current = isVerifyingHandshake;
    refs.fpsRef.current = fps;
  }, [refs, renderFrame, verifyFrame, isTransferring, isVerifyingHandshake, fps, isTransferringRef, isVerifyingHandshakeRef]);

  // Set below; the steering's auto-stop and the worker's error both end the stream through it.
  const teardownBox = useRef<() => void>(() => {});
  const autoStop = useCallback(() => {
    teardownBox.current();
    dispatch({ type: 'autoStop' });
  }, [teardownBox]);
  const steering = useSteering(refs, { requestWebcam, onAllDone: autoStop, runTileLoop, setTileInfo });
  const { setSteeredProfile, resetSteering } = steering;

  /** Runs the scannability gate on the first frame, then starts or refuses playback. */
  const gateFirstFrame = async (frame: TransferFrame) => {
    isVerifyingHandshakeRef.current = false;
    // The first frame is checked as it will be shown. Tiles are painted by the sender itself, so they skip the check.
    const isScannable = refs.tilePlanRef.current ? true : await refs.verifyFrameRef.current(frame);

    if (isScannable) {
      setHandshakeVerified(true);
      setHandshakeError(null);
      dispatch({ type: 'handshakeOk' });
      isTransferringRef.current = true;
      play();
      return;
    }
    setHandshakeVerified(false);
    setHandshakeError(`Transfer QR frame ${HANDSHAKE_FAILURE_SUFFIX}`);
    dispatch({ type: 'handshakeFailed' });
    isTransferringRef.current = false;
    worker.terminate();
  };

  const worker = useSliceWorker(refs, {
    onSteerable: steering.startSteering,
    onSwitched: steering.finishSwitch,
    onFirstFrame: (frame) => void gateFirstFrame(frame),
    onError: (message) => {
      teardownBox.current();
      setHandshakeError(message);
      dispatch({ type: 'error' });
    },
  });
  const { setKeyFrame, setTotalFrames, setFountainInfo, ensureWorker, post, stop: stopWorker } = worker;

  /** Ends whatever plays or starts and resets the stream; the caller says why with its own event. */
  const teardown = useCallback(() => {
    isTransferringRef.current = false;
    isPausedRef.current = false;
    isVerifyingHandshakeRef.current = false;
    settingsLockedRef.current = false;
    setHandshakeError(null);
    setHandshakeVerified(false);
    setKeyFrame(null);
    refs.walletRef.current = null;
    refs.walletRunRef.current += 1;
    resetSteering();
    stopWorker();
    resetPlayback();
  }, [refs, isTransferringRef, isPausedRef, isVerifyingHandshakeRef, settingsLockedRef, setKeyFrame, resetSteering, stopWorker, resetPlayback]);
  useEffect(() => {
    teardownBox.current = teardown;
  }, [teardownBox, teardown]);

  const stopTransfer = useCallback(() => {
    teardown();
    dispatch({ type: 'stop' });
  }, [teardown]);

  /**
   * Opens and checks a wallet-compatible stream, then plays it. Only one file, sent as plain
   * `ur:bytes`: no name, type, compression or key, which BC-UR has no place for.
   * @param file The file to send.
   */
  const startWalletTransfer = useCallback((file: File) => {
    const run = refs.walletRunRef.current;
    const fail = (message: string) => {
      if (run !== refs.walletRunRef.current) return;
      isVerifyingHandshakeRef.current = false;
      dispatch({ type: 'handshakeFailed' });
      setHandshakeError(message);
    };
    file
      .arrayBuffer()
      .then((buffer) => openWalletStream(new Uint8Array(buffer), density))
      .then(async (wallet) => {
        if (run !== refs.walletRunRef.current) return;
        const first = wallet.nextFrame();
        const isScannable = await refs.verifyFrameRef.current(first);
        if (run !== refs.walletRunRef.current) return;
        if (!isScannable) {
          fail(`Transfer QR frame ${HANDSHAKE_FAILURE_SUFFIX}`);
          return;
        }
        refs.totalFramesRef.current = wallet.fragmentCount;
        setTotalFrames(wallet.fragmentCount);
        setFountainInfo(null);
        isVerifyingHandshakeRef.current = false;
        setHandshakeVerified(true);
        dispatch({ type: 'handshakeOk' });
        isTransferringRef.current = true;
        playWallet(wallet, first);
      })
      .catch((error: unknown) => fail(error instanceof Error ? error.message : 'Could not start the wallet-compatible stream.'));
  }, [refs, density, playWallet, isVerifyingHandshakeRef, isTransferringRef, setTotalFrames, setFountainInfo]);

  const startTransfer = useCallback(() => {
    if (selectedFiles.length === 0) return;

    stopTransfer();
    // From the motion confirm this is the confirmed start; from anywhere else, a plain one.
    dispatch({ type: 'confirmMotion' });
    dispatch({ type: 'start', reducedMotion: false });

    isVerifyingHandshakeRef.current = true;
    settingsLockedRef.current = true;
    setHandshakeError(null);
    setHandshakeVerified(false);

    refs.currentPlayIndexRef.current = 0;
    passCountRef.current = 1;
    setCurrentPass(1);
    framePoolRef.current.clear();
    refs.lastFrameTimeRef.current = performance.now();
    refs.lastRenderSuccessTimeRef.current = performance.now();

    setTransferFile({
      fileName: selectedFiles.length > 1 ? `${selectedFiles.length} files` : selectedFiles[0].name,
      fileSize: selectedFiles.reduce((sum, item) => sum + item.size, 0),
      startTime: Date.now(),
    });

    if (walletCompat && !isPrivate) {
      if (selectedFiles.length > 1) {
        isVerifyingHandshakeRef.current = false;
        dispatch({ type: 'handshakeFailed' });
        setHandshakeError(WALLET_ONE_FILE);
        return;
      }
      refs.tilePlanRef.current = null;
      startWalletTransfer(selectedFiles[0]);
      return;
    }

    ensureWorker();

    const { plan, beacon, profile, targetFps } = planStream(canvasRef.current, { multiCode, steer, density, fps: refs.fpsRef.current });
    refs.tilePlanRef.current = plan;
    refs.beaconPlanRef.current = beacon;
    refs.holdRef.current = 1;
    if (plan) setTileInfo({ layout: plan.layout.id, hold: null, refreshHz: null });
    refs.profileRef.current = profile;
    refs.targetFpsRef.current = targetFps;
    setSteeredProfile(profile);

    const files = selectedFiles.length > 1 ? { files: selectedFiles } : { file: selectedFiles[0] };
    post({
      type: 'START',
      payload: {
        ...files,
        fps: refs.fpsRef.current,
        density,
        private: isPrivate,
        outerCode,
        tiles: plan?.layout.id,
        beacon: refs.beaconPlanRef.current ?? undefined,
        steer: profile !== null,
      },
    });
  }, [refs, selectedFiles, density, isPrivate, outerCode, multiCode, steer, walletCompat, stopTransfer, startWalletTransfer, ensureWorker, post, canvasRef, framePoolRef, passCountRef, isVerifyingHandshakeRef, settingsLockedRef, setCurrentPass, setTileInfo, setSteeredProfile]);

  /** Under reduced motion, asks once more before the stream flashes; the confirmed start is `startTransfer`. */
  const askToStart = useCallback(() => dispatch({ type: 'start', reducedMotion: true }), []);
  const cancelMotion = useCallback(() => dispatch({ type: 'cancelMotion' }), []);

  /** Shows the key QR for as long as the person holds the button; it never plays with the stream. */
  const showKeyQr = useCallback(() => post({ type: 'KEY_QR' }), [post]);
  const hideKeyQr = useCallback(() => setKeyFrame(null), [setKeyFrame]);

  /** Freezes the stream on its current frame at once. Escape and the Pause button call this. */
  const pauseTransfer = useCallback(() => {
    if (!isTransferringRef.current || isPausedRef.current) return;
    isPausedRef.current = true;
    dispatch({ type: 'pause' });
    freeze();
  }, [isTransferringRef, isPausedRef, freeze]);

  /** Carries on from the frame where the stream was paused. */
  const resumeTransfer = useCallback(() => {
    if (!isTransferringRef.current || !isPausedRef.current) return;
    isPausedRef.current = false;
    dispatch({ type: 'resume' });
    refs.lastFrameTimeRef.current = performance.now();
    refs.lastRenderSuccessTimeRef.current = performance.now();
    play();
  }, [refs, isTransferringRef, isPausedRef, play]);

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
    frameBufferMemory: formatMegabytes(isTransferring ? worker.frameBufferBytes : 0),
  };

  // The same shape as before the split; `settings` holds the six switches, the frame rate and their setters.
  return {
    ...settings,
    selectedFile, selectedFiles, setSelectedFile, setSelectedFiles,
    keyFrame: worker.keyFrame, keyCanvasRef: worker.keyCanvasRef, showKeyQr, hideKeyQr,
    phase, isTransferring, isPaused, isVerifyingHandshake, settingsLocked, handshakeVerified, handshakeError, autoStopped,
    progress, currentFrameIndex, currentPass, tileInfo,
    totalFrames: worker.totalFrames, fountainInfo: worker.fountainInfo,
    steerState: steering.steerState, steeredProfile: steering.steeredProfile, steeringReceivers: steering.steeringReceivers,
    framePoolRef, transferStats, canvasRef,
    startTransfer, askToStart, cancelMotion, stopTransfer, pauseTransfer, resumeTransfer, handleFileChange, simulate50MBFile,
  };
}
