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

import React, { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from 'react';
import { QRConfig, SocialFormat, TemplateStyle, QRModules } from '../types';
import { drawQR, drawQRInternal } from '../utils/qrRenderer';
import { drawWithTemplate, SOCIAL_DIMENSIONS } from '@/packages/qr-export';
import { useImage } from '../hooks/useImage';
import { validateConfig, describeViolation } from '@/packages/qr-payload';
import { Alert } from './ui/Alert';
import { useOptionalQRStoreSelector } from '../context/QRContext';
import { loadMosaicSource } from '@/packages/qr-matrix/mosaic';
import {
  generateMaze,
  getMazeCacheKey,
  storeMaze,
  isMazeWorkerRequest,
  assertMazeWorkerResponse,
  type MazeData,
} from '@/packages/qr-matrix/maze';
import { buildMatrix, type QrEncoder } from '@/packages/qr-matrix';
import { getQrCanvasRuntime } from '../utils/qrCanvasRuntime';
import { motionAllowed } from '../hooks/usePresence';

/** Length of the preview crossfade in ms (#1054). */
const CROSSFADE_MS = 150;
/** The ghost canvas that fades a preview's previous frame out, kept for reuse: allocating a new
 * backing store for every change costs more than the copy into it. */
const ghosts = new WeakMap<HTMLCanvasElement, { canvas: HTMLCanvasElement; animation: Animation | null }>();

/**
 * Crossfades the preview when the QR or its design changes: copies the current frame into a
 * ghost canvas laid over the preview and fades the ghost out, while the caller draws the new
 * frame on the real canvas straight away (the correct frame is never delayed). Skipped under
 * reduced motion, for the first frame, when the frame size changes and without the Web
 * Animations API. The ghost leaves the page when the fade ends, leaving today's render.
 * @param canvas - The preview canvas, before it is redrawn.
 * @returns Call it after drawing: it drops the fade when the frame size changed.
 */
function crossfadeFrom(canvas: HTMLCanvasElement): () => void {
  const previous = ghosts.get(canvas);
  previous?.animation?.cancel();
  previous?.canvas.remove();
  const container = canvas.parentElement;
  const none = () => {};
  if (!container || canvas.width === 0 || canvas.height === 0 || !motionAllowed()) return none;
  const ghost = previous?.canvas ?? document.createElement('canvas');
  if (typeof ghost.animate !== 'function') return none;
  // Setting a size reallocates the canvas even when it is unchanged, so only a new size is set.
  if (ghost.width !== canvas.width) ghost.width = canvas.width;
  if (ghost.height !== canvas.height) ghost.height = canvas.height;
  const ctx = ghost.getContext('2d');
  if (!ctx) return none;
  try {
    ctx.clearRect(0, 0, ghost.width, ghost.height);
    ctx.drawImage(canvas, 0, 0);
  } catch {
    return none;
  }
  ghost.setAttribute('aria-hidden', 'true');
  ghost.className = 'pointer-events-none absolute inset-0 size-full';
  container.appendChild(ghost);
  const entry: { canvas: HTMLCanvasElement; animation: Animation | null } = { canvas: ghost, animation: null };
  ghosts.set(canvas, entry);
  const animation = ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: CROSSFADE_MS,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    fill: 'forwards',
  });
  entry.animation = animation;
  animation.onfinish = () => {
    ghost.remove();
    entry.animation = null;
  };
  return () => {
    if (canvas.width !== ghost.width || canvas.height !== ghost.height) {
      animation.cancel();
      ghost.remove();
    }
  };
}

/**
 * Props for the QRCanvas component.
 */
interface QRCanvasProps {
  /** The configuration object determining the QR code's appearance and data. */
  config: QRConfig;
  /** The resolution size of the canvas in pixels. Defaults to 1024. */
  size?: number;
  /** Optional CSS class names to apply to the canvas element. */
  className?: string;
  /** Optional callback fired when rendering is complete. */
  onRendered?: (info: { moduleCount: number; virtualImageData?: ImageData; virtualImageBitmap?: ImageBitmap }) => void;
  /** Sequence of string values representing animated QR frames. If omitted, falls back to config.animationValues. */
  animationValues?: string[];
  /** Flag specifying if the visual animation loop is currently active. If omitted, falls back to config.isAnimating. */
  isAnimating?: boolean;
  /** Playback rate in frames per second. If omitted, falls back to config.animationFps. */
  animationFps?: number;
}

/**
 * A component that renders a QR code to a canvas element.
 * It supports customization of colors, styles (squares, dots, rounded, etc.),
 * and embedded logos with various padding options.
 * @param props - The component props.
 * @param props.config - The configuration object.
 * @param props.size - The canvas resolution size (default: 1024).
 * @param props.className - Optional CSS classes.
 * @param props.onRendered - Callback when render finishes.
 * @returns The QRCanvas component.
 */
// Stable fallback so the precompute effect does not re-run on every render when there are no values.
const NO_ANIMATION_VALUES: string[] = [];

const QRCanvas = React.forwardRef<HTMLCanvasElement, QRCanvasProps>(({
  config,
  size = 1024,
  className,
  onRendered,
  animationValues,
  isAnimating,
  animationFps
}, ref) => {
  const activeIsAnimating = isAnimating !== undefined ? isAnimating : (config.isAnimating || false);
  const activeAnimationValues = animationValues !== undefined ? animationValues : (config.animationValues || NO_ANIMATION_VALUES);
  const activeAnimationFps = animationFps !== undefined ? animationFps : (config.animationFps || 30);

  const localCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Use either the forwarded ref or the local one
  const handleRef = (node: HTMLCanvasElement | null) => {
    localCanvasRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  };

  // The QR store is the single owner of the scannability fallback flag.
  const fallbackActive = useOptionalQRStoreSelector(state => state.isScannabilityFallbackActive) ?? false;

  // Only a maze has bridges to drop, so the config keeps its identity otherwise: the flag flips
  // around every edit and would repaint the old matrix for nothing.
  const activeConfig = useMemo(() => {
    if (fallbackActive && config.isMazeEnabled) {
      return { ...config, isMazeBridgesEnabled: false };
    }
    return config;
  }, [config, fallbackActive]);

  // Pre-load images to avoid async rendering and flickering
  const logoImg = useImage(activeConfig.logoUrl);
  const borderLogoImg = useImage(activeConfig.isBorderEnabled ? activeConfig.borderLogoUrl : null);

  // Decode the Mosaic QR image once; the renderer reads it from the in-memory cache.
  const [mosaicSourceVersion, setMosaicSourceVersion] = useState(0);
  useEffect(() => {
    const url = activeConfig.mosaicImageUrl;
    if (!url) return;
    let isCurrent = true;
    loadMosaicSource(url).then((source) => {
      if (isCurrent && source) setMosaicSourceVersion((v) => v + 1);
    });
    return () => {
      isCurrent = false;
    };
  }, [activeConfig.mosaicImageUrl]);

  // Animation states and refs to ensure we can read latest visual styles without rebuilding/restarting loop
  const cachedFramesRef = useRef<{ value: string; modules: QRModules }[]>([]);
  const isAnimatingRef = useRef(activeIsAnimating);
  const configRef = useRef(activeConfig);
  const logoImgRef = useRef(logoImg);
  const borderLogoImgRef = useRef(borderLogoImg);

  useEffect(() => {
    isAnimatingRef.current = activeIsAnimating;
  }, [activeIsAnimating]);

  const onRenderedRef = useRef(onRendered);
  const sizeRef = useRef(size);
  const virtualRenderTimerRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    return () => {
      if (virtualRenderTimerRef.current) {
        virtualRenderTimerRef.current.cancel();
        virtualRenderTimerRef.current = null;
      }
    };
  }, []);

  // The refs, the matrix worker and the paint effects below are layout effects so a change is
  // drawn before the browser paints, not one frame later; the refs update first.
  useLayoutEffect(() => {
    configRef.current = activeConfig;
    logoImgRef.current = logoImg;
    borderLogoImgRef.current = borderLogoImg;
    onRenderedRef.current = onRendered;
    sizeRef.current = size;
  });

  // Pre-calculate and cache the complete sequence of QR frame matrices before starting loop
  useEffect(() => {
    if (!activeAnimationValues || activeAnimationValues.length === 0) {
      cachedFramesRef.current = [];
      return;
    }

    let isMounted = true;
    Promise.resolve(getQrCanvasRuntime().loadEncoder()).then((QRCode) => {
      if (!isMounted) return;
      try {
        const cached = activeAnimationValues.map((val) => {
          try {
            const modules = buildMatrix(
              { type: config.type, value: val, errorCorrectionLevel: config.errorCorrectionLevel },
              QRCode
            );
            return { value: val, modules };
          } catch (e) {
            console.warn("QR precompute failed for value:", val, e);
            return null;
          }
        }).filter((frame): frame is { value: string; modules: QRModules } => frame !== null);
        cachedFramesRef.current = cached;
      } catch (err) {
        console.error("Precomputing matrices failed:", err);
      }
    });

    return () => {
      isMounted = false;
      cachedFramesRef.current = [];
    };
  }, [activeAnimationValues, config.type, config.errorCorrectionLevel]);

  // Direct canvas animation loop using requestAnimationFrame, bypassing React updates
  useEffect(() => {
    if (!activeIsAnimating) return;

    const canvas = localCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const activeSize = size;
    const pixelRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

    // Fixed canvas dimensions at initialization to prevent buffer resets/flickering
    const useTemplate =
      configRef.current.templateStyle !== TemplateStyle.NONE ||
      configRef.current.socialFormat !== SocialFormat.SQUARE_1_1;

    const displayWidth = activeSize;
    let displayHeight = activeSize;

    if (useTemplate) {
      const { width: fw, height: fh } = SOCIAL_DIMENSIONS[configRef.current.socialFormat];
      displayHeight = Math.round(activeSize * fh / fw);
      canvas.width = displayWidth * pixelRatio;
      canvas.height = displayHeight * pixelRatio;
    } else {
      canvas.width = displayWidth * pixelRatio;
      canvas.height = displayHeight * pixelRatio;
    }

    let animationFrameId: number;
    let lastFrameTime = performance.now();
    let currentFrameIdx = 0;
    const fps = activeAnimationFps || 30;
    const frameInterval = 1000 / fps;

    const loop = (now: number) => {
      if (!isAnimatingRef.current) return;

      const elapsed = now - lastFrameTime;

      if (elapsed >= frameInterval) {
        lastFrameTime = now - (elapsed % frameInterval);

        const frames = cachedFramesRef.current;
        if (frames && frames.length > 0) {
          const frame = frames[currentFrameIdx % frames.length];
          if (frame && frame.modules) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const currentConfig = configRef.current;
            const currentLogoImg = logoImgRef.current;
            const currentBorderLogoImg = borderLogoImgRef.current;
            const currentUseTemplate =
              currentConfig.templateStyle !== TemplateStyle.NONE ||
              currentConfig.socialFormat !== SocialFormat.SQUARE_1_1;

            if (currentUseTemplate) {
              ctx.save();
              ctx.scale(pixelRatio, pixelRatio);
              drawWithTemplate(
                ctx as unknown as CanvasRenderingContext2D,
                frame.modules,
                currentConfig,
                currentLogoImg,
                currentBorderLogoImg,
                displayWidth,
                displayHeight,
                frame.modules.size,
                false,
                computedMazeDataRef.current
              );
              ctx.restore();
            } else {
              drawQR(
                ctx,
                frame.modules,
                currentConfig,
                currentLogoImg,
                currentBorderLogoImg,
                activeSize,
                computedMazeDataRef.current
              );
            }

            // Sample the onRendered triggers or completely pause them to avoid main thread blocking
            if (onRendered && currentFrameIdx % 60 === 0) {
              onRendered({ moduleCount: frame.modules.size });
            }

            currentFrameIdx++;
          }
        }
      }

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [activeIsAnimating, size, activeAnimationFps, onRendered]);

  // Web Worker setup and configuration calculation
  const workerRef = useRef<Worker | null>(null);
  const sequenceIdRef = useRef<number>(0);
  const lastModulesRef = useRef<QRModules | null>(null);
  const isWorkerFallbackRef = useRef<boolean>(false);

  const mazeWorkerRef = useRef<Worker | null>(null);
  const mazeSequenceIdRef = useRef<number>(0);
  const isMazeWorkerFallbackRef = useRef<boolean>(false);
  const mazeCacheKeyRef = useRef<string | null>(null);
  const [computedMazeData, setComputedMazeData] = useState<MazeData | null>(null);
  const computedMazeDataRef = useRef<MazeData | null>(null);

  useLayoutEffect(() => {
    computedMazeDataRef.current = computedMazeData;
  }, [computedMazeData]);

  const initMazeWorker = useCallback(() => {
    if (isMazeWorkerFallbackRef.current) return;

    if (mazeWorkerRef.current) {
      mazeWorkerRef.current.terminate();
      mazeWorkerRef.current = null;
    }

    try {
      const worker = getQrCanvasRuntime().createMazeWorker();
      if (!worker) {
        isMazeWorkerFallbackRef.current = true;
        return;
      }

      worker.onmessage = (e) => {
        // Strictly validate message format at runtime
        assertMazeWorkerResponse(e.data);

        const { status, sequenceId, mazeData, error } = e.data;
        if (sequenceId !== mazeSequenceIdRef.current) {
          return;
        }

        if (status === 'success' && mazeData) {
          setComputedMazeData(mazeData);
          if (mazeCacheKeyRef.current) {
            storeMaze(mazeCacheKeyRef.current, mazeData);
          }
        } else {
          console.warn("Background maze calculation failed:", error);
        }
      };

      worker.onerror = (e) => {
        console.error("Maze background worker error, restarting:", e);
        // Crash recovery: terminate current process and spin up replacement
        initMazeWorker();
      };

      mazeWorkerRef.current = worker;
    } catch (err) {
      console.warn("Failed to initialize background maze worker, falling back:", err);
      isMazeWorkerFallbackRef.current = true;
    }
  }, []);

  useEffect(() => {
    initMazeWorker();
    return () => {
      if (mazeWorkerRef.current) {
        mazeWorkerRef.current.terminate();
        mazeWorkerRef.current = null;
      }
    };
  }, [initMazeWorker]);

  // Reads the config from its ref so this callback, and everything built on it, stays stable:
  // otherwise every config change would recreate the matrix worker and re-request the matrix.
  const requestMazeCalculation = useCallback((modules: QRModules) => {
    const activeConfig = configRef.current;
    if (!activeConfig.isMazeEnabled) {
      setComputedMazeData(null);
      return;
    }

    mazeSequenceIdRef.current += 1;
    const currentSeqId = mazeSequenceIdRef.current;

    const size = modules.size;
    mazeCacheKeyRef.current = getMazeCacheKey(activeConfig, size, modules);
    const matrix = new Uint8Array(size * size);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        matrix[r * size + c] = modules.get(r, c) ? 1 : 0;
      }
    }

    if (mazeWorkerRef.current && !isMazeWorkerFallbackRef.current) {
      const requestPayload = {
        size,
        matrix,
        config: activeConfig,
        sequenceId: currentSeqId,
      };

      // Strict validation before posting
      if (!isMazeWorkerRequest(requestPayload)) {
        throw new Error('Invalid MazeWorkerRequest payload built on main thread');
      }

      mazeWorkerRef.current.postMessage(requestPayload);
    } else {
      // Fallback: run pathfinding on the main thread during idle time
      const runner = () => {
        if (currentSeqId !== mazeSequenceIdRef.current) return;
        try {
          const mazeData = generateMaze(modules, activeConfig, size);
          setComputedMazeData(mazeData);
        } catch (e) {
          console.warn("Main thread fallback maze generation failed:", e);
        }
      };

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        window.requestIdleCallback(runner);
      } else {
        setTimeout(runner, 0);
      }
    }
  }, []);

  const clearCanvasAndResize = useCallback(() => {
    const canvas = localCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const currentConfig = configRef.current;
    const currentSize = sizeRef.current;

    const activeSize = currentSize;
    const pixelRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

    const useTemplate =
      currentConfig.templateStyle !== TemplateStyle.NONE ||
      currentConfig.socialFormat !== SocialFormat.SQUARE_1_1;

    if (useTemplate) {
      const { width: fw, height: fh } = SOCIAL_DIMENSIONS[currentConfig.socialFormat];
      const displayHeight = Math.round(activeSize * fh / fw);
      canvas.width = activeSize * pixelRatio;
      canvas.height = displayHeight * pixelRatio;
    } else {
      canvas.width = activeSize * pixelRatio;
      canvas.height = activeSize * pixelRatio;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const repaintCanvasOnly = useCallback((modules: QRModules) => {
    const canvas = localCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fade the previous frame out over the new one; the new frame is drawn at once below.
    const settleCrossfade = crossfadeFrom(canvas);

    const currentConfig = configRef.current;
    const currentLogoImg = logoImgRef.current;
    const currentBorderLogoImg = borderLogoImgRef.current;
    const currentOnRendered = onRenderedRef.current;
    const currentSize = sizeRef.current;

    const activeSize = currentSize;
    const pixelRatio = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

    const useTemplate =
      currentConfig.templateStyle !== TemplateStyle.NONE ||
      currentConfig.socialFormat !== SocialFormat.SQUARE_1_1;

    if (useTemplate) {
      const { width: fw, height: fh } = SOCIAL_DIMENSIONS[currentConfig.socialFormat];
      const displayWidth = activeSize;
      const displayHeight = Math.round(activeSize * fh / fw);

      canvas.width = displayWidth * pixelRatio;
      canvas.height = displayHeight * pixelRatio;

      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);

      drawWithTemplate(
        ctx as unknown as CanvasRenderingContext2D,
        modules,
        currentConfig,
        currentLogoImg,
        currentBorderLogoImg,
        displayWidth,
        displayHeight,
        modules.size,
        false,
        computedMazeDataRef.current
      );

      ctx.restore();
    } else {
      canvas.width = activeSize * pixelRatio;
      canvas.height = activeSize * pixelRatio;
      drawQR(ctx, modules, currentConfig, currentLogoImg, currentBorderLogoImg, activeSize, computedMazeDataRef.current);
    }
    settleCrossfade();

    if (currentOnRendered) {
      const runVirtualRender = () => {
        try {
          const virtualSize = Math.max(512, Math.min(1024, (modules.size + 8) * 10));
          let vCanvas: HTMLCanvasElement | OffscreenCanvas;

          if (typeof OffscreenCanvas !== 'undefined') {
            vCanvas = new OffscreenCanvas(virtualSize, virtualSize);
          } else {
            vCanvas = document.createElement('canvas');
            vCanvas.width = virtualSize;
            vCanvas.height = virtualSize;
          }

          const vCtx = vCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
          if (!vCtx || typeof vCtx.fillRect !== 'function' || typeof vCtx.clearRect !== 'function') {
            currentOnRendered({ moduleCount: modules.size });
            return;
          }

          vCtx.clearRect(0, 0, virtualSize, virtualSize);
          drawQRInternal(
            vCtx as unknown as CanvasRenderingContext2D,
            modules,
            currentConfig,
            currentLogoImg,
            currentBorderLogoImg,
            virtualSize,
            modules.size,
            true,
            computedMazeDataRef.current
          );

          if (typeof globalThis.createImageBitmap === 'function') {
            createImageBitmap(vCanvas).then((imageBitmap) => {
              currentOnRendered({ moduleCount: modules.size, virtualImageBitmap: imageBitmap });
            }).catch((err) => {
              console.error("createImageBitmap failed in virtual render:", err);
              const imageData = vCtx.getImageData(0, 0, virtualSize, virtualSize);
              currentOnRendered({ moduleCount: modules.size, virtualImageData: imageData });
            });
          } else {
            const imageData = vCtx.getImageData(0, 0, virtualSize, virtualSize);
            currentOnRendered({ moduleCount: modules.size, virtualImageData: imageData });
            if (vCanvas) {
              vCanvas.width = 0;
              vCanvas.height = 0;
            }
          }
        } catch (err) {
          console.error("Virtual rendering failed:", err);
          currentOnRendered({ moduleCount: modules.size });
        }
      };

      if (virtualRenderTimerRef.current) {
        virtualRenderTimerRef.current.cancel();
        virtualRenderTimerRef.current = null;
      }

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        const handle = window.requestIdleCallback(runVirtualRender, { timeout: 100 });
        virtualRenderTimerRef.current = {
          cancel: () => {
            if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
              window.cancelIdleCallback(handle);
            }
          },
        };
      } else {
        const handle = setTimeout(runVirtualRender, 50);
        virtualRenderTimerRef.current = {
          cancel: () => clearTimeout(handle),
        };
      }
    }
  }, []);

  const paintMatrix = useCallback((modules: QRModules) => {
    requestMazeCalculation(modules);
    repaintCanvasOnly(modules);
  }, [requestMazeCalculation, repaintCanvasOnly]);

  const requestMatrixCalculation = useCallback(() => {
    const currentConfig = configRef.current;
    if (!currentConfig.value) {
      lastModulesRef.current = null;
      clearCanvasAndResize();
      return;
    }

    sequenceIdRef.current += 1;
    const currentSeqId = sequenceIdRef.current;

    if (workerRef.current && !isWorkerFallbackRef.current) {
      workerRef.current.postMessage({
        config: currentConfig,
        sequenceId: currentSeqId,
      });
    } else {
      // Main-thread fallback when no matrix worker is available (blocked or unsupported)
      const encodeOnMainThread = (QRCode: QrEncoder) => {
        if (currentSeqId !== sequenceIdRef.current) return;
        try {
          const violations = validateConfig(currentConfig);
          if (violations.length > 0) {
            lastModulesRef.current = null;
            clearCanvasAndResize();
            return;
          }

          const modules = buildMatrix(currentConfig, QRCode);
          lastModulesRef.current = modules;
          paintMatrix(modules);
        } catch (e) {
          console.warn("QR generation failed:", e);
          lastModulesRef.current = null;
          clearCanvasAndResize();
        }
      };

      const encoder = getQrCanvasRuntime().loadEncoder();
      if (encoder instanceof Promise) {
        encoder.then(encodeOnMainThread);
      } else {
        encodeOnMainThread(encoder);
      }
    }
  }, [paintMatrix, clearCanvasAndResize]);

  // Web Worker lifecycle management
  useLayoutEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = getQrCanvasRuntime().createMatrixWorker();
      if (!worker) {
        isWorkerFallbackRef.current = true;
        return;
      }
      worker.onmessage = (e) => {
        const { status, sequenceId, size, matrix } = e.data;
        if (sequenceId !== sequenceIdRef.current) {
          return;
        }

        if (status === 'success' && size && matrix) {
          const modules: QRModules = {
            size,
            get(r, c) {
              return matrix[r * size + c] === 1;
            }
          };
          lastModulesRef.current = modules;
          paintMatrix(modules);
        } else {
          lastModulesRef.current = null;
          clearCanvasAndResize();
        }
      };
      workerRef.current = worker;
    } catch (err) {
      console.warn("Failed to initialize background worker, falling back:", err);
      isWorkerFallbackRef.current = true;
    }

    return () => {
      if (worker) {
        worker.terminate();
      }
    };
  }, [paintMatrix, clearCanvasAndResize]);

  // Monitor value and error correction level to request calculations
  useLayoutEffect(() => {
    if (activeIsAnimating) return;
    requestMatrixCalculation();
  }, [config.value, config.errorCorrectionLevel, activeIsAnimating, requestMatrixCalculation]);

  // Repaint canvas when computed background maze data updates without triggering a new calculation
  useLayoutEffect(() => {
    if (activeIsAnimating) return;
    if (computedMazeData && lastModulesRef.current) {
      repaintCanvasOnly(lastModulesRef.current);
    }
  }, [computedMazeData, activeIsAnimating, repaintCanvasOnly]);

  // Monitor structural and aesthetic changes to repaint immediately
  useLayoutEffect(() => {
    if (activeIsAnimating) return;
    if (lastModulesRef.current) {
      paintMatrix(lastModulesRef.current);
    }
  }, [
    config.fgColor,
    config.bgColor,
    config.eyeColor,
    config.style,
    config.logoUrl,
    config.logoSize,
    config.logoPaddingStyle,
    config.logoPadding,
    config.logoBackgroundColor,
    config.isBorderEnabled,
    config.borderSize,
    config.borderColor,
    config.borderStyle,
    config.borderText,
    config.borderTextPosition,
    config.borderTextColor,
    config.borderLogoUrl,
    config.borderLogoPosition,
    config.socialFormat,
    config.templateStyle,
    activeConfig.isMazeEnabled,
    activeConfig.isMazeBridgesEnabled,
    activeConfig.mazeColor,
    activeConfig.mazePathWidth,
    activeConfig.showMazeSolution,
    config.mosaicImageUrl,
    config.mosaicMode,
    config.mosaicContrast,
    mosaicSourceVersion,
    logoImg,
    borderLogoImg,
    size,
    activeIsAnimating,
    paintMatrix,
  ]);

  const typeLabel = config.type.charAt(0).toUpperCase() + config.type.slice(1).toLowerCase();
  const ariaLabel = `QR Code for ${typeLabel} - ${config.value ? 'Scan to view content' : 'Empty'}`;

  const aspectRatioClass = {
    [SocialFormat.SQUARE_1_1]: 'aspect-square',
    [SocialFormat.PORTRAIT_4_5]: 'aspect-[4/5]',
    [SocialFormat.STORY_9_16]: 'aspect-[9/16]',
  }[config.socialFormat];

  const containerClasses = className ? `${className} ${aspectRatioClass}` : aspectRatioClass;

  const violations = validateConfig(config);
  const hasViolations = violations.length > 0;

  if (hasViolations) {
    return (
      <div className={`relative ${containerClasses} w-full`}>
        <div className="absolute inset-0">
          <Alert
            variant="error"
            title="Generation Blocked"
            role="status"
            aria-live="polite"
            className="flex size-full flex-col items-center justify-center gap-3 overflow-y-auto rounded-3xl border-2 border-dashed border-rose-300 bg-rose-50 p-6 text-center dark:border-rose-800 dark:bg-rose-950/25"
          >
            <div className="mt-2 space-y-1.5">
              {violations.map((v, i) => {
                const msg = describeViolation(v);
                return (
                  <p key={i} className="text-sm font-medium text-danger">
                    {msg}
                  </p>
                );
              })}
            </div>
            <p className="mt-2 max-w-xs text-xs text-fg-muted">
              Please correct the input above to safely resume QR code generation.
            </p>
          </Alert>
        </div>
        <canvas
          ref={handleRef}
          style={{ display: 'none' }}
          role="img"
          aria-label={ariaLabel}
        />
      </div>
    );
  }

  return (
    <div className={`relative ${containerClasses} w-full`}>
      <canvas
        ref={handleRef}
        className={`block h-auto w-full ${aspectRatioClass}`}
        role="img"
        aria-label={ariaLabel}
      />
    </div>
  );
});

export default React.memo(QRCanvas);
