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

import type { QRConfig } from '@/types';
import { assertWorkerRequest, isWorkerResponse } from './sharedContract';
import type { PixelFrame, ScannabilityResult } from './checker';
import { calculateScannabilityHealth, type HealthScore } from './scoring';
import { getExportRiskPolicy, type ExportRisk, type ScannabilityStatus } from './exportRiskPolicy';
import { releaseImageHandle } from './imageHandle';
import {
  connectScannabilityWorker,
  type ScannabilityWorkerFactory,
  type ScannabilityWorkerHandle,
} from './workerFactory';

/** Budget for one worker round trip before the evaluator answers on the main thread. */
const SCANNABILITY_WATCHDOG_MS = 1500;
/** Worker latency above one 60 FPS frame turns on frame dropping while a check is in flight. */
const BACKPRESSURE_LATENCY_MS = 16.6;
/** Idle-callback timeout for canvas capture and main-thread checks. */
const IDLE_TIMEOUT_MS = 100;

/**
 * Injectable time source. Production uses `systemScannabilityClock`; headless tests step a fake.
 */
export interface ScannabilityClock {
  /** Monotonic time in milliseconds. */
  now(): number;
  /** Schedules `callback` after `ms` milliseconds and returns a cancellable handle. */
  setTimeout(callback: () => void, ms: number): number;
  /** Cancels a handle returned by `setTimeout`. */
  clearTimeout(handle: number): void;
  /** Runs `callback` when the main thread is idle, or after `timeoutMs` at the latest. */
  scheduleIdle(callback: () => void, timeoutMs: number): void;
}

/** Wall-clock implementation backed by `performance.now()`, timers and `requestIdleCallback`. */
const systemScannabilityClock: ScannabilityClock = {
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

/** The part of a canvas the evaluator reads. Any `HTMLCanvasElement` satisfies it. */
export interface ScannabilityCanvas {
  readonly width: number;
  readonly height: number;
}

/**
 * Turns the preview canvas (or a caller's ImageBitmap) into worker or main-thread input.
 */
export interface ScannabilityFrameReader {
  /** Captures a transferable bitmap of the canvas, or returns null when that is unsupported. */
  captureBitmap(canvas: ScannabilityCanvas): Promise<ImageBitmap> | null;
  /** Reads the canvas pixels synchronously, or returns null when no 2D context is available. */
  readPixels(canvas: ScannabilityCanvas): PixelFrame | null;
  /** Reads a bitmap's pixels on the main thread, or returns null when no canvas is available. */
  bitmapToPixels(bitmap: ImageBitmap): PixelFrame | null;
}

/** One Scannability Health question: which pixels to judge. */
export interface ScannabilityCheckRequest {
  /** Pre-rendered pixels (their buffer is transferred to the worker). */
  imageData?: PixelFrame;
  /** Pre-rendered bitmap (transferred to the worker, or closed once read). */
  imageBitmap?: ImageBitmap;
  /** QR modules per side, enabling the localized contrast audit. */
  moduleCount?: number;
}

/** The single answer: everything a caller needs to show or gate on Scannability Health. */
export interface ScannabilityAssessment {
  status: ScannabilityStatus;
  health: HealthScore;
  exportRisk: ExportRisk;
  /** True while checks are being answered on the main thread because the worker failed. */
  workerRecoveryActive: boolean;
}

export interface ScannabilityEvaluatorConfig {
  /** QR configuration the health heuristics score. Update it with `setConfig`. */
  config: QRConfig;
  /** Preview canvas captured when a check carries no pixels of its own. */
  getCanvas?: () => ScannabilityCanvas | null | undefined;
  /** Fallback module count used when a check does not name one (e.g. from the app store). */
  getModuleCount?: () => number | undefined;
  /** Called with an error classification whenever a check fails (for telemetry signals). */
  onFail?: (errorType: string) => void;
  /** Worker factory; defaults to the package's Scannability Worker. */
  createWorker?: ScannabilityWorkerFactory;
  /** Time source; defaults to the system clock. */
  clock?: ScannabilityClock;
  /** Frame reader; defaults to `createImageBitmap` and 2D canvases. */
  frames?: ScannabilityFrameReader;
  /** Main-thread check; defaults to the same step sequence the worker runs, loaded on first use. */
  runCheck?: (frame: PixelFrame, moduleCount?: number) => ScannabilityResult;
}

/**
 * Headless Scannability Health Evaluator. Callers ask one question (`check`) and read one answer
 * (`ScannabilityAssessment`). Canvas capture, buffer transfer, request sequencing, the worker
 * lifecycle, the 1500ms watchdog, backpressure and the main-thread fallback are all private.
 */
export interface ScannabilityEvaluator {
  /**
   * Evaluates a frame (or the current canvas). Resolves with the assessment for this request, or
   * null when it was superseded, dropped by backpressure, or had nothing to evaluate.
   */
  check(request?: ScannabilityCheckRequest): Promise<ScannabilityAssessment | null>;
  /** Replaces the QR configuration; the health score and export risk are recomputed. */
  setConfig(config: QRConfig): void;
  /** Latest assessment (a stable object until something changes). */
  getAssessment(): ScannabilityAssessment;
  /** Registers a listener for assessment changes and returns a function that removes it. */
  subscribe(listener: (assessment: ScannabilityAssessment) => void): () => void;
  /** Terminates the worker, cancels timers and drops listeners. The evaluator is unusable afterwards. */
  destroy(): void;
}

interface LocalMetrics {
  violations?: number;
  minContrast?: number;
}

interface Flight {
  seq: number;
  request: ScannabilityCheckRequest;
  moduleCount: number | undefined;
}

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

const defaultFrameReader: ScannabilityFrameReader = {
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

type RunCheck = (frame: PixelFrame, moduleCount?: number) => ScannabilityResult;

let defaultRunCheck: Promise<RunCheck> | null = null;

/**
 * The main-thread check, loaded on first use with the QR reader (#1178), so pages only download
 * the reader's WebAssembly module when a check has to run on the main thread. A failed load is
 * not kept, so a later check retries.
 */
function loadDefaultRunCheck(): Promise<RunCheck> {
  defaultRunCheck ??= Promise.all([import('./checker'), import('@/packages/qr-decode')])
    .then(([{ performScannabilityCheck }, { loadQrReader }]) => loadQrReader().then((reader) => ({ performScannabilityCheck, reader })))
    .then(
      ({ performScannabilityCheck, reader }): RunCheck =>
        (frame, moduleCount) => performScannabilityCheck(reader, frame, frame.width, frame.height, moduleCount)
    )
    .catch((error: unknown) => {
      defaultRunCheck = null;
      throw error;
    });
  return defaultRunCheck;
}

const positive = (value: number | undefined) => (value && value > 0 ? value : undefined);

const toStatus = (result: ScannabilityResult): ScannabilityStatus =>
  result.success ? (result.physicalReady ? 'physical-pass' : 'digital-pass') : 'fail';

/**
 * Creates a Scannability Health Evaluator. No worker is spawned until the first check.
 */
export function createScannabilityEvaluator(options: ScannabilityEvaluatorConfig): ScannabilityEvaluator {
  const clock = options.clock ?? systemScannabilityClock;
  const frames = options.frames ?? defaultFrameReader;
  const createWorker = options.createWorker ?? connectScannabilityWorker;
  const injectedRunCheck = options.runCheck;
  const listeners = new Set<(assessment: ScannabilityAssessment) => void>();
  const pending = new Map<number, (assessment: ScannabilityAssessment | null) => void>();

  let config = options.config;
  let status: ScannabilityStatus = 'idle';
  let localMetrics: LocalMetrics | undefined;
  let workerRecoveryActive = false;
  let assessment = assessScannability(status, config, localMetrics, workerRecoveryActive);

  let worker: ScannabilityWorkerHandle | null = null;
  let workerUnsupported = false;
  let destroyed = false;
  let sequence = 0;
  let busy = false;
  let startedAt: number | null = null;
  let lastLatency = 0;
  let consecutiveTimeouts = 0;
  let offscreenDegraded = false;
  let watchdog: { handle: number; seq: number } | null = null;
  let flight: Flight | null = null;
  let retiring: { owner: ScannabilityWorkerHandle; handle: number } | null = null;

  // --- answer bookkeeping ----------------------------------------------------

  function publish() {
    assessment = assessScannability(status, config, localMetrics, workerRecoveryActive);
    for (const listener of [...listeners]) listener(assessment);
  }

  function update(next: { status?: ScannabilityStatus; localMetrics?: LocalMetrics; recovery?: boolean }) {
    let changed = false;
    if (next.status !== undefined && next.status !== status) {
      status = next.status;
      changed = true;
    }
    if (
      next.localMetrics !== undefined &&
      (next.localMetrics.violations !== localMetrics?.violations ||
        next.localMetrics.minContrast !== localMetrics?.minContrast)
    ) {
      localMetrics = next.localMetrics;
      changed = true;
    }
    if (next.recovery !== undefined && next.recovery !== workerRecoveryActive) {
      workerRecoveryActive = next.recovery;
      changed = true;
    }
    if (changed && !destroyed) publish();
  }

  /** Resolves the request `seq` (with the current answer, or null) and every older request (null). */
  function settle(seq: number, answered: boolean) {
    for (const [pendingSeq, resolve] of pending) {
      if (pendingSeq > seq) continue;
      pending.delete(pendingSeq);
      resolve(pendingSeq === seq && answered ? assessment : null);
    }
  }

  function reportFailure(errorType: string) {
    try {
      options.onFail?.(errorType);
    } catch (err) {
      console.error('Scannability failure listener threw:', err);
    }
  }

  const isCurrent = (seq: number) => !destroyed && seq === sequence;

  function applyResult(seq: number, result: ScannabilityResult, workerHealthy: boolean) {
    if (!isCurrent(seq)) return;
    update({
      status: toStatus(result),
      localMetrics:
        result.localContrastViolations !== undefined
          ? { violations: result.localContrastViolations, minContrast: result.minLocalContrast }
          : undefined,
      recovery: workerHealthy ? false : undefined,
    });
    if (!result.success && result.error) reportFailure(result.error);
    settle(seq, true);
  }

  /** Ends the current request without a verdict of its own (`idle`) or with a bare failure. */
  function conclude(seq: number, outcome: 'idle' | 'fail') {
    if (!isCurrent(seq)) return;
    endFlight(seq);
    update({ status: outcome });
    settle(seq, outcome === 'fail');
  }

  // --- worker lifecycle ------------------------------------------------------

  function clearWatchdog(seq?: number) {
    if (watchdog && (seq === undefined || watchdog.seq === seq)) {
      clock.clearTimeout(watchdog.handle);
      watchdog = null;
    }
  }

  function armWatchdog(seq: number) {
    clearWatchdog();
    const handle = clock.setTimeout(() => onWatchdog(seq), SCANNABILITY_WATCHDOG_MS);
    watchdog = { handle, seq };
  }

  function endFlight(seq: number) {
    busy = false;
    startedAt = null;
    clearWatchdog(seq);
  }

  function getWorker(): ScannabilityWorkerHandle | null {
    if (destroyed || workerUnsupported) return null;
    if (worker) return worker;
    let owner: ScannabilityWorkerHandle | null = null;
    try {
      owner = createWorker({
        onMessage: (data) => handleMessage(owner, data),
        onError: (reason) => handleWorkerError(owner, reason),
      });
    } catch (err) {
      console.error('Failed to initialize the Scannability Worker, using the main thread:', err);
      owner = null;
    }
    if (!owner) {
      workerUnsupported = true;
      return null;
    }
    worker = owner;
    return owner;
  }

  function dropWorker() {
    worker?.terminate();
    worker = null;
  }

  function finishRetire() {
    if (!retiring) return;
    clock.clearTimeout(retiring.handle);
    retiring.owner.terminate();
    retiring = null;
  }

  /**
   * Terminates the worker once its in-flight frame is answered, or after the watchdog
   * window. Killing a worker while it draws a transferred ImageBitmap can crash WebKit's
   * web process on hosts without GPU sync support, taking the whole page down.
   */
  function retireWorker() {
    const owner = worker;
    worker = null;
    if (!owner) return;
    if (!busy) {
      owner.terminate();
      return;
    }
    retiring = { owner, handle: clock.setTimeout(finishRetire, SCANNABILITY_WATCHDOG_MS) };
  }

  function post(owner: ScannabilityWorkerHandle, seq: number, moduleCount: number | undefined, frame: PixelFrame | ImageBitmap, size: ScannabilityCanvas) {
    const base = {
      width: size.width,
      height: size.height,
      configId: String(seq),
      moduleCount,
    };
    if ('data' in frame) {
      const request = { ...base, imageData: frame };
      assertWorkerRequest(request);
      const buffer = frame.data.buffer;
      owner.post(request, buffer instanceof ArrayBuffer ? [buffer] : []);
    } else {
      const request = { ...base, imageBitmap: frame };
      assertWorkerRequest(request);
      owner.post(request, [frame]);
    }
  }

  function dispatchFailed(seq: number, err: unknown, bitmap?: ImageBitmap) {
    console.error('Outgoing worker request validation failed:', err);
    releaseImageHandle(bitmap);
    conclude(seq, 'fail');
  }

  function readCanvasPixels(): PixelFrame | null {
    const canvas = options.getCanvas?.();
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;
    try {
      return frames.readPixels(canvas);
    } catch (err) {
      console.error('Failed to read canvas data for scannability evaluation:', err);
      return null;
    }
  }

  function pixelsFromRequest(request: ScannabilityCheckRequest): PixelFrame | null {
    const { imageData, imageBitmap } = request;
    // A transferred buffer is detached (byteLength 0) and a transferred bitmap reports 0x0.
    if (imageData && imageData.data.byteLength > 0) return imageData;
    if (imageBitmap && imageBitmap.width > 0 && imageBitmap.height > 0) {
      try {
        return frames.bitmapToPixels(imageBitmap);
      } catch {
        return null;
      }
    }
    return null;
  }

  function handleWorkerError(owner: ScannabilityWorkerHandle | null, reason: unknown) {
    if (owner && owner === retiring?.owner) {
      finishRetire();
      return;
    }
    if (!owner || owner !== worker) return;
    console.error('Worker error, transitioning immediately to fail state:', reason);
    dropWorker();
    endFlight(sequence);
    clearWatchdog();
    update({ status: 'fail', recovery: true });
    reportFailure('WORKER_ERROR');
    settle(sequence, true);
  }

  function handleMessage(owner: ScannabilityWorkerHandle | null, data: unknown) {
    if (owner && owner === retiring?.owner) {
      finishRetire();
      return;
    }
    if (!owner || owner !== worker || destroyed) return;
    if (!isWorkerResponse(data)) {
      console.error('Worker response validation failed:', data);
      endFlight(sequence);
      clearWatchdog();
      update({ status: 'fail' });
      reportFailure('VALIDATION_ERROR');
      settle(sequence, true);
      return;
    }

    const { configId } = data;
    // Untracked messages carry no request identity; ignore them without touching flight state.
    if (!configId) return;

    // Superseded ACK: release backpressure; only the current request falls back to idle.
    if ('dropped' in data && data.dropped) {
      busy = false;
      startedAt = null;
      if (configId === String(sequence)) conclude(sequence, 'idle');
      return;
    }

    // Late result for an older request: release backpressure, keep the current status.
    if (configId !== String(sequence)) {
      busy = false;
      startedAt = null;
      return;
    }

    clearWatchdog(sequence);

    if ('retryWithImageData' in data && data.retryWithImageData) {
      // Worker Degradation Cache: this worker cannot draw bitmaps, so send pixels from now on.
      offscreenDegraded = true;
      const pixels = readCanvasPixels();
      if (!pixels) {
        conclude(sequence, 'fail');
        return;
      }
      try {
        post(owner, sequence, flight?.moduleCount, pixels, pixels);
        armWatchdog(sequence);
      } catch (err) {
        dispatchFailed(sequence, err);
      }
      return;
    }

    if (!('success' in data)) return;
    if (startedAt !== null) {
      lastLatency = clock.now() - startedAt;
    }
    endFlight(sequence);
    consecutiveTimeouts = 0;
    applyResult(sequence, data, true);
  }

  function onWatchdog(seq: number) {
    if (!isCurrent(seq)) return;
    if (watchdog?.seq === seq) watchdog = null;
    busy = false;
    startedAt = null;
    consecutiveTimeouts += 1;
    update({ recovery: true });
    if (consecutiveTimeouts > 1) dropWorker();

    const current = flight && flight.seq === seq ? flight : null;
    const pixels = (current && pixelsFromRequest(current.request)) || readCanvasPixels();
    if (!pixels) {
      conclude(seq, 'fail');
      return;
    }
    runOnMainThread(seq, pixels, current?.moduleCount, false);
  }

  // --- main-thread path ------------------------------------------------------

  function runOnMainThread(seq: number, pixels: PixelFrame, moduleCount: number | undefined, workerHealthy: boolean) {
    if (!isCurrent(seq)) return;
    if (injectedRunCheck) {
      finishOnMainThread(seq, () => injectedRunCheck(pixels, moduleCount), workerHealthy);
      return;
    }
    loadDefaultRunCheck().then(
      (runCheck) => finishOnMainThread(seq, () => runCheck(pixels, moduleCount), workerHealthy),
      (err: unknown) =>
        finishOnMainThread(
          seq,
          () => {
            throw err;
          },
          workerHealthy
        )
    );
  }

  function finishOnMainThread(seq: number, check: () => ScannabilityResult, workerHealthy: boolean) {
    if (!isCurrent(seq)) return;
    let result: ScannabilityResult;
    try {
      result = check();
    } catch (err) {
      console.error('Main-thread fallback processing failed:', err);
      if (isCurrent(seq)) {
        update({ status: 'fail' });
        reportFailure('VALIDATION_ERROR');
        settle(seq, true);
      }
      return;
    }
    applyResult(seq, result, workerHealthy);
  }

  function runWithoutWorker(current: Flight) {
    const { seq, request } = current;
    try {
      if (!isCurrent(seq)) return;
      let pixels = pixelsFromRequest(request);
      if (!pixels && !request.imageData && !request.imageBitmap) {
        const canvas = options.getCanvas?.();
        if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
          conclude(seq, 'idle');
          return;
        }
        pixels = readCanvasPixels();
      }
      if (!pixels) {
        conclude(seq, 'fail');
        return;
      }
      runOnMainThread(seq, pixels, current.moduleCount, true);
    } finally {
      releaseImageHandle(request.imageBitmap);
    }
  }

  // --- canvas capture --------------------------------------------------------

  function sendCanvasPixels(owner: ScannabilityWorkerHandle, current: Flight) {
    const { seq } = current;
    if (!isCurrent(seq)) return;
    const pixels = readCanvasPixels();
    if (!pixels) {
      conclude(seq, 'fail');
      return;
    }
    try {
      post(owner, seq, current.moduleCount, pixels, pixels);
    } catch (err) {
      dispatchFailed(seq, err);
    }
  }

  function captureAndSend(owner: ScannabilityWorkerHandle, current: Flight) {
    const { seq } = current;
    if (!isCurrent(seq) || owner !== worker) return;

    const canvas = options.getCanvas?.();
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
      conclude(seq, 'idle');
      return;
    }

    let capture: Promise<ImageBitmap> | null = null;
    if (!offscreenDegraded) {
      try {
        capture = frames.captureBitmap(canvas);
      } catch {
        capture = null;
      }
    }
    if (!capture) {
      sendCanvasPixels(owner, current);
      return;
    }

    const size = { width: canvas.width, height: canvas.height };
    Promise.resolve(capture).then(
      (bitmap) => {
        if (!isCurrent(seq) || owner !== worker) {
          releaseImageHandle(bitmap);
          return;
        }
        try {
          post(owner, seq, current.moduleCount, bitmap, size);
        } catch (err) {
          dispatchFailed(seq, err, bitmap);
        }
      },
      (err: unknown) => {
        if (!isCurrent(seq) || owner !== worker) return;
        console.error('createImageBitmap failed, falling back to synchronous read:', err);
        sendCanvasPixels(owner, current);
      }
    );
  }

  // --- public surface ----------------------------------------------------------

  function check(request: ScannabilityCheckRequest = {}): Promise<ScannabilityAssessment | null> {
    const { imageData, imageBitmap } = request;
    if (destroyed) {
      releaseImageHandle(imageBitmap);
      return Promise.resolve(null);
    }

    const owner = getWorker();

    // Backpressure: drop frames while the worker is busy and running slower than a display frame.
    if (owner && busy && lastLatency > BACKPRESSURE_LATENCY_MS) {
      releaseImageHandle(imageBitmap);
      return Promise.resolve(null);
    }

    sequence += 1;
    const seq = sequence;
    const current: Flight = {
      seq,
      request,
      moduleCount: positive(request.moduleCount) ?? positive(options.getModuleCount?.()),
    };
    flight = current;
    const answer = new Promise<ScannabilityAssessment | null>((resolve) => pending.set(seq, resolve));
    settle(seq - 1, false);
    update({ status: 'checking' });

    if (!owner) {
      clock.scheduleIdle(() => runWithoutWorker(current), IDLE_TIMEOUT_MS);
      return answer;
    }

    busy = true;
    startedAt = clock.now();
    // Armed before capture so a stalled canvas capture is caught too.
    armWatchdog(seq);

    if (imageBitmap) {
      try {
        post(owner, seq, current.moduleCount, imageBitmap, imageBitmap);
      } catch (err) {
        dispatchFailed(seq, err, imageBitmap);
      }
      return answer;
    }

    if (imageData) {
      try {
        post(owner, seq, current.moduleCount, imageData, imageData);
      } catch (err) {
        dispatchFailed(seq, err);
      }
      return answer;
    }

    clock.scheduleIdle(() => captureAndSend(owner, current), IDLE_TIMEOUT_MS);
    return answer;
  }

  return {
    check,
    setConfig(next) {
      if (next === config) return;
      config = next;
      if (!destroyed) publish();
    },
    getAssessment: () => assessment,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearWatchdog();
      retireWorker();
      busy = false;
      startedAt = null;
      flight = null;
      listeners.clear();
      settle(Number.POSITIVE_INFINITY, false);
    },
  };
}
