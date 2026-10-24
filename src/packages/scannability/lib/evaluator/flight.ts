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
 * The flight tracker (#1601): the watchdog around the request in flight, the recheck after a
 * design change, and the trailing check held back by backpressure.
 */
import { releaseImageHandle } from '../imageHandle';
import { RECHECK_AFTER_CHANGE_MS, SCANNABILITY_WATCHDOG_MS } from './defaults';
import type { EvaluatorState } from './state';

/** Cancels the watchdog, or only the one armed for `seq`. */
export function clearWatchdog(s: EvaluatorState, seq?: number): void {
  const { watchdog } = s.flight;
  if (watchdog && (seq === undefined || watchdog.seq === seq)) {
    s.clock.clearTimeout(watchdog.handle);
    s.flight.watchdog = null;
  }
}

/** Arms the watchdog for `seq`, replacing any other. */
export function armWatchdog(s: EvaluatorState, seq: number): void {
  clearWatchdog(s);
  const handle = s.clock.setTimeout(() => s.onWatchdog(seq), SCANNABILITY_WATCHDOG_MS);
  s.flight.watchdog = { handle, seq };
}

/** Releases backpressure without ending the request. */
export function releaseBusy(s: EvaluatorState): void {
  s.flight.busy = false;
  s.flight.startedAt = null;
}

/** Ends the request `seq`: releases backpressure and its watchdog. */
export function endFlight(s: EvaluatorState, seq: number): void {
  releaseBusy(s);
  clearWatchdog(s, seq);
}

export function clearRecheck(s: EvaluatorState): void {
  if (s.flight.recheck === null) return;
  s.clock.clearTimeout(s.flight.recheck);
  s.flight.recheck = null;
}

/** Checks the canvas after a design change unless a check for the new design arrives first. */
export function armRecheck(s: EvaluatorState): void {
  clearRecheck(s);
  s.flight.recheck = s.clock.setTimeout(() => {
    s.flight.recheck = null;
    if (!s.destroyed) void s.check();
  }, RECHECK_AFTER_CHANGE_MS);
}

/** Releases the waiting trailing check, if any, and resolves its caller with null. */
export function releaseTrailing(s: EvaluatorState): void {
  const { trailing } = s.flight;
  if (!trailing) return;
  s.flight.trailing = null;
  releaseImageHandle(trailing.request.imageBitmap);
  trailing.resolve(null);
}

/**
 * Starts the waiting trailing check, if any. The in-flight request then resolves with null
 * and its verdict is never published, because it describes an older design.
 * @returns Whether a trailing check started.
 */
export function runTrailing(s: EvaluatorState): boolean {
  const { trailing } = s.flight;
  if (!trailing || s.destroyed) return false;
  s.flight.trailing = null;
  s.check(trailing.request).then(trailing.resolve, () => trailing.resolve(null));
  return true;
}
