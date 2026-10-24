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


import { useState, useEffect, useRef, useCallback, useReducer } from 'react';
import type { BcUrDecoder, BcUrResult } from '../../bcur';
import type { FountainTelemetry } from '../fountain/reassembler';
import { looksLikePrismFrame } from '../prism/frame';
import { looksLikeKeyQr } from '../prism/words';
import type { PrismManifestInfo } from '../prism/manifest';
import { fountainStatsFrom } from '../progress';
import { describeCameraError } from '../camera';
import { initialReceiverState, receiverReducer, type ReceiverFailure } from './machine';
import type { UseOpticalReceiverOptions } from './receiverTypes';
import { useDelivery } from './useDelivery';
import { useFrameSource } from './useFrameSource';
import { useReassemblyWorker } from './useReassemblyWorker';
import { useReceiverTelemetry } from './useReceiverTelemetry';

/** Shown once when a wallet-style stream claims more than this receiver takes. */
const BCUR_TOO_LARGE = 'A wallet-style stream is in view, but it is too large for this receiver, so it is ignored.';

/**
 * Headless React hook to handle camera streams, video file uploads, adaptive scanning,
 * and data reassembly for the receiver. Composes the frame source, the reassembly worker,
 * delivery and telemetry (#1514) over the phase reducer (#1513).
 */
export function useOpticalReceiver({
  saveFile,
  addToast,
  autoDownload = true,
  initialMode = 'camera',
}: UseOpticalReceiverOptions) {
  /** Where the receive stands, as one value (#1513). The flags below stay as they were for now. */
  const [receiverState, dispatch] = useReducer(receiverReducer, initialMode, initialReceiverState);
  /** What the sender announced, available before any data has been decoded. */
  const [manifest, setManifest] = useState<PrismManifestInfo | null>(null);
  const [receiverError, setReceiverError] = useState<string | null>(null);
  const [fountainStats, setFountainStats] = useState<FountainTelemetry | null>(null);
  // A stream in the real BC-UR format (what wallets show), read next to our own (#1149).
  const [bcur, setBcur] = useState<BcUrResult | null>(null);
  const [bcurProgress, setBcurProgress] = useState<{ received: number; total: number } | null>(null);
  const bcurDecoderRef = useRef<BcUrDecoder | null>(null);
  const bcurLoadingRef = useRef<Promise<BcUrDecoder> | null>(null);
  /** True while a private transfer is in view and no key code has opened it. */
  const [needsKey, setNeedsKey] = useState(false);
  /** Whether the last key code was readable: null before one was entered. */
  const [keyAccepted, setKeyAccepted] = useState<boolean | null>(null);
  /** Another stream the receiver offers to switch to. */
  const [switchOffer, setSwitchOffer] = useState<PrismManifestInfo | null>(null);
  /** Whether the person was told a wallet-style stream is over the limits, so it is said once (#1302). */
  const reportedBcurTooLargeRef = useRef(false);
  /** Read several codes per camera frame (#1142), chosen under Advanced. Off by default. */
  const [multiCode, setMultiCode] = useState(false);

  const handleFrameRef = useRef<(decodedText: string) => void>(() => {});
  /** Ends the worker on unmount, between releasing the video and revoking its URL. Set below. */
  const releaseBox = useRef<() => void>(() => {});
  const recordFrameReadBox = useRef<Parameters<typeof useFrameSource>[0]['onFrameRead']>(() => {});
  const source = useFrameSource({
    initialMode,
    multiCode,
    dispatch,
    addToast,
    onFrame: (text) => handleFrameRef.current(text),
    onFrameRead: (codes) => recordFrameReadBox.current(codes),
    onRelease: () => releaseBox.current(),
  });
  const { isScanning, setIsScanning, stopStream, cameraError } = source;

  const worker = useReassemblyWorker({
    onManifest: (announced, locked) => {
      telemetry.noteManifest();
      setReceiverError(null);
      setManifest(announced);
      setNeedsKey(locked);
      dispatch({ type: 'manifest', needsKey: locked });
      // A transfer that still waits for its key has not been opened by any earlier code (#1303).
      if (locked) setKeyAccepted(null);
    },
    onKeyStatus: (accepted) => {
      setKeyAccepted(accepted);
      dispatch({ type: 'keyStatus', accepted });
    },
    onSwitchOffer: setSwitchOffer,
    onProgress: ({ progress, current, total, rank, dropletsReceived }) => {
      const stats = { k: total ?? 0, rank: rank ?? 0, resolved: current ?? 0, dropletsReceived: dropletsReceived ?? 0, progress: progress ?? 0 };
      const next = telemetry.noteProgress(stats);
      // A fresh decode (after a failed one) clears the old error.
      dispatch({ type: 'progress' });
      setReceiverError(null);
      setFountainStats(next);
    },
    onComplete: (message) => {
      setNeedsKey(false);
      setSwitchOffer(null);
      void delivery.handleWorkerComplete(message);
    },
    onError: (message) => delivery.resetAfterWorkerError(message),
  });
  const { initWorker, terminateWorker, prismActive } = worker;

  const delivery = useDelivery({
    dispatch,
    saveFile,
    addToast,
    autoDownload,
    setReceiverError,
    currentRun: worker.currentRun,
    onStreamDone: () => {
      setFountainStats(fountainStatsFrom);
      setIsScanning(false);
      stopStream();
    },
  });
  const { receiverSuccess, isVerifying, reset: resetDelivery } = delivery;

  const telemetry = useReceiverTelemetry({ multiCode, isScanning, receiverSuccess, sessionId: manifest?.sessionId ?? null, fountainStats });
  const { recordFrameRead, reset: resetTelemetry, recordDroplet, resetRate } = telemetry;
  const { clearVideo, startCameraStream } = source;
  useEffect(() => {
    releaseBox.current = terminateWorker;
    recordFrameReadBox.current = recordFrameRead;
  }, [terminateWorker, recordFrameRead]);

  const handleClear = useCallback(() => {
    terminateWorker();
    dispatch({ type: 'clear' });
    resetTelemetry();
    setFountainStats(null);
    setManifest(null);
    setNeedsKey(false);
    setKeyAccepted(null);
    setSwitchOffer(null);
    setBcur(null);
    setBcurProgress(null);
    bcurDecoderRef.current?.reset();
    reportedBcurTooLargeRef.current = false;
    setReceiverError(null);
    resetDelivery();
    clearVideo();
    addToast?.({ type: 'info', message: 'Receiver state has been reset.', duration: 3000 });
  }, [addToast, terminateWorker, resetTelemetry, resetDelivery, clearVideo]);

  const handleFrame = useCallback((decodedText: string) => {
    if (!decodedText || receiverSuccess || isVerifying || bcur) return;
    // A BC-UR stream (a wallet's animated QR, or our sender's wallet-compatible mode) is read by its
    // own decoder, loaded on the first such code so the page does not carry it.
    if (/^ur:/i.test(decodedText)) {
      void (bcurLoadingRef.current ??= import('../../bcur').then(({ BcUrDecoder: Decoder }) => new Decoder())).then((decoder) => {
        bcurDecoderRef.current = decoder;
        // A Prism transfer in progress is not ended by a wallet code that happens to be in view (#1300).
        if (prismActive()) return;
        const outcome = decoder.ingest(decodedText);
        if (outcome.status === 'progress') {
          setBcurProgress({ received: outcome.received, total: outcome.total });
        } else if (outcome.status === 'rejected' && outcome.reason === 'too-large') {
          if (reportedBcurTooLargeRef.current) return;
          reportedBcurTooLargeRef.current = true;
          dispatch({ type: 'fail', error: { source: 'receiver', message: BCUR_TOO_LARGE } });
          setReceiverError(BCUR_TOO_LARGE);
        } else if (outcome.status === 'complete') {
          // Stop any Prism decode an earlier frame started, and drop its error.
          terminateWorker();
          setReceiverError(null);
          setBcur(outcome.result);
          dispatch({ type: 'complete', result: { kind: 'bcur', result: outcome.result } });
          setBcurProgress(null);
          setIsScanning(false);
          stopStream();
        } else if (outcome.status === 'failed') {
          dispatch({ type: 'fail', error: { source: 'receiver', message: outcome.reason } });
          setReceiverError(outcome.reason);
        }
      });
      return;
    }
    // Every other code the camera sees (a poster, a URL) is not part of a transfer.
    if (!looksLikePrismFrame(decodedText) && !looksLikeKeyQr(decodedText)) return;
    // Frames are always accepted, even after an error: the worker starts a fresh decode, so a
    // failed transfer recovers by simply scanning on.
    recordDroplet();
    initWorker().postMessage({ type: 'FOUNTAIN_DROPLET', droplet: decodedText });
  }, [receiverSuccess, isVerifying, bcur, initWorker, stopStream, terminateWorker, setIsScanning, prismActive, recordDroplet]);

  useEffect(() => {
    handleFrameRef.current = handleFrame;
  }, [handleFrame]);

  /** Gives the worker the key code a person typed. The result arrives as `keyAccepted`. */
  const submitKeyCode = useCallback((code: string) => {
    setKeyAccepted(null);
    initWorker().postMessage({ type: 'SET_KEY', code });
  }, [initWorker]);

  /** Answers the offer to switch to another stream. */
  const answerSwitch = useCallback((accept: boolean) => {
    const offer = switchOffer;
    if (!offer) return;
    setSwitchOffer(null);
    initWorker().postMessage({ type: 'SWITCH_DECISION', session: offer.sessionId, accept });
    if (accept) {
      setManifest(offer);
      setFountainStats(null);
      resetRate();
    }
  }, [switchOffer, initWorker, resetRate]);

  useEffect(() => {
    if (cameraError) dispatch({ type: 'fail', error: { source: 'camera', message: describeCameraError(cameraError) } });
  }, [cameraError]);

  const startCameraSession = useCallback(async () => {
    initWorker();
    await startCameraStream();
  }, [initWorker, startCameraStream]);

  const { phase } = receiverState;
  const result = receiverState.phase === 'complete' ? receiverState.result : null;
  const failure: ReceiverFailure | null = receiverState.phase === 'failed' ? receiverState.error : null;

  return {
    /** Where the receive stands (#1513). */
    phase,
    /** What a finished receive holds, while `phase` is 'complete'. */
    result,
    /** Why the receive failed and which part failed, while `phase` is 'failed'. */
    failure,
    handshake: delivery.handshake,
    manifest,
    needsKey,
    keyAccepted,
    submitKeyCode,
    switchOffer,
    answerSwitch,
    bundle: delivery.bundle,
    receiverError,
    receiverSuccess,
    isVerifying,
    downloadTriggered: delivery.downloadTriggered,
    isScanning,
    /** Why the camera could not be started (denied, missing, in use), or null. */
    cameraError,
    /** The streaming camera's size and frame rate, or null. */
    camera: source.camera,
    /** Whether several codes are read per camera frame (#1142). */
    multiCode,
    setMultiCode,
    /** Which layer of a multi-rate stream the camera reads, or that progress stalled (#1143); null when all is well. */
    layerHint: telemetry.layerHint,
    /** Show a feedback code so the sender's webcam can steer its speed and stop (#1146). */
    steerSender: telemetry.steerSender,
    setSteerSender: telemetry.setSteerSender,
    /** True while the feedback code is shown: the page puts `feedbackCanvasRef` in a corner. */
    feedbackActive: telemetry.feedbackActive,
    feedbackCanvasRef: telemetry.feedbackCanvasRef,
    /** Corners of the code the camera read a moment ago (for the lock-on brackets), or null. */
    lockOn: source.lockOn,
    /** A finished real BC-UR stream (type and content), or null. */
    bcur,
    /** Fragments seen of the BC-UR stream being read, or null. */
    bcurProgress,
    reassembledData: delivery.reassembledData,
    videoRef: source.videoRef,
    handleClear,
    handleFrame,
    startCameraSession,
    stopCameraSession: source.stopCameraSession,
    saveReceivedFile: delivery.saveReceivedFile,
    compilationStatus: delivery.compilationStatus,
    fountainStats,
    receiverMode: source.receiverMode,
    setReceiverMode: source.setReceiverMode,
    videoFile: source.videoFile,
    videoObjectUrl: source.videoObjectUrl,
    fileValidationError: source.fileValidationError,
    handleFileUpload: source.handleFileUpload,
  };
}
