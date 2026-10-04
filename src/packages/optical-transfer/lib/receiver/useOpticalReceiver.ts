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


import { useState, useEffect, useRef, useCallback } from 'react';
import { useQrScanner, type ScanCorners } from '@/packages/optical-scanner/client';
import type { BcUrDecoder, BcUrResult } from '../../bcur';
import type { HandshakeInfo } from '../contracts';
import { isFountainDropletString } from '../fountain/envelope';
import { FountainRateTracker, type FountainTelemetry } from '../fountain/reassembler';
import { sha256Hex } from '../fountain/session';
import { MAX_VIDEO_UPLOAD_BYTES, formatLimit } from '../limits';
import { looksLikePrismFrame } from '../prism/frame';
import { looksLikeKeyQr } from '../prism/words';
import type { PrismManifestInfo } from '../prism/manifest';
import { analyseReceivedFile } from '@/utils/fileNames';
import { detachVideoSource, isVideoFile, playQuietly, spawnReassemblyWorker } from './media';

type ReceiverToast = {
  type: 'success' | 'info' | 'error' | 'warning';
  message: string;
  duration?: number;
};

/** Hands a verified file to the user. Injected by the page (e.g. the app's download manager). */
export type ReceivedFileSaver = (data: Uint8Array, fileName: string, mimeType: string) => void;

export interface UseOpticalReceiverOptions {
  /** Saves a verified file. */
  saveFile: ReceivedFileSaver;
  addToast?: (toast: ReceiverToast) => void;
  autoDownload?: boolean;
  initialMode?: 'camera' | 'file';
}

/** One file of a finished bundle, held in memory until the person saves it. */
export interface ReceivedBundleFile {
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  data: Uint8Array;
}

/** One finished file as the worker posts it. */
interface WorkerFile {
  buffer: ArrayBuffer;
  handshake: HandshakeInfo;
}

/** Messages posted by the reassembly worker. */
interface ReassemblyWorkerMessage {
  type?: 'PROGRESS' | 'COMPLETE' | 'ERROR' | 'MANIFEST' | 'KEY_STATUS' | 'SWITCH_OFFER';
  progress?: number;
  current?: number;
  total?: number;
  buffer?: ArrayBuffer;
  error?: string;
  handshake?: HandshakeInfo | null;
  isFountain?: boolean;
  /** Key of the session that just completed. */
  session?: string | null;
  rank?: number;
  dropletsReceived?: number;
  /** The transfer's manifest, announced as soon as it is accepted. */
  manifest?: PrismManifestInfo;
  /** With MANIFEST: the transfer is private and still waiting for its key code. */
  needsKey?: boolean;
  /** With KEY_STATUS: whether the key code was readable. */
  accepted?: boolean;
  /** With SWITCH_OFFER: another stream in view. */
  offer?: PrismManifestInfo;
  /** With COMPLETE: the files of a bundle. */
  files?: WorkerFile[];
}

/** Longest pause between camera samples while receiving a stream. */
const STREAM_MAX_SAMPLING_DELAY_MS = 150;
/** How long the lock-on brackets stay after the last code the camera read. */
const LOCK_ON_HOLD_MS = 400;

const FILE_RECEIVED_MESSAGE = 'File completely received & offline binary reconstruction triggered!';

/**
 * Headless React hook to handle camera streams, video file uploads, adaptive scanning,
 * and data reassembly for the receiver.
 */
export function useOpticalReceiver({
  saveFile,
  addToast,
  autoDownload = true,
  initialMode = 'camera',
}: UseOpticalReceiverOptions) {
  const [receiverMode, setReceiverModeState] = useState<'camera' | 'file'>(initialMode);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);
  const [fileValidationError, setFileValidationError] = useState<string | null>(null);

  const [handshake, setHandshake] = useState<HandshakeInfo | null>(null);
  /** What the sender announced, available before any data has been decoded. */
  const [manifest, setManifest] = useState<PrismManifestInfo | null>(null);
  const [receiverError, setReceiverError] = useState<string | null>(null);
  const [receiverSuccess, setReceiverSuccess] = useState<boolean>(false);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [downloadTriggered, setDownloadTriggered] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [reassembledData, setReassembledData] = useState<Uint8Array | null>(null);
  const [compilationStatus, setCompilationStatus] = useState<string | null>(null);
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
  /** The files of a finished multi-file transfer. */
  const [bundle, setBundle] = useState<ReceivedBundleFile[] | null>(null);
  const rateTrackerRef = useRef(new FountainRateTracker());

  const workerRef = useRef<Worker | null>(null);
  /** The last session received, so a fresh worker ignores its frames. */
  const finishedSessionRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handshakeRef = useRef<HandshakeInfo | null>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const reassembledDataRef = useRef<Uint8Array | null>(null);

  const autoDownloadRef = useRef(autoDownload);
  useEffect(() => {
    autoDownloadRef.current = autoDownload;
  }, [autoDownload]);

  const addToastRef = useRef(addToast);
  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);

  const saveFileRef = useRef(saveFile);
  useEffect(() => {
    saveFileRef.current = saveFile;
  }, [saveFile]);

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

  // The scanner's Camera Session owns the camera stream (#1097); frames go to handleFrame.
  const handleFrameRef = useRef<(decodedText: string) => void>(() => {});
  const {
    state: cameraState,
    start: startCamera,
    stop: stopStream,
    startScanning: startAdaptiveScanning,
    stopScanning: stopAdaptiveScanning,
  } = useQrScanner({
    videoRef,
    onScanSuccess: (data, result) => {
      markLockOn(result?.corners ?? null);
      handleFrameRef.current(data);
    },
    // An animated stream changes frame every ~66 ms, so sampling may never back off
    // to the single-code scanner's 1 fps floor. The worker's backpressure still bounds load.
    maxSamplingDelay: STREAM_MAX_SAMPLING_DELAY_MS,
    // Every frame of a transfer stream is a different payload with its own checksum, and a repeated
    // frame is harmless: take each decode at once instead of waiting for a second agreeing one.
    confirmations: 1,
    repeatHoldMs: 0,
  });
  const cameraError = 'error' in cameraState ? cameraState.error : null;

  /** Saves a verified file under its announced name and tells the user. */
  const deliverFile = useCallback((data: Uint8Array, hs: HandshakeInfo | null) => {
    setDownloadTriggered(true);
    // The name and type are chosen by whoever is showing the stream: save the sanitised name and a
    // MIME type that agrees with it.
    const analysis = analyseReceivedFile(
      hs?.fileName || `received_file_${Date.now()}.bin`,
      hs?.mimeType || 'application/octet-stream'
    );
    saveFileRef.current(data, analysis.safeName, analysis.mimeType);
    addToastRef.current?.({ type: 'success', message: FILE_RECEIVED_MESSAGE, duration: 5000 });
  }, []);

  /** Records a failed reassembly or verification and tells the user. */
  const failReassembly = useCallback((err: unknown) => {
    const errMsg = (err instanceof Error && err.message) || 'Verification or reassembly failed.';
    setReceiverError(errMsg);
    setReceiverSuccess(false);
    setReassembledData(null);
    reassembledDataRef.current = null;
    addToastRef.current?.({ type: 'error', message: errMsg, duration: 5000 });
  }, []);

  /** Clears state after a worker-side failure. */
  const resetAfterWorkerError = useCallback((message: string) => {
    setReceiverError(message);
    setReceiverSuccess(false);
    setReassembledData(null);
    reassembledDataRef.current = null;
    setDownloadTriggered(false);
    setCompilationStatus(null);
    setIsVerifying(false);
  }, []);

  /** Checks bytes against the SHA-256 the transfer announced. */
  const assertIntegrity = useCallback(async (data: Uint8Array, expected: string) => {
    const actual = await sha256Hex(data);
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Integrity validation failed! SHA-256 hash does not match.\nExpected: ${expected}\nActual: ${actual}`);
    }
  }, []);

  const handleWorkerComplete = useCallback(async (message: ReassemblyWorkerMessage) => {
    const { buffer, handshake: workerHandshake, session, files } = message;
    if (session) finishedSessionRef.current = session;
    setNeedsKey(false);
    setSwitchOffer(null);
    if (files) {
      // Several files: each was verified against its own hash in the worker. They are saved one by
      // one or as an archive, never automatically.
      setBundle(files.map(({ buffer: data, handshake: hs }) => ({ name: hs.fileName, mimeType: hs.mimeType, size: hs.fileSize, sha256: hs.sha256, data: new Uint8Array(data) })));
      setFountainStats(prev => (prev ? { ...prev, rank: prev.k, resolved: prev.k, progress: 100, etaSeconds: 0 } : prev));
      setIsScanning(false);
      stopStream();
      setReceiverSuccess(true);
      setReceiverError(null);
      return;
    }
    if (workerHandshake) {
      handshakeRef.current = workerHandshake;
      setHandshake(workerHandshake);
      setFountainStats(prev => (prev ? { ...prev, rank: prev.k, resolved: prev.k, progress: 100, etaSeconds: 0 } : prev));
      setIsScanning(false);
      stopStream();
    }
    try {
      setCompilationStatus('Finalizing download...');
      const reassembled = new Uint8Array(buffer ?? new ArrayBuffer(0));
      reassembledDataRef.current = reassembled;
      setReassembledData(reassembled);

      const activeHandshake = workerHandshake || handshakeRef.current;
      if (activeHandshake?.sha256) {
        await assertIntegrity(reassembled, activeHandshake.sha256);
      }

      setReceiverSuccess(true);
      setReceiverError(null);
      // Risky types (executables, scripts, active documents) are never saved without the person
      // confirming on the completion panel, so auto-download skips them.
      const risky = analyseReceivedFile(activeHandshake?.fileName ?? '', activeHandshake?.mimeType ?? '').risky;
      if (autoDownloadRef.current && !risky) {
        deliverFile(reassembled, activeHandshake);
      }
    } catch (err) {
      failReassembly(err);
    } finally {
      setCompilationStatus(null);
      setIsVerifying(false);
    }
  }, [stopStream, deliverFile, failReassembly, assertIntegrity]);

  const initWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = spawnReassemblyWorker();

      worker.onmessage = (e: MessageEvent<ReassemblyWorkerMessage>) => {
        const message = e.data;
        const { type, progress, current, total, rank, dropletsReceived } = message;

        if (type === 'MANIFEST' && message.manifest) {
          setReceiverError(null);
          setManifest(message.manifest);
          setNeedsKey(Boolean(message.needsKey));
        } else if (type === 'KEY_STATUS') {
          setKeyAccepted(Boolean(message.accepted));
        } else if (type === 'SWITCH_OFFER' && message.offer) {
          setSwitchOffer(message.offer);
        } else if (type === 'PROGRESS') {
          // A fresh decode (after a failed one) clears the old error.
          setReceiverError(null);
          setFountainStats(
            rateTrackerRef.current.telemetry(
              { k: total ?? 0, rank: rank ?? 0, resolved: current ?? 0, dropletsReceived: dropletsReceived ?? 0, progress: progress ?? 0 },
              performance.now()
            )
          );
        } else if (type === 'COMPLETE') {
          void handleWorkerComplete(message);
        } else if (type === 'ERROR') {
          resetAfterWorkerError(message.error || 'Failed to compile binary content.');
        }
      };

      worker.onerror = (e) => {
        resetAfterWorkerError(e.message || 'Background worker error.');
      };

      // A camera still pointed at the stream that just finished must not receive it again.
      if (finishedSessionRef.current) worker.postMessage({ type: 'IGNORE_SESSION', session: finishedSessionRef.current });
      workerRef.current = worker;
    }
    return workerRef.current;
  }, [handleWorkerComplete, resetAfterWorkerError]);

  const terminateWorker = useCallback(() => {
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

  const flushVideoHardware = useCallback(() => {
    detachVideoSource(videoRef.current, { release: true });
  }, []);

  const revokeVideoUrl = useCallback(() => {
    if (videoObjectUrlRef.current) {
      try {
        URL.revokeObjectURL(videoObjectUrlRef.current);
      } catch {
        // Already revoked.
      }
      videoObjectUrlRef.current = null;
      setVideoObjectUrl(null);
    }
  }, []);

  const setReceiverMode = useCallback((mode: 'camera' | 'file') => {
    setReceiverModeState(mode);
    setFileValidationError(null);
    if (mode === 'camera') {
      revokeVideoUrl();
      setVideoFile(null);
    }
    stopStream();
    setIsScanning(false);
    detachVideoSource(videoRef.current);
  }, [revokeVideoUrl, stopStream]);

  const handleFileUpload = useCallback((file: File) => {
    if (!file) return false;

    if (!isVideoFile(file)) {
      revokeVideoUrl();
      setVideoFile(null);
      const errorMsg = 'Invalid file type. Please upload a supported video file (e.g. MP4, WebM).';
      setFileValidationError(errorMsg);
      addToast?.({ type: 'error', message: errorMsg, duration: 5000 });
      return false;
    }

    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      revokeVideoUrl();
      setVideoFile(null);
      const errorMsg = `This video is too large to scan. The limit is ${formatLimit(MAX_VIDEO_UPLOAD_BYTES)}.`;
      setFileValidationError(errorMsg);
      addToast?.({ type: 'error', message: errorMsg, duration: 5000 });
      return false;
    }

    setFileValidationError(null);
    revokeVideoUrl();

    const url = URL.createObjectURL(file);
    videoObjectUrlRef.current = url;
    setVideoFile(file);
    setVideoObjectUrl(url);
    setIsScanning(true);

    addToast?.({ type: 'info', message: `Video file loaded: ${file.name}`, duration: 3000 });

    return true;
  }, [addToast, revokeVideoUrl]);

  const handleClear = useCallback(() => {
    terminateWorker();
    setFountainStats(null);
    setManifest(null);
    setNeedsKey(false);
    setKeyAccepted(null);
    setSwitchOffer(null);
    setBundle(null);
    setBcur(null);
    setBcurProgress(null);
    bcurDecoderRef.current?.reset();
    rateTrackerRef.current.reset();
    setHandshake(null);
    handshakeRef.current = null;
    setReceiverError(null);
    setFileValidationError(null);
    setReceiverSuccess(false);
    setIsVerifying(false);
    setDownloadTriggered(false);
    setReassembledData(null);
    reassembledDataRef.current = null;
    setCompilationStatus(null);
    revokeVideoUrl();
    setVideoFile(null);
    addToast?.({ type: 'info', message: 'Receiver state has been reset.', duration: 3000 });
  }, [addToast, terminateWorker, revokeVideoUrl]);

  /** Saves the received file, after checking it once more against the announced SHA-256. */
  const saveReceivedFile = useCallback(async () => {
    try {
      setIsVerifying(true);
      setReceiverError(null);
      const data = reassembledDataRef.current;
      const hs = handshakeRef.current;
      if (!data || !hs) return;
      await assertIntegrity(data, hs.sha256);
      setReceiverSuccess(true);
      deliverFile(data, hs);
    } catch (err) {
      failReassembly(err);
    } finally {
      setIsVerifying(false);
      setCompilationStatus(null);
    }
  }, [assertIntegrity, deliverFile, failReassembly]);

  const handleFrame = useCallback((decodedText: string) => {
    if (!decodedText || receiverSuccess || isVerifying || bcur) return;
    // A real BC-UR stream (a wallet's animated QR) is read by its own decoder, loaded on the first
    // such code so the page does not carry it. Our own `ur:bytes` droplets look the same, so they
    // also go on to the droplet path below; whichever stream is real completes.
    if (/^ur:/i.test(decodedText)) {
      void (bcurLoadingRef.current ??= import('../../bcur').then(({ BcUrDecoder: Decoder }) => new Decoder())).then((decoder) => {
        bcurDecoderRef.current = decoder;
        const outcome = decoder.ingest(decodedText);
        if (outcome.status === 'progress') {
          setBcurProgress({ received: outcome.received, total: outcome.total });
        } else if (outcome.status === 'complete') {
          setBcur(outcome.result);
          setBcurProgress(null);
          setIsScanning(false);
          stopStream();
        } else if (outcome.status === 'failed') {
          setReceiverError(outcome.reason);
        }
      });
    }
    // Every other code the camera sees (a poster, a URL) is not part of a transfer.
    if (!isFountainDropletString(decodedText) && !looksLikePrismFrame(decodedText) && !looksLikeKeyQr(decodedText)) return;
    // Frames are always accepted, even after an error: the worker starts a fresh decode, so a
    // failed transfer recovers by simply scanning on.
    rateTrackerRef.current.record(performance.now());
    initWorker().postMessage({ type: 'FOUNTAIN_DROPLET', droplet: decodedText });
  }, [receiverSuccess, isVerifying, bcur, initWorker, stopStream]);

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
      rateTrackerRef.current.reset();
    }
  }, [switchOffer, initWorker]);

  useEffect(() => {
    // Camera mode is started by startCameraSession: the session attaches the stream and runs the
    // frame loop itself. This effect plays a loaded video file and stops whatever ran before.
    const video = videoRef.current;
    if (isScanning && receiverMode === 'file' && videoObjectUrl && video) {
      video.srcObject = null;
      if (video.src !== videoObjectUrl) {
        video.src = videoObjectUrl;
      }
      video.loop = true;
      playQuietly(video);
      startAdaptiveScanning();
    } else if (!isScanning) {
      stopStream();
      stopAdaptiveScanning();
      flushVideoHardware();
    }
  }, [isScanning, receiverMode, videoObjectUrl, stopStream, startAdaptiveScanning, stopAdaptiveScanning, flushVideoHardware]);

  // Report the camera session's outcome: a toast once it streams, back to idle when it fails.
  const cameraStatus = cameraState.status;
  useEffect(() => {
    if (cameraStatus === 'streaming') {
      addToastRef.current?.({ type: 'success', message: 'Camera scanner activated.', duration: 3000 });
    } else if (cameraStatus === 'denied' || cameraStatus === 'unavailable' || cameraStatus === 'error') {
      setIsScanning(false);
    }
  }, [cameraStatus]);

  const startCameraSession = useCallback(async () => {
    initWorker();
    setIsScanning(true);
    const video = videoRef.current;
    if (video?.hasAttribute('src')) video.removeAttribute('src');
    await startCamera();
  }, [startCamera, initWorker]);

  const stopCameraSession = useCallback(() => {
    setIsScanning(false);
    stopStream();
    flushVideoHardware();
    addToast?.({ type: 'info', message: 'Camera scanner deactivated.', duration: 3000 });
  }, [stopStream, addToast, flushVideoHardware]);

  useEffect(() => {
    return () => {
      stopAdaptiveScanning();
      stopStream();
      flushVideoHardware();
      terminateWorker();
      revokeVideoUrl();
    };
  }, [stopAdaptiveScanning, stopStream, terminateWorker, flushVideoHardware, revokeVideoUrl]);

  return {
    handshake,
    manifest,
    needsKey,
    keyAccepted,
    submitKeyCode,
    switchOffer,
    answerSwitch,
    bundle,
    receiverError,
    receiverSuccess,
    isVerifying,
    downloadTriggered,
    isScanning,
    /** Why the camera could not be started (denied, missing, in use), or null. */
    cameraError,
    /** Corners of the code the camera read a moment ago (for the lock-on brackets), or null. */
    lockOn,
    /** A finished real BC-UR stream (type and content), or null. */
    bcur,
    /** Fragments seen of the BC-UR stream being read, or null. */
    bcurProgress,
    reassembledData,
    videoRef,
    handleClear,
    handleFrame,
    startCameraSession,
    stopCameraSession,
    saveReceivedFile,
    compilationStatus,
    fountainStats,
    receiverMode,
    setReceiverMode,
    videoFile,
    videoObjectUrl,
    fileValidationError,
    handleFileUpload,
  };
}
