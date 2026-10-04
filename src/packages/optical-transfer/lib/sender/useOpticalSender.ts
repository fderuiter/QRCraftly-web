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
import { QRConfig, QRErrorCorrectionLevel } from '@/types';
import { PreallocatedFramePool, shuffleInPlace } from '../framePool';
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
  /**
   * True while the app's Scannability Health check has fallen back to a simpler render; maze
   * bridges are then dropped from the handshake frame.
   */
  scannabilityFallbackActive?: boolean;
  /** Scannability gate run on the first frame before playback. Defaults to `verifyHandshakeFrame`. */
  verifyFrame?: HandshakeFrameVerifier;
  /**
   * Broadcast a rateless BC-UR fountain stream (default). Every frame is a
   * self-describing droplet, so there is no handshake frame and receivers can
   * join at any point. Set to false for the legacy `H|`/`F|` carousel.
   */
  fountainMode?: boolean;
}

/** Fountain session details reported by the slice worker. */
export interface SenderFountainInfo {
  /** Source block count K. */
  k: number;
  /** Effective bytes per droplet after the density's QR version clamp. */
  symbolSize: number;
  /** Density the droplets were sized for. */
  density: TransferDensity;
  /** Whether the payload was deflate-raw compressed or sent verbatim. */
  compression: TransferCompression;
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
  scannabilityFallbackActive = false,
  verifyFrame = verifyHandshakeFrame,
  fountainMode = true,
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
  /** Legacy carousel only: bytes per `F|` frame. Fountain streams size droplets from `density`. */
  const [chunkSize, setChunkSize] = useState(180);
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

  const effectiveConfig = useMemo(() => {
    if (scannabilityFallbackActive) {
      return { ...config, isMazeBridgesEnabled: false };
    }
    return config;
  }, [config, scannabilityFallbackActive]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const framePoolRef = useRef<PreallocatedFramePool>(new PreallocatedFramePool(64));
  const fountainModeRef = useRef(fountainMode);
  const passCountRef = useRef<number>(1);
  const shuffledOrderRef = useRef<number[]>([]);

  // Refs for background loop
  const configRef = useRef(effectiveConfig);
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
    configRef.current = effectiveConfig;
    logoImgRef.current = logoImg;
    borderLogoImgRef.current = borderLogoImg;
    renderFrameRef.current = renderFrame;
    verifyFrameRef.current = verifyFrame;
    isTransferringRef.current = isTransferring;
    isVerifyingHandshakeRef.current = isVerifyingHandshake;
    fpsRef.current = fps;
    totalFramesRef.current = totalFrames;
    fountainModeRef.current = fountainMode;
  }, [fountainMode, effectiveConfig, logoImg, borderLogoImg, renderFrame, verifyFrame, isTransferring, isVerifyingHandshake, fps, totalFrames]);

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

  /** Paints a frame: the legacy handshake frame keeps the full style, every other frame is sanitized. */
  const paint = useCallback((frame: TransferFrame, styled: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderFrameRef.current(
      canvas,
      frame,
      styled ? configRef.current : sanitizeStreamConfig(configRef.current),
      styled ? logoImgRef.current : null,
      styled ? borderLogoImgRef.current : null
    );
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
    shuffledOrderRef.current = [];
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
        const isFountain = fountainModeRef.current;
        const isPass1 = isFountain || passCountRef.current === 1;

        const targetFrameIndex = isPass1
          ? playIdx
          : (shuffledOrderRef.current[playIdx] ?? playIdx);

        const frame = pool.getFrame(targetFrameIndex);
        if (frame) {
          paint(frame, targetFrameIndex === 0 && !isFountain);

          const total = totalFramesRef.current || 1;
          setCurrentFrameIndex(targetFrameIndex + 1);

          if (isPass1 && workerRef.current) {
            workerRef.current.postMessage({
              type: 'ACK',
              payload: { index: targetFrameIndex },
            });
          }

          if (isFountain) {
            // Rateless: droplets play once in order and their pool slot is recycled.
            pool.delete(targetFrameIndex);
            setProgress(Math.min(100, Math.round(((playIdx + 1) / total) * 100)));
            const passNumber = Math.floor(playIdx / total) + 1;
            if (passNumber !== passCountRef.current) {
              passCountRef.current = passNumber;
              setCurrentPass(passNumber);
            }
            currentPlayIndexRef.current = playIdx + 1;
          } else {
            setProgress(Math.round(((playIdx + 1) / total) * 100));
            const nextPlayIdx = playIdx + 1;
            if (nextPlayIdx >= total) {
              if (passCountRef.current === 1) {
                passCountRef.current = 2;
                setCurrentPass(2);
                const order = Array.from({ length: total }, (_, i) => i);
                shuffleInPlace(order);
                shuffledOrderRef.current = order;
              } else {
                passCountRef.current += 1;
                setCurrentPass(passCountRef.current);
                shuffleInPlace(shuffledOrderRef.current);
              }
              currentPlayIndexRef.current = 0;
            } else {
              currentPlayIndexRef.current = nextPlayIdx;
            }
          }

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

    // Legacy streams gate on the styled handshake frame; fountain streams
    // have no handshake, so the first droplet is checked as it will be shown.
    const isFountain = fountainModeRef.current;
    const isScannable = await verifyFrameRef.current(
      frame,
      isFountain ? sanitizeStreamConfig(configRef.current) : configRef.current,
      isFountain ? null : logoImgRef.current,
      isFountain ? null : borderLogoImgRef.current
    );

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
    setHandshakeError(`${isFountain ? 'Transfer' : 'Handshake'} QR frame ${HANDSHAKE_FAILURE_SUFFIX}`);
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
        setFountainInfo(
          message.fountain
            ? {
                k: message.fountain.k,
                symbolSize: message.fountain.symbolSize,
                compression: message.fountain.compression,
                density: message.fountain.density,
              }
            : null
        );
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
    shuffledOrderRef.current = [];
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

    // Legacy frames follow the appearance ECC (raised to Q); fountain droplets take theirs from the density.
    const legacyEcc =
      config.errorCorrectionLevel === QRErrorCorrectionLevel.H || config.errorCorrectionLevel === QRErrorCorrectionLevel.Q
        ? config.errorCorrectionLevel
        : QRErrorCorrectionLevel.Q;

    workerRef.current.postMessage({
      type: 'START',
      payload: fountainMode
        ? { file: selectedFile, fps: fpsRef.current, fountainMode, density }
        : {
            file: selectedFile,
            chunkSize: chunkSize < 256 ? chunkSize : 180,
            errorCorrectionLevel: legacyEcc,
            fps: fpsRef.current,
            fountainMode,
          },
    });
  }, [selectedFile, chunkSize, density, config.errorCorrectionLevel, stopTransfer, handleWorkerMessage, fountainMode]);

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
    chunkSize,
    setChunkSize,
    density,
    setDensity,
    fps,
    setFps,
    currentPass,
    fountainMode,
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
