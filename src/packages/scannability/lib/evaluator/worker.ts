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
 * The worker connection (#1601): creating the Scannability Worker, posting frames to it, handling
 * its answers and errors, and retiring it without killing it mid-frame.
 */
import type { PixelFrame } from '../checker';
import type { ScannabilityCanvas } from '../evaluator';
import { releaseImageHandle } from '../imageHandle';
import { assertWorkerRequest, isWorkerResponse } from '../sharedContract';
import type { ScannabilityWorkerHandle } from '../workerFactory';
import { applyResult, conclude, dropIfOutdated, reportFailure, settle, update } from './answer';
import { SCANNABILITY_WATCHDOG_MS } from './defaults';
import { armWatchdog, clearWatchdog, endFlight, releaseBusy, runTrailing } from './flight';
import { convertBitmap, readCanvasPixels } from './pixels';
import type { EvaluatorState, Flight } from './state';

/** The worker, created on first use; null where workers are unavailable. */
export function getWorker(s: EvaluatorState): ScannabilityWorkerHandle | null {
  const w = s.worker;
  if (s.destroyed || w.unsupported) return null;
  if (w.handle) return w.handle;
  let owner: ScannabilityWorkerHandle | null = null;
  try {
    owner = w.create({
      onMessage: (data) => handleMessage(s, owner, data),
      onError: (reason) => handleWorkerError(s, owner, reason),
    });
  } catch (err) {
    console.error('Failed to initialize the Scannability Worker, using the main thread:', err);
    owner = null;
  }
  if (!owner) {
    w.unsupported = true;
    return null;
  }
  w.handle = owner;
  return owner;
}

export function dropWorker(s: EvaluatorState): void {
  s.worker.handle?.terminate();
  s.worker.handle = null;
}

function finishRetire(s: EvaluatorState): void {
  const { retiring } = s.worker;
  if (!retiring) return;
  s.clock.clearTimeout(retiring.handle);
  retiring.owner.terminate();
  s.worker.retiring = null;
}

/**
 * Terminates the worker once its in-flight frame is answered, or after the watchdog
 * window. Killing a worker while it draws a transferred ImageBitmap can crash WebKit's
 * web process on hosts without GPU sync support, taking the whole page down.
 */
export function retireWorker(s: EvaluatorState): void {
  const owner = s.worker.handle;
  s.worker.handle = null;
  if (!owner) return;
  if (!s.flight.busy) {
    owner.terminate();
    return;
  }
  s.worker.retiring = { owner, handle: s.clock.setTimeout(() => finishRetire(s), SCANNABILITY_WATCHDOG_MS) };
}

/** Posts one frame for request `seq`, transferring its buffer or bitmap. */
export function post(owner: ScannabilityWorkerHandle, seq: number, moduleCount: number | undefined, quietZoneModules: number | undefined, frame: PixelFrame | ImageBitmap, size: ScannabilityCanvas): void {
  const base = {
    width: size.width,
    height: size.height,
    configId: String(seq),
    moduleCount,
    quietZoneModules,
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

/**
 * Posts a frame for a request, failing the request if the frame is refused.
 * @returns Whether the frame was posted.
 */
export function postOrFail(
  s: EvaluatorState,
  owner: ScannabilityWorkerHandle,
  target: Pick<Flight, 'seq' | 'moduleCount' | 'quietZoneModules'>,
  frame: PixelFrame | ImageBitmap,
  size: ScannabilityCanvas,
  ownedBitmap?: ImageBitmap
): boolean {
  try {
    post(owner, target.seq, target.moduleCount, target.quietZoneModules, frame, size);
    return true;
  } catch (err) {
    console.error('Outgoing worker request validation failed:', err);
    releaseImageHandle(ownedBitmap);
    conclude(s, target.seq, 'fail');
    return false;
  }
}

function handleWorkerError(s: EvaluatorState, owner: ScannabilityWorkerHandle | null, reason: unknown): void {
  if (owner && owner === s.worker.retiring?.owner) {
    finishRetire(s);
    return;
  }
  if (!owner || owner !== s.worker.handle) return;
  const seq = s.flight.sequence;
  console.error('Worker error, transitioning immediately to fail state:', reason);
  dropWorker(s);
  endFlight(s, seq);
  clearWatchdog(s);
  if (s.flight.trailing) {
    update(s, { recovery: true });
    reportFailure(s, 'WORKER_ERROR');
    runTrailing(s);
    return;
  }
  if (dropIfOutdated(s, seq)) {
    update(s, { recovery: true });
    reportFailure(s, 'WORKER_ERROR');
    return;
  }
  update(s, { status: 'fail', recovery: true });
  reportFailure(s, 'WORKER_ERROR');
  settle(s, seq, true);
}

function handleMessage(s: EvaluatorState, owner: ScannabilityWorkerHandle | null, data: unknown): void {
  if (owner && owner === s.worker.retiring?.owner) {
    finishRetire(s);
    return;
  }
  if (!owner || owner !== s.worker.handle || s.destroyed) return;
  const seq = s.flight.sequence;
  if (!isWorkerResponse(data)) {
    console.error('Worker response validation failed:', data);
    endFlight(s, seq);
    clearWatchdog(s);
    if (!dropIfOutdated(s, seq)) update(s, { status: 'fail' });
    reportFailure(s, 'VALIDATION_ERROR');
    settle(s, seq, true);
    return;
  }

  const { configId } = data;
  // Untracked messages carry no request identity; ignore them without touching flight state.
  if (!configId) return;

  // Superseded ACK: release backpressure; only the current request falls back to idle.
  if ('dropped' in data && data.dropped) {
    releaseBusy(s);
    if (runTrailing(s)) return;
    if (configId === String(seq)) conclude(s, seq, 'idle');
    return;
  }

  // Late result for an older request: release backpressure, keep the current status.
  if (configId !== String(seq)) {
    releaseBusy(s);
    runTrailing(s);
    return;
  }

  clearWatchdog(s, seq);

  if ('retryWithImageData' in data && data.retryWithImageData) {
    // Worker Degradation Cache: this worker cannot draw bitmaps, so send pixels from now on.
    s.worker.offscreenDegraded = true;
    // Resend the request's own frame (the worker hands its bitmap back); the preview canvas
    // is only a fallback for a worker that did not.
    const pixels = ('imageBitmap' in data && data.imageBitmap ? convertBitmap(s, data.imageBitmap) : null) ?? readCanvasPixels(s);
    if (!pixels) {
      conclude(s, seq, 'fail');
      return;
    }
    const { current } = s.flight;
    if (postOrFail(s, owner, { seq, moduleCount: current?.moduleCount, quietZoneModules: current?.quietZoneModules }, pixels, pixels)) armWatchdog(s, seq);
    return;
  }

  if (!('success' in data)) return;
  if (s.flight.startedAt !== null) {
    s.flight.lastLatency = s.clock.now() - s.flight.startedAt;
  }
  endFlight(s, seq);
  s.flight.consecutiveTimeouts = 0;
  if (runTrailing(s)) return;
  applyResult(s, seq, data, true);
}
