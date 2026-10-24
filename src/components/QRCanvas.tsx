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
import { type QRConfig, SocialFormat, type QRModules } from '@/packages/core/types';
import { drawWithTemplate } from '@/packages/qr-export';
import { useImage } from '../hooks/useImage';
import { validateConfig, describeViolation } from '@/packages/qr-payload';
import { Alert } from './ui/Alert';
import { useOptionalQRStoreSelector } from '../context/QRContext';
import { loadMosaicSource } from '@/packages/qr-matrix/mosaic';
import { buildMatrix, drawQR, QrEncodeError, type QrEncoder } from '@/packages/qr-matrix';
import { getQrCanvasRuntime } from '../utils/qrCanvasRuntime';
import { tooLongMessage, type PreviewFailure } from '../utils/previewFailure';
import { getQrTypeLabel } from '@/packages/qr-payload';
import { calculateCanvasDimensions } from './qr-canvas/canvasDimensions';
import { crossfadeFrom } from './qr-canvas/crossfade';
import { scheduleVirtualRender, type RenderedInfo, type ScheduledRender } from './qr-canvas/virtualRender';
import { useMazeData } from './qr-canvas/useMazeData';
import { useQrAnimation } from './qr-canvas/useQrAnimation';

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
  onRendered?: (info: RenderedInfo) => void;
  /** Optional callback fired when the preview cannot draw a code, with the reason (#1251). */
  onRenderFailed?: (reason: PreviewFailure) => void;
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
  onRenderFailed,
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

  // The latest config and images, read by stable paint callbacks without rebuilding them.
  const configRef = useRef(activeConfig);
  const logoImgRef = useRef(logoImg);
  const borderLogoImgRef = useRef(borderLogoImg);

  const onRenderedRef = useRef(onRendered);
  const onRenderFailedRef = useRef(onRenderFailed);
  // Set when the content does not fit the chosen error-correction level, so the preview can say so.
  const [isTooLong, setIsTooLong] = useState(false);
  const sizeRef = useRef(size);
  const virtualRenderTimerRef = useRef<ScheduledRender | null>(null);

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
    onRenderFailedRef.current = onRenderFailed;
    sizeRef.current = size;
  });

  // Web Worker setup and configuration calculation
  const workerRef = useRef<Worker | null>(null);
  const sequenceIdRef = useRef<number>(0);
  const lastModulesRef = useRef<QRModules | null>(null);
  const isWorkerFallbackRef = useRef<boolean>(false);

  const { mazeData: computedMazeData, mazeDataRef: computedMazeDataRef, requestMaze: requestMazeCalculation } = useMazeData(configRef);

  useQrAnimation({
    canvasRef: localCanvasRef,
    isAnimating: activeIsAnimating,
    values: activeAnimationValues,
    fps: activeAnimationFps,
    size,
    type: config.type,
    errorCorrectionLevel: config.errorCorrectionLevel,
    configRef,
    logoImgRef,
    borderLogoImgRef,
    mazeDataRef: computedMazeDataRef,
    onRendered,
  });

  const clearCanvasAndResize = useCallback(() => {
    const canvas = localCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dims = calculateCanvasDimensions(configRef.current, sizeRef.current);
    canvas.width = dims.pixelWidth;
    canvas.height = dims.pixelHeight;

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

    const dims = calculateCanvasDimensions(currentConfig, currentSize);

    canvas.width = dims.pixelWidth;
    canvas.height = dims.pixelHeight;

    if (dims.useTemplate) {
      ctx.save();
      ctx.scale(dims.pixelRatio, dims.pixelRatio);

      drawWithTemplate(ctx, modules, currentConfig, { logoImg: currentLogoImg, borderLogoImg: currentBorderLogoImg, width: dims.displayWidth, height: dims.displayHeight, moduleCount: modules.size, mazeData: computedMazeDataRef.current });

      ctx.restore();
    } else {
      drawQR(ctx, modules, currentConfig, currentLogoImg, currentBorderLogoImg, currentSize, computedMazeDataRef.current);
    }
    settleCrossfade();

    if (currentOnRendered) {
      virtualRenderTimerRef.current?.cancel();
      virtualRenderTimerRef.current = scheduleVirtualRender({
        modules,
        config: currentConfig,
        logoImg: currentLogoImg,
        borderLogoImg: currentBorderLogoImg,
        mazeData: computedMazeDataRef.current,
        onRendered: currentOnRendered,
      });
    }
  }, [computedMazeDataRef]);

  const paintMatrix = useCallback((modules: QRModules) => {
    requestMazeCalculation(modules);
    repaintCanvasOnly(modules);
  }, [requestMazeCalculation, repaintCanvasOnly]);

  const requestMatrixCalculation = useCallback(() => {
    const currentConfig = configRef.current;
    // Every request, the empty one included, supersedes answers still on their way for older values.
    sequenceIdRef.current += 1;
    const currentSeqId = sequenceIdRef.current;
    if (!currentConfig.value) {
      lastModulesRef.current = null;
      clearCanvasAndResize();
      return;
    }

    if (workerRef.current && !isWorkerFallbackRef.current) {
      workerRef.current.postMessage({
        config: currentConfig,
        sequenceId: currentSeqId,
      });
    } else {
      // Main-thread fallback when no matrix worker is available (blocked or unsupported)
      /** Clears the preview and reports why, so it never shows an older code than the config (#1586). */
      const fail = (reason: PreviewFailure) => {
        lastModulesRef.current = null;
        clearCanvasAndResize();
        setIsTooLong(reason === 'too-long');
        onRenderFailedRef.current?.(reason);
      };
      const encodeOnMainThread = (QRCode: QrEncoder) => {
        if (currentSeqId !== sequenceIdRef.current) return;
        try {
          const violations = validateConfig(currentConfig);
          if (violations.length > 0) {
            fail('blocked');
            return;
          }

          const modules = buildMatrix(currentConfig, QRCode);
          lastModulesRef.current = modules;
          setIsTooLong(false);
          paintMatrix(modules);
        } catch (e) {
          console.warn("QR generation failed:", e instanceof Error ? e.name : typeof e);
          fail(e instanceof QrEncodeError && e.kind === 'too-long' ? 'too-long' : 'failed');
        }
      };

      const encoder = getQrCanvasRuntime().loadEncoder();
      if (encoder instanceof Promise) {
        encoder.then(encodeOnMainThread, (e: unknown) => {
          // A failure for an older request must not clear a newer request's result.
          if (currentSeqId !== sequenceIdRef.current) return;
          console.warn("QR encoder failed to load:", e instanceof Error ? e.name : typeof e);
          fail('failed');
        });
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
        const { status, sequenceId, size, matrix, kind } = e.data;
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
          setIsTooLong(false);
          paintMatrix(modules);
        } else {
          lastModulesRef.current = null;
          clearCanvasAndResize();
          const reason: PreviewFailure = status === 'validationFailed' ? 'blocked' : kind === 'too-long' ? 'too-long' : 'failed';
          setIsTooLong(reason === 'too-long');
          onRenderFailedRef.current?.(reason);
        }
      };
      worker.onerror = (e) => {
        // The worker script failed to load or crashed (for example a page from an older
        // build asking for a worker file the server no longer has, #1259): encode on the
        // main thread from now on and redo the pending request there.
        console.warn("Matrix background worker failed, encoding on the main thread:", e);
        e.preventDefault();
        isWorkerFallbackRef.current = true;
        if (workerRef.current === worker) workerRef.current = null;
        worker?.terminate();
        requestMatrixCalculation();
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
  }, [paintMatrix, clearCanvasAndResize, requestMatrixCalculation]);

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

  // Monitor structural and aesthetic changes to repaint immediately. Every design field the renderer
  // reads belongs here: one left out (frames, eye colours) only showed after some other change.
  useLayoutEffect(() => {
    if (activeIsAnimating) return;
    if (lastModulesRef.current) {
      paintMatrix(lastModulesRef.current);
    }
  }, [
    config.fgColor,
    config.bgColor,
    config.eyeColor,
    config.eyeFrameColor,
    config.eyeBallColor,
    config.eyeFrameShape,
    config.eyeBallShape,
    config.frameStyle,
    config.frameText,
    config.frameBgColor,
    config.frameTextColor,
    config.framePosition,
    config.frameIcon,
    config.gradientType,
    config.gradientColorStops,
    config.gradientAngle,
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
    config.templateHeadline,
    config.templateSubtext,
    config.templateBgColor,
    config.templateTextColor,
    config.templateQrScale,
    config.backgroundImageUrl,
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

  const typeLabel = getQrTypeLabel(config.type);
  const ariaLabel = config.value ? `QR code for ${typeLabel}` : `QR code for ${typeLabel}, nothing entered yet`;

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
            className="flex size-full flex-col items-center justify-center gap-3 overflow-y-auto rounded-xl border-2 border-dashed border-danger-line bg-danger-soft p-6 text-center"
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

  if (isTooLong && !activeIsAnimating) {
    return (
      <div className={`relative ${containerClasses} w-full`}>
        <div className="absolute inset-0">
          <Alert
            variant="error"
            title="Too much content"
            role="status"
            aria-live="polite"
            className="flex size-full flex-col items-center justify-center gap-3 overflow-y-auto rounded-xl border-2 border-dashed border-danger-line bg-danger-soft p-6 text-center"
          >
            <p className="mt-2 max-w-xs text-sm font-medium text-danger">
              {tooLongMessage(config.errorCorrectionLevel)}
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
