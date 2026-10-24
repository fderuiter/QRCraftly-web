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

import { useState, useEffect, useRef, useCallback, type Dispatch } from 'react';
import { useQrScanner, type CameraInfo } from '@/packages/optical-scanner/client';
import type { ReceiverEvent } from './machine';
import { detachVideoSource, playQuietly } from './media';
import type { ReceiverToast } from './receiverTypes';
import type { TileCode } from './tileContracts';
import { useTileFrameLoop } from './useTileFrameLoop';
import { validateReceivedFile } from './videoFile';

/** Longest pause between camera samples while receiving a stream. */
const STREAM_MAX_SAMPLING_DELAY_MS = 150;
/** Frames per second the multi-code receiver asks the camera for, as an ideal (#1142). */
const MULTI_CODE_FRAME_RATE = 60;

export interface FrameSourceOptions {
  initialMode: 'camera' | 'file';
  /** Read several codes per camera frame (#1142). */
  multiCode: boolean;
  dispatch: Dispatch<ReceiverEvent>;
  addToast?: (toast: ReceiverToast) => void;
  /** Every code read, from the camera or the video. Read through a ref. */
  onFrame: (decodedText: string) => void;
  /** The codes of one multi-code camera frame. Read through a ref. */
  onFrameRead: (codes: readonly TileCode[]) => void;
  /** Runs on unmount after the video is released and before its object URL is revoked. Read through a ref. */
  onRelease: () => void;
}

/**
 * Where frames come from (#1514): the camera session or an uploaded video, the video's playback,
 * the object URL's lifecycle, the lock-on brackets, and restarting the camera when the multi-code
 * reader is switched. Moved from `useOpticalReceiver`.
 * @param options - The mode to start in, the reader and what to do with each frame.
 */
export function useFrameSource(options: FrameSourceOptions) {
  const { initialMode, multiCode, dispatch, addToast } = options;
  const [receiverMode, setReceiverModeState] = useState<'camera' | 'file'>(initialMode);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);
  const [fileValidationError, setFileValidationError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const { lockOn, markLockOn, tileReader } = useTileFrameLoop(videoRef, optionsRef);
  // The scanner's Camera Session owns the camera stream (#1097); frames go to onFrame.
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
      optionsRef.current.onFrame(data);
    },
    // An animated stream changes frame every ~66 ms, so sampling may never back off
    // to the single-code scanner's 1 fps floor. The worker's backpressure still bounds load.
    maxSamplingDelay: STREAM_MAX_SAMPLING_DELAY_MS,
    // Every frame of a transfer stream is a different payload with its own checksum, and a repeated
    // frame is harmless: take each decode at once instead of waiting for a second agreeing one.
    confirmations: 1,
    repeatHoldMs: 0,
    frameLoop: multiCode ? tileReader : null,
  });
  const cameraError = 'error' in cameraState ? cameraState.error : null;
  /** What the camera actually streams at, once it streams. */
  const camera: CameraInfo | null = cameraState.status === 'streaming' ? cameraState.camera : null;

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
    dispatch({ type: 'chooseMode', mode });
    setFileValidationError(null);
    if (mode === 'camera') {
      revokeVideoUrl();
      setVideoFile(null);
    }
    stopStream();
    setIsScanning(false);
    detachVideoSource(videoRef.current);
  }, [dispatch, revokeVideoUrl, stopStream]);

  const handleFileUpload = useCallback((file: File) => {
    if (!file) return false;

    const errorMsg = validateReceivedFile(file);
    if (errorMsg) {
      revokeVideoUrl();
      setVideoFile(null);
      setFileValidationError(errorMsg);
      dispatch({ type: 'fail', error: { source: 'file', message: errorMsg } });
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
    dispatch({ type: 'loadVideo' });

    addToast?.({ type: 'info', message: `Video file loaded: ${file.name}`, duration: 3000 });

    return true;
  }, [addToast, dispatch, revokeVideoUrl]);

  /** Drops the uploaded video and its error, as Clear does. */
  const clearVideo = useCallback(() => {
    setFileValidationError(null);
    revokeVideoUrl();
    setVideoFile(null);
  }, [revokeVideoUrl]);

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
      optionsRef.current.addToast?.({ type: 'success', message: 'Camera scanner activated.', duration: 3000 });
    } else if (cameraStatus === 'denied' || cameraStatus === 'unavailable' || cameraStatus === 'error') {
      setIsScanning(false);
    }
  }, [cameraStatus]);

  /** Opens the camera; the caller starts the worker first. */
  const startCameraStream = useCallback(async () => {
    setIsScanning(true);
    dispatch({ type: 'startCamera' });
    const video = videoRef.current;
    if (video?.hasAttribute('src')) video.removeAttribute('src');
    await startCamera(multiCode ? { frameRate: MULTI_CODE_FRAME_RATE } : undefined);
  }, [dispatch, startCamera, multiCode]);

  // Switching the reader while the camera streams restarts it, with the frame rate the reader wants.
  const cameraStatusRef = useRef(cameraState.status);
  useEffect(() => {
    cameraStatusRef.current = cameraState.status;
  }, [cameraState.status]);
  const appliedMultiCode = useRef(multiCode);
  useEffect(() => {
    if (appliedMultiCode.current === multiCode) return;
    appliedMultiCode.current = multiCode;
    if (cameraStatusRef.current === 'streaming') void startCamera(multiCode ? { frameRate: MULTI_CODE_FRAME_RATE } : {});
  }, [multiCode, startCamera]);

  const stopCameraSession = useCallback(() => {
    setIsScanning(false);
    dispatch({ type: 'stop' });
    stopStream();
    flushVideoHardware();
    addToast?.({ type: 'info', message: 'Camera scanner deactivated.', duration: 3000 });
  }, [dispatch, stopStream, addToast, flushVideoHardware]);

  useEffect(() => {
    return () => {
      stopAdaptiveScanning();
      stopStream();
      flushVideoHardware();
      optionsRef.current.onRelease();
      revokeVideoUrl();
    };
  }, [stopAdaptiveScanning, stopStream, flushVideoHardware, revokeVideoUrl]);

  return {
    receiverMode,
    setReceiverMode,
    videoRef,
    videoFile,
    videoObjectUrl,
    fileValidationError,
    handleFileUpload,
    clearVideo,
    isScanning,
    setIsScanning,
    cameraError,
    camera,
    lockOn,
    stopStream,
    startCameraStream,
    stopCameraSession,
  };
}
