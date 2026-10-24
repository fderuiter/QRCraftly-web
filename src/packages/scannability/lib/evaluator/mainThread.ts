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
 * The main-thread fallback (#1601): what the watchdog does when the worker stalls, and how checks
 * run where no worker is available.
 */
import type { PixelFrame, ScannabilityResult } from '../checker';
import { releaseImageHandle } from '../imageHandle';
import { loadPixelCheck } from '../scanCheck';
import { applyResult, conclude, isCurrent, reportFailure, settle, update } from './answer';
import { releaseBusy, runTrailing } from './flight';
import { pixelsFromRequest, readCanvasPixels, sizedCanvas } from './pixels';
import type { EvaluatorState, Flight } from './state';
import { dropWorker } from './worker';

function finishOnMainThread(s: EvaluatorState, seq: number, run: () => ScannabilityResult, workerHealthy: boolean): void {
  if (!isCurrent(s, seq)) return;
  let result: ScannabilityResult;
  try {
    result = run();
  } catch (err) {
    console.error('Main-thread fallback processing failed:', err);
    if (isCurrent(s, seq)) {
      update(s, { status: 'fail' });
      reportFailure(s, 'VALIDATION_ERROR');
      settle(s, seq, true);
    }
    return;
  }
  applyResult(s, seq, result, workerHealthy);
}

/**
 * Runs the check on the main thread: the injected check, or the shared pixel check, loaded on
 * first use with the QR reader (#1178) so pages only download the reader's WebAssembly module
 * when a check has to run here. A failed load is not kept.
 */
function runOnMainThread(s: EvaluatorState, seq: number, pixels: PixelFrame, moduleCount: number | undefined, quietZoneModules: number | undefined, workerHealthy: boolean): void {
  if (!isCurrent(s, seq)) return;
  const injected = s.options.runCheck;
  if (injected) {
    finishOnMainThread(s, seq, () => injected(pixels, moduleCount, quietZoneModules), workerHealthy);
    return;
  }
  loadPixelCheck().then(
    (runCheck) => finishOnMainThread(s, seq, () => runCheck(pixels, moduleCount, quietZoneModules), workerHealthy),
    (err: unknown) =>
      finishOnMainThread(
        s,
        seq,
        () => {
          throw err;
        },
        workerHealthy
      )
  );
}

/** The watchdog fired for `seq`: count the timeout, and answer on the main thread. */
export function onWatchdog(s: EvaluatorState, seq: number): void {
  if (!isCurrent(s, seq)) return;
  if (s.flight.watchdog?.seq === seq) s.flight.watchdog = null;
  releaseBusy(s);
  s.flight.consecutiveTimeouts += 1;
  update(s, { recovery: true });
  if (s.flight.consecutiveTimeouts > 1) dropWorker(s);
  if (runTrailing(s)) return;

  const current = s.flight.current && s.flight.current.seq === seq ? s.flight.current : null;
  const pixels = (current && pixelsFromRequest(s, current.request)) || readCanvasPixels(s);
  if (!pixels) {
    conclude(s, seq, 'fail');
    return;
  }
  runOnMainThread(s, seq, pixels, current?.moduleCount, current?.quietZoneModules, false);
}

/** Answers a request on the main thread because no worker is available. */
export function runWithoutWorker(s: EvaluatorState, current: Flight): void {
  const { seq, request } = current;
  try {
    if (!isCurrent(s, seq)) return;
    let pixels = pixelsFromRequest(s, request);
    if (!pixels && !request.imageData && !request.imageBitmap) {
      if (!sizedCanvas(s)) {
        conclude(s, seq, 'idle');
        return;
      }
      pixels = readCanvasPixels(s);
    }
    if (!pixels) {
      conclude(s, seq, 'fail');
      return;
    }
    runOnMainThread(s, seq, pixels, current.moduleCount, current.quietZoneModules, true);
  } finally {
    releaseImageHandle(request.imageBitmap);
  }
}
