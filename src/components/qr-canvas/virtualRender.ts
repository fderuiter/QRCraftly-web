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

import type { QRConfig, QRModules } from '@/packages/core/types';
import type { MazeData } from '@/packages/qr-matrix/maze';
import { drawQRInternal } from '@/packages/qr-matrix';

/** What a finished preview render reports: the module count and, when it could be drawn, a square copy for the scannability check. */
export interface RenderedInfo {
  moduleCount: number;
  virtualImageData?: ImageData;
  virtualImageBitmap?: ImageBitmap;
}

/** Everything the off-screen copy is drawn from. */
export interface VirtualRenderInput {
  modules: QRModules;
  config: QRConfig;
  logoImg: HTMLImageElement | null;
  borderLogoImg: HTMLImageElement | null;
  mazeData: MazeData | null;
  onRendered: (info: RenderedInfo) => void;
}

/** A scheduled render that has not run yet. */
export interface ScheduledRender {
  cancel: () => void;
}

/**
 * Draws the code without its template into an off-screen square canvas and hands it to
 * `onRendered` as an `ImageBitmap` (or `ImageData` where bitmaps are unavailable). Any failure
 * still reports the module count, so the caller always hears back.
 */
export function renderVirtualCopy({ modules, config, logoImg, borderLogoImg, mazeData, onRendered }: VirtualRenderInput): void {
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
      onRendered({ moduleCount: modules.size });
      return;
    }

    vCtx.clearRect(0, 0, virtualSize, virtualSize);
    drawQRInternal(vCtx, modules, config, logoImg, borderLogoImg, virtualSize, modules.size, true, mazeData);

    if (typeof globalThis.createImageBitmap === 'function') {
      createImageBitmap(vCanvas).then((imageBitmap) => {
        onRendered({ moduleCount: modules.size, virtualImageBitmap: imageBitmap });
      }).catch((err) => {
        console.error("createImageBitmap failed in virtual render:", err);
        const imageData = vCtx.getImageData(0, 0, virtualSize, virtualSize);
        onRendered({ moduleCount: modules.size, virtualImageData: imageData });
      });
    } else {
      const imageData = vCtx.getImageData(0, 0, virtualSize, virtualSize);
      onRendered({ moduleCount: modules.size, virtualImageData: imageData });
      vCanvas.width = 0;
      vCanvas.height = 0;
    }
  } catch (err) {
    console.error("Virtual rendering failed:", err);
    onRendered({ moduleCount: modules.size });
  }
}

/**
 * Runs {@link renderVirtualCopy} when the browser is idle (within 100 ms), or after 50 ms
 * where `requestIdleCallback` is missing, so the visible preview paints first.
 */
export function scheduleVirtualRender(input: VirtualRenderInput): ScheduledRender {
  const run = () => renderVirtualCopy(input);
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const handle = window.requestIdleCallback(run, { timeout: 100 });
    return {
      cancel: () => {
        if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
          window.cancelIdleCallback(handle);
        }
      },
    };
  }
  const handle = setTimeout(run, 50);
  return { cancel: () => clearTimeout(handle) };
}
