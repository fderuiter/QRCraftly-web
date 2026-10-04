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
import { useQrScanner } from '@/packages/optical-scanner/client';
import { StreamLookaheadReceiver } from '../streamLookahead';
import type { HandshakeInfo } from '../contracts';
import { isFountainDropletString } from '../fountain/envelope';
import { FountainRateTracker, type FountainTelemetry } from '../fountain/reassembler';
import {
  assertIntegrity,
  decodeChunkText,
  findDangerousScheme,
  legacyChunkRejection,
  parseLegacyChunk,
  parseLegacyHandshake,
} from './legacyFrames';
import { MAX_VIDEO_UPLOAD_BYTES, formatLimit } from '../limits';
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
  /**
   * Require an `H|` handshake before accepting legacy `F|` chunk frames.
   * Fountain (`ur:bytes/`) streams are always accepted from any point: their
   * session header (file name, SHA-256, compression flag) travels inside the
   * fountain message and is verified before download.
   */
  handshakeRequired?: boolean;
  streamMode?: 'text' | 'binary';
  autoDownload?: boolean;
  initialMode?: 'camera' | 'file';
}

/** Messages posted by the reassembly worker. */
interface ReassemblyWorkerMessage {
  type?: 'PROGRESS' | 'COMPLETE' | 'ERROR';
  progress?: number;
  current?: number;
  total?: number;
  buffer?: ArrayBuffer;
  error?: string;
  handshake?: HandshakeInfo | null;
  isFountain?: boolean;
  /** Key of the fountain session that just completed. */
  session?: string | null;
  rank?: number;
  dropletsReceived?: number;
}

/** Longest pause between camera samples while receiving a stream. */
const STREAM_MAX_SAMPLING_DELAY_MS = 150;

const FILE_RECEIVED_MESSAGE = 'File completely received & offline binary reconstruction triggered!';

/**
 * Headless React hook to handle camera streams, video file uploads, adaptive scanning,
 * and data reassembly for the receiver.
 */
export function useOpticalReceiver({
  saveFile,
  addToast,
  handshakeRequired = true,
  streamMode = 'text',
  autoDownload = true,
  initialMode = 'camera',
}: UseOpticalReceiverOptions) {
  const [receiverMode, setReceiverModeState] = useState<'camera' | 'file'>(initialMode);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);
  const [fileValidationError, setFileValidationError] = useState<string | null>(null);

  const [chunks, setChunks] = useState<Set<number>>(new Set());
  const [totalChunks, setTotalChunks] = useState<number | null>(null);
  const [handshake, setHandshake] = useState<HandshakeInfo | null>(null);
  const [securityAlert, setSecurityAlert] = useState<string | null>(null);
  const [receiverError, setReceiverError] = useState<string | null>(null);
  const [receiverSuccess, setReceiverSuccess] = useState<boolean>(false);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [downloadTriggered, setDownloadTriggered] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [reassembledData, setReassembledData] = useState<Uint8Array | null>(null);
  const [compilationStatus, setCompilationStatus] = useState<string | null>(null);
  const [fountainStats, setFountainStats] = useState<FountainTelemetry | null>(null);
  const rateTrackerRef = useRef(new FountainRateTracker());

  const workerRef = useRef<Worker | null>(null);
  /** The last fountain session received, so a fresh worker ignores its droplets. */
  const finishedSessionRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lookaheadRef = useRef<StreamLookaheadReceiver | null>(null);
  const processedIndicesRef = useRef<Set<number>>(new Set());
  const handshakeRef = useRef<HandshakeInfo | null>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const hasShownMissingHandshakeToastRef = useRef<boolean>(false);
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

  useEffect(() => {
    lookaheadRef.current = new StreamLookaheadReceiver({ mode: streamMode });
  }, [streamMode]);

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
    onScanSuccess: (data) => handleFrameRef.current(data),
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
  const deliverFile = useCallback((data: Uint8Array, hs: HandshakeInfo | null, fallbackPrefix: string) => {
    setDownloadTriggered(true);
    saveFileRef.current(
      data,
      hs?.fileName || `${fallbackPrefix}_${Date.now()}.bin`,
      hs?.mimeType || 'application/octet-stream'
    );
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

  const handleWorkerComplete = useCallback(async (message: ReassemblyWorkerMessage) => {
    const { buffer, handshake: workerHandshake, isFountain, session } = message;
    if (session) finishedSessionRef.current = session;
    if (isFountain && workerHandshake) {
      // Stateless entry: the session header replaces the handshake frame.
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
      if (autoDownloadRef.current) {
        deliverFile(reassembled, activeHandshake, 'received_file');
      }
    } catch (err) {
      failReassembly(err);
    } finally {
      setCompilationStatus(null);
      setIsVerifying(false);
    }
  }, [stopStream, deliverFile, failReassembly]);

  const initWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = spawnReassemblyWorker();

      worker.onmessage = (e: MessageEvent<ReassemblyWorkerMessage>) => {
        const message = e.data;
        const { type, progress, current, total, isFountain, rank, dropletsReceived } = message;

        if (type === 'PROGRESS' && isFountain) {
          // A fresh fountain decode (after a failed one) clears the old error.
          setReceiverError(null);
          setFountainStats(
            rateTrackerRef.current.telemetry(
              { k: total ?? 0, rank: rank ?? 0, resolved: current ?? 0, dropletsReceived: dropletsReceived ?? 0, progress: progress ?? 0 },
              performance.now()
            )
          );
        } else if (type === 'PROGRESS') {
          setCompilationStatus(`Compiling file: ${current}/${total} chunks decoded (${progress}%)`);
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
    rateTrackerRef.current.reset();
    setChunks(new Set());
    setTotalChunks(null);
    setHandshake(null);
    handshakeRef.current = null;
    hasShownMissingHandshakeToastRef.current = false;
    setSecurityAlert(null);
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
    processedIndicesRef.current.clear();
    lookaheadRef.current = new StreamLookaheadReceiver({ mode: streamMode });
    addToast?.({ type: 'info', message: 'Receiver state has been reset.', duration: 3000 });
  }, [addToast, streamMode, terminateWorker, revokeVideoUrl]);

  const reconstructAndValidateFile = useCallback(async (
    activeChunks?: { get: (index: number) => string | undefined } | Set<number>,
    total?: number,
    activeHandshake?: HandshakeInfo
  ) => {
    try {
      setIsVerifying(true);
      setReceiverError(null);
      const data = reassembledDataRef.current || reassembledData;
      const hs = activeHandshake || handshakeRef.current;

      if (data) {
        if (hs) {
          await assertIntegrity(data, hs.sha256);
        } else if (handshakeRequired) {
          throw new Error('Transfer blocked: missing handshake metadata. Cannot verify SHA-256 integrity hash.');
        }

        setReceiverSuccess(true);
        setReceiverError(null);
        deliverFile(data, hs, 'received_file');
      } else if (activeChunks && 'get' in activeChunks && typeof activeChunks.get === 'function' && typeof total === 'number') {
        const worker = initWorker();
        const chunksToSend: Array<{ index: number; base64: string }> = [];
        for (let i = 0; i < total; i++) {
          const base64 = activeChunks.get(i);
          if (!base64) {
            setDownloadTriggered(false);
            throw new Error(`Missing frame chunk at index ${i}`);
          }
          chunksToSend.push({ index: i, base64 });
        }
        worker.postMessage({
          type: 'START_REASSEMBLY',
          chunks: chunksToSend,
          totalChunks: total,
        });
      }
    } catch (err) {
      failReassembly(err);
    } finally {
      setIsVerifying(false);
      setCompilationStatus(null);
    }
  }, [reassembledData, initWorker, handshakeRequired, deliverFile, failReassembly]);

  /** Stops scanning after a blocked frame. */
  const haltScanning = useCallback(() => {
    setIsScanning(false);
    stopStream();
  }, [stopStream]);

  const handleFrame = useCallback(async (decodedText: string) => {
    if (!decodedText || receiverSuccess || isVerifying) return;

    // Fountain droplets are always accepted, even after an error: the worker starts a
    // fresh decode, so a failed transfer recovers by simply scanning on.
    if (isFountainDropletString(decodedText)) {
      rateTrackerRef.current.record(performance.now());
      initWorker().postMessage({ type: 'FOUNTAIN_DROPLET', droplet: decodedText });
      return;
    }
    if (receiverError && !decodedText.startsWith('H|')) return;

    const chunk = parseLegacyChunk(decodedText);
    if (chunk) {
      const rejection = legacyChunkRejection(chunk);
      if (rejection) {
        setReceiverError(rejection);
        haltScanning();
        addToast?.({ type: 'error', message: rejection, duration: 5000 });
        return;
      }
      if (handshakeRequired && !handshakeRef.current) {
        setReceiverError('Handshake metadata required before processing data frames.');
        if (addToast && !hasShownMissingHandshakeToastRef.current) {
          hasShownMissingHandshakeToastRef.current = true;
          addToast({
            type: 'error',
            message: 'Transfer blocked: missing handshake metadata. Scan handshake QR first.',
            duration: 5000,
          });
        }
        return;
      }
      if (processedIndicesRef.current.has(chunk.index)) {
        return;
      }
      processedIndicesRef.current.add(chunk.index);
    }

    if (streamMode === 'text') {
      const dangerousMatch = findDangerousScheme(decodedText);
      if (dangerousMatch) {
        setSecurityAlert(`Dangerous protocol detected and blocked: ${dangerousMatch}`);
        haltScanning();
        return;
      }
    }

    try {
      if (!lookaheadRef.current) {
        lookaheadRef.current = new StreamLookaheadReceiver({ mode: streamMode });
      }
      if (decodedText.startsWith('F|')) {
        if (chunk) lookaheadRef.current.receive(decodeChunkText(chunk.base64));
      } else if (!decodedText.startsWith('H|')) {
        lookaheadRef.current.receive(decodedText);
      }
    } catch (err) {
      setSecurityAlert((err instanceof Error && err.message) || 'Dangerous protocol split across frames blocked!');
      haltScanning();
      return;
    }

    try {
      if (decodedText.startsWith('H|')) {
        const next = parseLegacyHandshake(decodedText);
        const isNewFile = !handshakeRef.current || handshakeRef.current.sha256 !== next.sha256;
        if (isNewFile) {
          processedIndicesRef.current.clear();
          hasShownMissingHandshakeToastRef.current = false;
          lookaheadRef.current = new StreamLookaheadReceiver({ mode: streamMode });
          handshakeRef.current = next;

          setChunks(new Set());
          setTotalChunks(null);
          setReceiverError(null);
          setReceiverSuccess(false);
          setDownloadTriggered(false);
          setReassembledData(null);
          reassembledDataRef.current = null;
          setCompilationStatus(null);
          setIsVerifying(false);
          setHandshake(next);

          initWorker().postMessage({ type: 'INIT', ...next });
        }
      } else if (chunk) {
        setTotalChunks(chunk.total);
        setChunks(prev => {
          if (prev.has(chunk.index)) return prev;
          const next = new Set(prev);
          next.add(chunk.index);
          return next;
        });

        initWorker().postMessage({
          type: 'CHUNK',
          index: chunk.index,
          totalChunks: chunk.total,
          base64: chunk.base64,
        });
      }
    } catch (err) {
      setReceiverError((err instanceof Error && err.message) || 'An error occurred during scan decoding.');
    }
  }, [receiverSuccess, isVerifying, handshakeRequired, haltScanning, streamMode, receiverError, addToast, initWorker]);

  useEffect(() => {
    handleFrameRef.current = (data) => {
      void handleFrame(data);
    };
  }, [handleFrame]);

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
    setSecurityAlert(null);
    processedIndicesRef.current.clear();
    hasShownMissingHandshakeToastRef.current = false;
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
    if (totalChunks !== null && chunks.size === totalChunks && !downloadTriggered) {
      revokeVideoUrl();
      if (autoDownload) {
        setDownloadTriggered(true);
        stopCameraSession();
        reconstructAndValidateFile(chunks, totalChunks, handshake || handshakeRef.current || undefined);
      } else if (isScanning) {
        stopCameraSession();
        setIsScanning(false);
        addToast?.({ type: 'success', message: 'Scan complete! Camera stream shut down.', duration: 3000 });
      }
    }
  }, [chunks, totalChunks, downloadTriggered, handshake, reconstructAndValidateFile, stopCameraSession, autoDownload, isScanning, addToast, revokeVideoUrl]);

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
    chunks,
    totalChunks,
    handshake,
    securityAlert,
    receiverError,
    receiverSuccess,
    isVerifying,
    downloadTriggered,
    isScanning,
    /** Why the camera could not be started (denied, missing, in use), or null. */
    cameraError,
    reassembledData,
    videoRef,
    lookaheadRef,
    handleClear,
    handleFrame,
    startCameraSession,
    stopCameraSession,
    reconstructAndValidateFile,
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
