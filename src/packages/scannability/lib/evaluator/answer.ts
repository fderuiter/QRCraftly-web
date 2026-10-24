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
 * Answer bookkeeping (#1601): publishing the assessment, resolving the callers waiting on a
 * request, and turning a check result or a bare outcome into the published answer.
 */
import type { ScannabilityResult } from '../checker';
import type { ScannabilityStatus } from '../exportRiskPolicy';
import { assessScannability, toStatus, type LocalMetrics } from './defaults';
import { endFlight } from './flight';
import type { EvaluatorState } from './state';

/** Recomputes the assessment and tells every listener. */
export function publish(s: EvaluatorState): void {
  const a = s.answer;
  a.assessment = assessScannability(a.status, a.config, a.localMetrics, a.workerRecoveryActive);
  for (const listener of [...a.listeners]) listener(a.assessment);
}

/** Applies the parts of the answer that changed, and publishes when anything did. */
export function update(s: EvaluatorState, next: { status?: ScannabilityStatus; localMetrics?: LocalMetrics; recovery?: boolean }): void {
  const a = s.answer;
  let changed = false;
  if (next.status !== undefined && next.status !== a.status) {
    a.status = next.status;
    changed = true;
  }
  if (
    next.localMetrics !== undefined &&
    (next.localMetrics.violations !== a.localMetrics?.violations || next.localMetrics.minContrast !== a.localMetrics?.minContrast)
  ) {
    a.localMetrics = next.localMetrics;
    changed = true;
  }
  if (next.recovery !== undefined && next.recovery !== a.workerRecoveryActive) {
    a.workerRecoveryActive = next.recovery;
    changed = true;
  }
  if (changed && !s.destroyed) publish(s);
}

/** Resolves the request `seq` (with the current answer, or null) and every older request (null). */
export function settle(s: EvaluatorState, seq: number, answered: boolean): void {
  for (const [pendingSeq, resolve] of s.answer.pending) {
    if (pendingSeq > seq) continue;
    s.answer.pending.delete(pendingSeq);
    resolve(pendingSeq === seq && answered ? s.answer.assessment : null);
  }
}

export function reportFailure(s: EvaluatorState, errorType: string): void {
  try {
    s.options.onFail?.(errorType);
  } catch (err) {
    console.error('Scannability failure listener threw:', err);
  }
}

export const isCurrent = (s: EvaluatorState, seq: number): boolean => !s.destroyed && seq === s.flight.sequence;

/**
 * Ends a request posted before the design changed without publishing its verdict.
 * @returns Whether the request was outdated.
 */
export function dropIfOutdated(s: EvaluatorState, seq: number): boolean {
  if (seq > s.flight.staleThrough) return false;
  endFlight(s, seq);
  settle(s, seq, false);
  return true;
}

/** Publishes a check result for the current request. */
export function applyResult(s: EvaluatorState, seq: number, result: ScannabilityResult, workerHealthy: boolean): void {
  if (!isCurrent(s, seq)) return;
  if (dropIfOutdated(s, seq)) {
    if (workerHealthy) update(s, { recovery: false });
    return;
  }
  update(s, {
    status: toStatus(result),
    localMetrics:
      result.localContrastViolations !== undefined
        ? { violations: result.localContrastViolations, minContrast: result.minLocalContrast }
        : undefined,
    recovery: workerHealthy ? false : undefined,
  });
  if (!result.success && result.error) reportFailure(s, result.error);
  settle(s, seq, true);
}

/** Ends the current request without a verdict of its own (`idle`) or with a bare failure. */
export function conclude(s: EvaluatorState, seq: number, outcome: 'idle' | 'fail'): void {
  if (!isCurrent(s, seq) || dropIfOutdated(s, seq)) return;
  endFlight(s, seq);
  update(s, { status: outcome });
  settle(s, seq, outcome === 'fail');
}
