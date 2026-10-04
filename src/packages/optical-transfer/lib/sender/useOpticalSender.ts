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
import { useState, useEffect, useRef, useCallback } from 'react';
import { QRConfig } from '@/types';
import { PreallocatedFramePool } from '../framePool';
import { sanitizeStreamConfig, verifyHandshakeFrame, type HandshakeFrameVerifier } from '../handshake';
import type { SliceWorkerOutgoingMessage, TransferStats } from '../contracts';
import { DEFAULT_TRANSFER_DENSITY, type TransferCompression, type TransferDensity } from '../fountain/session';
import { formatMegabytes, spawnSliceWorker } from './workers';

/** One QR module matrix produced by the slice worker. */
export interface TransferFrame {
  size: number;
  data: Uint8Array;
}

/**
 * Paints one frame onto the transfer canvas. Injected by the page so the package does not depend
 * on the app's template and export renderers.
 */
export type TransferFrameRenderer = (
  canvas: HTMLCanvasElement,
  frame: TransferFrame,
  config: QRConfig,
  logoImg: HTMLImageElement | null,
  borderLogoImg: HTMLImageElement | null
) => void;

export interface UseOpticalSenderOptions {
  config: QRConfig;
  logoImg: HTMLImageElement | null;
  borderLogoImg: HTMLImageElement | null;
  /** Paints each frame onto `canvasRef`. */
  renderFrame: TransferFrameRenderer;
  /** Scannability gate run on the first frame before playback. Defaults to `verifyHandshakeFrame`. */
  verifyFrame?: HandshakeFrameVerifier;
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
  /** Short form of the session ID, shown on both screens so the two can be compared. */
  fingerprint: string;
}

const HANDSHAKE_FAILURE_SUFFIX =
  'failed scannability check. Transfer playback remains paused. Please increase contrast or reduce visual complexity.';

/**
 * Headless React hook to coordinate asynchronous file slicing, animation playback,
 * flow-control feedback, and pre-allocated frame memory pooling for the sender.
 */
export function useOpticalSender({
  config,
  logoImg,
  borderLogoImg,
  renderFrame,
  verifyFrame = verifyHandshakeFrame,
}: UseOpticalSenderOptions) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  /** True while a running stream is paused: the last frame stays on screen and nothing animates (#1148). */
  const [isPaused, setIsPaused] = useState(false);
  const [isVerifyingHandshake, setIsVerifyingHandshake] = useState(false);
  const [handshakeError, setHandshakeError] = useState<string | null>(null);
  const [handshakeVerified, setHandshakeVerified] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [density, setDensity] = useState<TransferDensity>(DEFAULT_TRANSFER_DENSITY);
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
  const workerRef = useRef<Worker | null>(null);
  const framePoolRef = useRef<PreallocatedFramePool>(new PreallocatedFramePool(64));
  const passCountRef = useRef<number>(1);

  // Refs for background loop
  const configRef = useRef(config);
  const logoImgRef = useRef(logoImg);
  const borderLogoImgRef = useRef(borderLogoImg);
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

  useEffect(() => {
    configRef.current = config;
    logoImgRef.current = logoImg;
    borderLogoImgRef.current = borderLogoImg;
    renderFrameRef.current = renderFrame;
    verifyFrameRef.current = verifyFrame;
    isTransferringRef.current = isTransferring;
    isVerifyingHandshakeRef.current = isVerifyingHandshake;
    fpsRef.current = fps;
    totalFramesRef.current = totalFrames;
  }, [config, logoImg, borderLogoImg, renderFrame, verifyFrame, isTransferring, isVerifyingHandshake, fps, totalFrames]);

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
    };
  }, []);

  /** Paints a frame. Transfer frames are always sanitized: no logo, no decoration that could cost a read. */
  const paint = useCallback((frame: TransferFrame) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderFrameRef.current(canvas, frame, sanitizeStreamConfig(configRef.current), null, null);
  }, []);

  const stopTransfer = useCallback(() => {
    setIsTransferring(false);
    isTransferringRef.current = false;
    setIsPaused(false);
    isPausedRef.current = false;
    setIsVerifyingHandshake(false);
    isVerifyingHandshakeRef.current = false;
    setHandshakeError(null);
    setHandshakeVerified(false);
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'STOP' });
    }
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }
    framePoolRef.current.clear();
    passCountRef.current = 1;
    setCurrentPass(1);
    currentPlayIndexRef.current = 0;
    setCurrentFrameIndex(0);
    setProgress(0);
  }, []);

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

  /** Runs the scannability gate on the first frame, then starts or refuses playback. */
  const gateFirstFrame = useCallback(async (frame: TransferFrame) => {
    isVerifyingHandshakeRef.current = false;

    // The first frame is checked as it will be shown: sanitized, without a logo.
    const isScannable = await verifyFrameRef.current(frame, sanitizeStreamConfig(configRef.current), null, null);

    setIsVerifyingHandshake(false);

    if (isScannable) {
      setHandshakeVerified(true);
      setHandshakeError(null);
      setIsTransferring(true);
      isTransferringRef.current = true;
      runAnimationLoop();
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
  }, [runAnimationLoop]);

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
        });
        break;
      }

      case 'FRAME': {
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
    if (!selectedFile) return;

    stopTransfer();

    setIsVerifyingHandshake(true);
    isVerifyingHandshakeRef.current = true;
    setHandshakeError(null);
    setHandshakeVerified(false);

    currentPlayIndexRef.current = 0;
    passCountRef.current = 1;
    setCurrentPass(1);
    framePoolRef.current.clear();
    lastFrameTimeRef.current = performance.now();
    lastRenderSuccessTimeRef.current = performance.now();

    setTransferFile({
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      startTime: Date.now(),
    });

    if (!workerRef.current) {
      const worker = spawnSliceWorker();
      workerRef.current = worker;
      worker.onmessage = (e: MessageEvent<SliceWorkerOutgoingMessage | null>) => handleWorkerMessage(e.data);
    }

    workerRef.current.postMessage({ type: 'START', payload: { file: selectedFile, fps: fpsRef.current, density } });
  }, [selectedFile, density, stopTransfer, handleWorkerMessage]);

  /** Freezes the stream on its current frame at once. Escape and the Pause button call this. */
  const pauseTransfer = useCallback(() => {
    if (!isTransferringRef.current || isPausedRef.current) return;
    isPausedRef.current = true;
    setIsPaused(true);
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }
  }, []);

  /** Carries on from the frame where the stream was paused. */
  const resumeTransfer = useCallback(() => {
    if (!isTransferringRef.current || !isPausedRef.current) return;
    isPausedRef.current = false;
    setIsPaused(false);
    lastFrameTimeRef.current = performance.now();
    lastRenderSuccessTimeRef.current = performance.now();
    runAnimationLoop();
  }, [runAnimationLoop]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      setSelectedFile(fileList[0]);
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
    setSelectedFile,
    isTransferring,
    isPaused,
    isVerifyingHandshake,
    handshakeVerified,
    handshakeError,
    progress,
    currentFrameIndex,
    totalFrames,
    density,
    setDensity,
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
