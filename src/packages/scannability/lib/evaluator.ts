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
 * The Scannability Health Evaluator (#940): its public types and the factory that wires the
 * evaluator/* modules together (#1601). The state lives in evaluator/state.ts; the worker
 * connection, the flight tracker, the main-thread fallback and canvas capture each have a module.
 */
import type { QRConfig } from '@/packages/core/types';
import type { PixelFrame, ScannabilityResult } from './checker';
import type { HealthScore } from './scoring';
import type { ExportRisk, ScannabilityStatus } from './exportRiskPolicy';
import { releaseImageHandle } from './imageHandle';
import type { ScannabilityWorkerFactory } from './workerFactory';
import { publish, settle, update } from './evaluator/answer';
import { BACKPRESSURE_LATENCY_MS, IDLE_TIMEOUT_MS, positive } from './evaluator/defaults';
import { armRecheck, armWatchdog, clearRecheck, clearWatchdog, releaseBusy, releaseTrailing } from './evaluator/flight';
import { onWatchdog, runWithoutWorker } from './evaluator/mainThread';
import { createEvaluatorState, type EvaluatorState, type Flight } from './evaluator/state';
import { sendToWorker } from './evaluator/capture';
import { getWorker, retireWorker } from './evaluator/worker';

export { assessScannability } from './evaluator/defaults';

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
  /** Quiet zone margin in modules. */
  quietZoneModules?: number;
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
  runCheck?: (frame: PixelFrame, moduleCount?: number, quietZoneModules?: number) => ScannabilityResult;
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

/**
 * Starts a check: holds it back under backpressure, or numbers it, marks the answer as checking
 * and hands it to the worker or the main thread.
 */
function startCheck(s: EvaluatorState, request: ScannabilityCheckRequest): Promise<ScannabilityAssessment | null> {
  if (s.destroyed) {
    releaseImageHandle(request.imageBitmap);
    return Promise.resolve(null);
  }
  clearRecheck(s);
  const owner = getWorker(s);

  // Backpressure: while the worker is busy and running slower than a display frame, hold only
  // the newest check (releasing any older held one) and run it when the in-flight check ends.
  if (owner && s.flight.busy && s.flight.lastLatency > BACKPRESSURE_LATENCY_MS) {
    releaseTrailing(s);
    return new Promise<ScannabilityAssessment | null>((resolve) => {
      s.flight.trailing = { request, resolve };
    });
  }

  s.flight.sequence += 1;
  const seq = s.flight.sequence;
  const current: Flight = {
    seq,
    request,
    moduleCount: positive(request.moduleCount) ?? positive(s.options.getModuleCount?.()),
    quietZoneModules: request.quietZoneModules ?? s.answer.config.quietZoneModules ?? 4,
  };
  s.flight.current = current;
  const answer = new Promise<ScannabilityAssessment | null>((resolve) => s.answer.pending.set(seq, resolve));
  settle(s, seq - 1, false);
  update(s, { status: 'checking' });

  if (!owner) {
    s.clock.scheduleIdle(() => runWithoutWorker(s, current), IDLE_TIMEOUT_MS);
    return answer;
  }
  s.flight.busy = true;
  s.flight.startedAt = s.clock.now();
  // Armed before capture so a stalled canvas capture is caught too.
  armWatchdog(s, seq);
  sendToWorker(s, owner, current);
  return answer;
}

/**
 * Creates a Scannability Health Evaluator. No worker is spawned until the first check.
 */
export function createScannabilityEvaluator(options: ScannabilityEvaluatorConfig): ScannabilityEvaluator {
  const s = createEvaluatorState(options);
  const check = (request: ScannabilityCheckRequest = {}) => startCheck(s, request);
  s.check = check;
  s.onWatchdog = (seq) => onWatchdog(s, seq);

  return {
    check,
    setConfig(next) {
      if (next === s.answer.config) return;
      s.answer.config = next;
      if (s.destroyed) return;
      // Every request posted so far describes the previous design (#1250).
      s.flight.staleThrough = s.flight.sequence;
      releaseTrailing(s);
      if (s.answer.status === 'idle') {
        publish(s);
        return;
      }
      // Show "checking" until the new design has its own verdict, and check the canvas if the
      // caller sends no check for it.
      if (s.answer.status === 'checking') publish(s);
      else update(s, { status: 'checking' });
      armRecheck(s);
    },
    getAssessment: () => s.answer.assessment,
    subscribe(listener) {
      s.answer.listeners.add(listener);
      return () => {
        s.answer.listeners.delete(listener);
      };
    },
    destroy() {
      if (s.destroyed) return;
      s.destroyed = true;
      clearWatchdog(s);
      clearRecheck(s);
      retireWorker(s);
      releaseBusy(s);
      s.flight.current = null;
      releaseTrailing(s);
      s.answer.listeners.clear();
      settle(s, Number.POSITIVE_INFINITY, false);
    },
  };
}
