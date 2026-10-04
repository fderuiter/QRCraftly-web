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

/**
 * Decoder pool (#1142): sizing from the device's cores and a job queue that drops superseded
 * frames. The pool does not own workers; the caller gives it a `run` function per job (a worker
 * round trip, a crop decode) so the scheduling is testable without a browser.
 */

export interface PoolSizeOptions {
  /** Fewest workers (default 2). */
  min?: number;
  /** Most workers (default 4). */
  max?: number;
}

/**
 * Workers to run, from `navigator.hardwareConcurrency`. Half the cores, so the main thread and the
 * camera pipeline keep theirs, kept between 2 and 4.
 * @param hardwareConcurrency - Logical cores; undefined when the browser does not say.
 * @param options - Bounds.
 * @returns The worker count.
 */
export function decoderPoolSize(hardwareConcurrency: number | undefined, options: PoolSizeOptions = {}): number {
  const min = Math.max(1, options.min ?? 2);
  const max = Math.max(min, options.max ?? 4);
  if (!hardwareConcurrency || !Number.isFinite(hardwareConcurrency)) return min;
  return Math.min(max, Math.max(min, Math.floor(hardwareConcurrency / 2)));
}

export interface DecoderPoolOptions<Job, Result> {
  /** Workers running jobs at once. */
  size: number;
  /** Runs one job. `worker` is the slot, 0 to size - 1, so a caller can keep one real worker per slot. */
  run: (job: Job, worker: number) => Promise<Result>;
  /**
   * Receives each result. The third argument is true when a newer frame was submitted while this job
   * ran; the symbols in it are still good, so the result is delivered, and a caller that only wants
   * the newest may ignore it.
   */
  onResult: (result: Result, frameId: number, superseded: boolean) => void;
  onError?: (error: unknown, frameId: number) => void;
}

export interface DecoderPoolStats {
  submitted: number;
  completed: number;
  /** Jobs removed from the queue because a newer frame replaced their frame. */
  dropped: number;
  failed: number;
  inFlight: number;
  queued: number;
}

export interface DecoderPool<Job> {
  /**
   * Queues the jobs of one camera frame. Jobs of older frames that have not started are dropped.
   * @param frameId - Increases with every camera frame.
   * @param jobs - The crops (or whole-frame search) of this frame.
   */
  submit(frameId: number, jobs: readonly Job[]): void;
  /** Resolves when nothing is queued or running. */
  idle(): Promise<void>;
  stats(): DecoderPoolStats;
}

interface Queued<Job> {
  frameId: number;
  job: Job;
}

/**
 * Creates a pool.
 * @param options - Size, runner and result callbacks.
 * @returns The pool.
 */
export function createDecoderPool<Job, Result>(options: DecoderPoolOptions<Job, Result>): DecoderPool<Job> {
  const size = Math.max(1, Math.floor(options.size));
  let queue: Queued<Job>[] = [];
  let newestFrame = Number.NEGATIVE_INFINITY;
  const free: number[] = Array.from({ length: size }, (_, slot) => slot).reverse();
  const counters = { submitted: 0, completed: 0, dropped: 0, failed: 0, inFlight: 0 };
  let waiters: Array<() => void> = [];

  const settle = (): void => {
    if (counters.inFlight > 0 || queue.length > 0) return;
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  };

  const pump = (): void => {
    while (free.length > 0 && queue.length > 0) {
      const slot = free.pop();
      const next = queue.shift();
      if (slot === undefined || !next) return;
      counters.inFlight += 1;
      options
        .run(next.job, slot)
        .then(
          (result) => {
            counters.completed += 1;
            options.onResult(result, next.frameId, next.frameId < newestFrame);
          },
          (error: unknown) => {
            counters.failed += 1;
            options.onError?.(error, next.frameId);
          }
        )
        .finally(() => {
          counters.inFlight -= 1;
          free.push(slot);
          pump();
          settle();
        });
    }
  };

  return {
    submit(frameId, jobs) {
      if (frameId < newestFrame) {
        counters.dropped += jobs.length;
        return;
      }
      newestFrame = frameId;
      const kept = queue.filter((entry) => entry.frameId >= frameId);
      counters.dropped += queue.length - kept.length;
      queue = kept;
      for (const job of jobs) queue.push({ frameId, job });
      counters.submitted += jobs.length;
      pump();
    },
    idle() {
      if (counters.inFlight === 0 && queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
    stats() {
      return { ...counters, queued: queue.length };
    },
  };
}
