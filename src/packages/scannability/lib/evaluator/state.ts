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
 * The evaluator's state (#1601), as three explicit objects instead of one closure's variables:
 * the published answer, the request in flight and the worker connection. The evaluator/* modules
 * take this object; the factory in ../evaluator.ts wires them together.
 */
import type { QRConfig } from '@/packages/core/types';
import type { ScannabilityStatus } from '../exportRiskPolicy';
import type { ScannabilityWorkerFactory, ScannabilityWorkerHandle } from '../workerFactory';
import type {
  ScannabilityAssessment,
  ScannabilityCheckRequest,
  ScannabilityClock,
  ScannabilityEvaluatorConfig,
  ScannabilityFrameReader,
} from '../evaluator';
import { assessScannability, defaultFrameReader, systemScannabilityClock, type LocalMetrics } from './defaults';
import { connectScannabilityWorker } from '../workerFactory';

type Resolve = (assessment: ScannabilityAssessment | null) => void;

/** One posted request and the parameters it was posted with. */
export interface Flight {
  seq: number;
  request: ScannabilityCheckRequest;
  moduleCount: number | undefined;
  quietZoneModules: number | undefined;
}

/** What callers see: the latest assessment, its inputs, and who waits for it. */
export interface AnswerState {
  config: QRConfig;
  status: ScannabilityStatus;
  localMetrics: LocalMetrics | undefined;
  workerRecoveryActive: boolean;
  assessment: ScannabilityAssessment;
  readonly listeners: Set<(assessment: ScannabilityAssessment) => void>;
  /** Callers waiting on a request, by sequence number. */
  readonly pending: Map<number, Resolve>;
}

/** Request sequencing, backpressure and the timers around the request in flight. */
export interface FlightState {
  sequence: number;
  busy: boolean;
  startedAt: number | null;
  lastLatency: number;
  consecutiveTimeouts: number;
  watchdog: { handle: number; seq: number } | null;
  current: Flight | null;
  /**
   * The newest check dropped by backpressure. It runs as soon as the in-flight check ends, in
   * place of that check's (now outdated) verdict, so the latest design is always checked (#1250).
   */
  trailing: { request: ScannabilityCheckRequest; resolve: Resolve } | null;
  /**
   * Requests up to this sequence were posted for a design that has since changed: their answers
   * are never published as the verdict for the design on screen (#1250).
   */
  staleThrough: number;
  /** Checks the canvas if no check arrives for the new design after a change. */
  recheck: number | null;
}

/** The Scannability Worker, the one being retired, and what it is known not to support. */
export interface WorkerState {
  readonly create: ScannabilityWorkerFactory;
  handle: ScannabilityWorkerHandle | null;
  unsupported: boolean;
  retiring: { owner: ScannabilityWorkerHandle; handle: number } | null;
  /** Worker Degradation Cache: this worker cannot draw bitmaps, so send pixels. */
  offscreenDegraded: boolean;
}

export interface EvaluatorState {
  readonly options: ScannabilityEvaluatorConfig;
  readonly clock: ScannabilityClock;
  readonly frames: ScannabilityFrameReader;
  readonly answer: AnswerState;
  readonly flight: FlightState;
  readonly worker: WorkerState;
  destroyed: boolean;
  /** The public check, for trailing checks and rechecks. Set by the factory. */
  check: (request?: ScannabilityCheckRequest) => Promise<ScannabilityAssessment | null>;
  /** What happens when the watchdog fires. Set by the factory. */
  onWatchdog: (seq: number) => void;
}

/**
 * Builds the initial state from the evaluator's options.
 * @param options - The evaluator's configuration.
 * @returns State for an idle evaluator with no worker yet.
 */
export function createEvaluatorState(options: ScannabilityEvaluatorConfig): EvaluatorState {
  const notWired = () => {
    throw new Error('The Scannability evaluator is not wired yet.');
  };
  return {
    options,
    clock: options.clock ?? systemScannabilityClock,
    frames: options.frames ?? defaultFrameReader,
    answer: {
      config: options.config,
      status: 'idle',
      localMetrics: undefined,
      workerRecoveryActive: false,
      assessment: assessScannability('idle', options.config, undefined, false),
      listeners: new Set(),
      pending: new Map(),
    },
    flight: {
      sequence: 0,
      busy: false,
      startedAt: null,
      lastLatency: 0,
      consecutiveTimeouts: 0,
      watchdog: null,
      current: null,
      trailing: null,
      staleThrough: 0,
      recheck: null,
    },
    worker: { create: options.createWorker ?? connectScannabilityWorker, handle: null, unsupported: false, retiring: null, offscreenDegraded: false },
    destroyed: false,
    check: notWired,
    onWatchdog: notWired,
  };
}
