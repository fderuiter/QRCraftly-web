/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

/*
 * The evaluator's pure defaults and helpers (#1601): the system clock, the canvas frame reader
 * and the mapping from a check result to a status and an assessment.
 */
import type { QRConfig } from '@/packages/core/types';
import type { PixelFrame, ScannabilityResult } from '../checker';
import { calculateScannabilityHealth } from '../scoring';
import { getExportRiskPolicy, type ScannabilityStatus } from '../exportRiskPolicy';
import type { ScannabilityAssessment, ScannabilityCanvas, ScannabilityClock, ScannabilityFrameReader } from '../evaluator';

/** Budget for one worker round trip before the evaluator answers on the main thread. */
export const SCANNABILITY_WATCHDOG_MS = 1500;
/** Worker latency above one 60 FPS frame turns on frame dropping while a check is in flight. */
export const BACKPRESSURE_LATENCY_MS = 16.6;
/** Idle-callback timeout for canvas capture and main-thread checks. */
export const IDLE_TIMEOUT_MS = 100;
/** How long after a design change the evaluator waits for the caller's check before checking the canvas itself. */
export const RECHECK_AFTER_CHANGE_MS = 1000;

export interface LocalMetrics {
  violations?: number;
  minContrast?: number;
}

/** Wall-clock implementation backed by `performance.now()`, timers and `requestIdleCallback`. */
export const systemScannabilityClock: ScannabilityClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (callback, ms) => Number(globalThis.setTimeout(callback, ms)),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  scheduleIdle: (callback, timeoutMs) => {
    if (typeof globalThis.requestIdleCallback === 'function') {
      globalThis.requestIdleCallback(() => callback(), { timeout: timeoutMs });
    } else {
      globalThis.setTimeout(callback, timeoutMs);
    }
  },
};

function isCanvasElement(canvas: ScannabilityCanvas): canvas is HTMLCanvasElement {
  return typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement;
}

function drawBitmap(bitmap: ImageBitmap): PixelFrame | null {
  const width = bitmap.width || 1;
  const height = bitmap.height || 1;
  if (typeof OffscreenCanvas !== 'undefined') {
    const ctx = new OffscreenCanvas(width, height).getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  }
  return null;
}

export const defaultFrameReader: ScannabilityFrameReader = {
  captureBitmap: (canvas) =>
    isCanvasElement(canvas) && typeof globalThis.createImageBitmap === 'function'
      ? globalThis.createImageBitmap(canvas)
      : null,
  readPixels: (canvas) => {
    if (!isCanvasElement(canvas)) return null;
    const ctx = canvas.getContext('2d');
    return ctx ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
  },
  bitmapToPixels: drawBitmap,
};

export const positive = (value: number | undefined) => (value && value > 0 ? value : undefined);

export const toStatus = (result: ScannabilityResult): ScannabilityStatus =>
  result.success ? (result.physicalReady ? 'physical-pass' : 'digital-pass') : 'fail';

/**
 * Combines the verification status, the heuristic health score and the export policy.
 */
export function assessScannability(
  status: ScannabilityStatus,
  config: QRConfig,
  localMetrics?: LocalMetrics,
  workerRecoveryActive = false
): ScannabilityAssessment {
  const health = calculateScannabilityHealth(config, localMetrics);
  return { status, health, exportRisk: getExportRiskPolicy({ status, health }), workerRecoveryActive };
}
