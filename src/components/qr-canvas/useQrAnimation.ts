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

import { useEffect, useRef, type RefObject } from 'react';
import type { QRConfig, QRModules } from '@/packages/core/types';
import { drawWithTemplate } from '@/packages/qr-export';
import { buildMatrix, drawQR } from '@/packages/qr-matrix';
import type { MazeData } from '@/packages/qr-matrix/maze';
import { getQrCanvasRuntime } from '@/utils/qrCanvasRuntime';
import { calculateCanvasDimensions } from './canvasDimensions';
import type { RenderedInfo } from './virtualRender';

/** Inputs for {@link useQrAnimation}. The refs are read on every frame, so a style change shows without restarting the loop. */
export interface QrAnimationOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  isAnimating: boolean;
  /** The value of each frame, in order. */
  values: readonly string[];
  fps: number;
  /** Display size in CSS pixels. */
  size: number;
  /** Content type and error correction level the frames are encoded with. */
  type: QRConfig['type'];
  errorCorrectionLevel: QRConfig['errorCorrectionLevel'];
  configRef: RefObject<QRConfig>;
  logoImgRef: RefObject<HTMLImageElement | null>;
  borderLogoImgRef: RefObject<HTMLImageElement | null>;
  mazeDataRef: RefObject<MazeData | null>;
  /** Sampled every 60th frame, so the scannability check is not flooded. */
  onRendered?: (info: RenderedInfo) => void;
}

/**
 * Plays an animated QR on the canvas: encodes every frame's matrix once, then draws them with
 * `requestAnimationFrame` at the requested rate, bypassing React renders.
 */
export function useQrAnimation({
  canvasRef,
  isAnimating,
  values,
  fps,
  size,
  type,
  errorCorrectionLevel,
  configRef,
  logoImgRef,
  borderLogoImgRef,
  mazeDataRef,
  onRendered,
}: QrAnimationOptions): void {
  const cachedFramesRef = useRef<{ value: string; modules: QRModules }[]>([]);
  const isAnimatingRef = useRef(isAnimating);

  useEffect(() => {
    isAnimatingRef.current = isAnimating;
  }, [isAnimating]);

  // Pre-calculate and cache the complete sequence of QR frame matrices before starting loop
  useEffect(() => {
    if (values.length === 0) {
      cachedFramesRef.current = [];
      return;
    }

    let isMounted = true;
    Promise.resolve(getQrCanvasRuntime().loadEncoder()).then((QRCode) => {
      if (!isMounted) return;
      try {
        const cached = values.map((val, index) => {
          try {
            const modules = buildMatrix({ type, value: val, errorCorrectionLevel }, QRCode);
            return { value: val, modules };
          } catch (e) {
            // Log the frame position and error kind only, never the frame content (#1268).
            console.warn(`QR precompute failed for frame ${index + 1}:`, e instanceof Error ? e.name : typeof e);
            return null;
          }
        }).filter((frame): frame is { value: string; modules: QRModules } => frame !== null);
        cachedFramesRef.current = cached;
      } catch (err) {
        console.error("Precomputing matrices failed:", err);
      }
    }, (e: unknown) => {
      // The encoder did not load: play no frames rather than an older sequence (#1586).
      if (!isMounted) return;
      cachedFramesRef.current = [];
      console.warn("QR encoder failed to load for the animation:", e instanceof Error ? e.name : typeof e);
    });

    return () => {
      isMounted = false;
      cachedFramesRef.current = [];
    };
  }, [values, type, errorCorrectionLevel]);

  // Direct canvas animation loop using requestAnimationFrame, bypassing React updates
  useEffect(() => {
    if (!isAnimating) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fixed canvas dimensions at initialization to prevent buffer resets/flickering
    const dims = calculateCanvasDimensions(configRef.current, size);
    canvas.width = dims.pixelWidth;
    canvas.height = dims.pixelHeight;

    let animationFrameId: number;
    let lastFrameTime = performance.now();
    let currentFrameIdx = 0;
    const frameInterval = 1000 / (fps || 30);

    const loop = (now: number) => {
      if (!isAnimatingRef.current) return;

      const elapsed = now - lastFrameTime;

      if (elapsed >= frameInterval) {
        lastFrameTime = now - (elapsed % frameInterval);

        const frames = cachedFramesRef.current;
        if (frames.length > 0) {
          const frame = frames[currentFrameIdx % frames.length];
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const currentConfig = configRef.current;
          const currentDims = calculateCanvasDimensions(currentConfig, size, dims.pixelRatio);

          if (currentDims.useTemplate) {
            ctx.save();
            ctx.scale(dims.pixelRatio, dims.pixelRatio);
            drawWithTemplate(ctx, frame.modules, currentConfig, { logoImg: logoImgRef.current, borderLogoImg: borderLogoImgRef.current, width: dims.displayWidth, height: dims.displayHeight, moduleCount: frame.modules.size, mazeData: mazeDataRef.current });
            ctx.restore();
          } else {
            drawQR(ctx, frame.modules, currentConfig, logoImgRef.current, borderLogoImgRef.current, size, mazeDataRef.current);
          }

          // Sample the onRendered triggers or completely pause them to avoid main thread blocking
          if (onRendered && currentFrameIdx % 60 === 0) {
            onRendered({ moduleCount: frame.modules.size });
          }

          currentFrameIdx++;
        }
      }

      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isAnimating, size, fps, onRendered, canvasRef, configRef, logoImgRef, borderLogoImgRef, mazeDataRef]);
}
