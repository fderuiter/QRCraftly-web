import { DoubleBufferPool } from './bufferPool';
import { systemClock, type ScannerClock } from './clock';

export interface SchedulerOptions<TDetail = unknown> {
  minSamplingDelay?: number;
  maxSamplingDelay?: number;
  onStatusChange?: (status: 'idle' | 'checking' | 'pass' | 'fail') => void;
  onDelayChange?: (delay: number) => void;
  onLatencyHistoryChange?: (history: number[]) => void;
  /** A decoded frame; `detail` is whatever the caller passed to `endFrame` with it. */
  onScanSuccess?: (data: string, detail?: TDetail) => void;
  onScanFail?: (error?: string) => void;
  onWatchdogTriggered?: (elapsed: number) => void;
  /** Time source; defaults to the system clock. Tests inject a fake clock. */
  clock?: Pick<ScannerClock, 'now' | 'setTimeout' | 'clearTimeout'>;
}

const WATCHDOG_POLL_MS = 100;
/**
 * Default hang budget: how long the worker may stay silent with a frame in flight. One reader pass
 * on a slow phone can take a second or two, so only a far longer silence counts as a hang (#1096).
 */
export const DEFAULT_WATCHDOG_TIMEOUT_MS = 5000;
/** Target sampling delay as a multiple of the median decode latency. */
const LATENCY_HEADROOM = 1.2;
/** Share of the gap to a higher target closed per frame. */
const RISE_SMOOTHING = 0.5;

/**
 * Backpressure-driven adaptive sampling controller.
 * Modulates frame rate based on worker latency and trips recovery upon starvation stalls.
 */
export class AdaptiveFrameScheduler<TDetail = unknown> {
  public pool: DoubleBufferPool;
  private minSamplingDelay: number;
  private maxSamplingDelay: number;
  private samplingDelay = 33; // Start at ~30 FPS (33ms)
  private latencyHistory: number[] = [];
  private inFlight = false;
  private inFlightStart: number | null = null;
  private watchdogTimer: number | null = null;
  private readonly clock: Pick<ScannerClock, 'now' | 'setTimeout' | 'clearTimeout'>;
  private sequenceId = 0;
  private completedSequenceId = 0;
  private startTimeMap = new Map<number, number>();
  private options: SchedulerOptions<TDetail>;
  private watchdogTimeout = DEFAULT_WATCHDOG_TIMEOUT_MS;
  /** Last sign of life from the worker (any answer, stale ones included). */
  private lastHeartbeat: number | null = null;

  // Background tab visibility tracking state
  private isPaused = false;
  private pauseStartTime: number | null = null;
  private handleVisibilityChange: (() => void) | null = null;

  constructor(options: SchedulerOptions<TDetail> = {}) {
    this.options = options;
    this.clock = options.clock ?? systemClock;
    this.minSamplingDelay = options.minSamplingDelay ?? 16;
    this.maxSamplingDelay = options.maxSamplingDelay ?? 1000;
    this.pool = new DoubleBufferPool();
  }

  /**
   * Resets and starts the scheduler.
   */
  public start() {
    this.inFlight = false;
    this.inFlightStart = null;
    this.sequenceId = 0;
    this.completedSequenceId = 0;
    this.startTimeMap.clear();
    this.latencyHistory = [];
    this.watchdogTimeout = DEFAULT_WATCHDOG_TIMEOUT_MS;
    this.lastHeartbeat = null;
    this.setupVisibilityListener();
    this.startWatchdog();
  }

  /**
   * Stops the scheduler and cleans up.
   */
  public stop() {
    this.stopWatchdog();
    this.removeVisibilityListener();
    this.isPaused = false;
    this.pauseStartTime = null;
    this.inFlight = false;
    this.inFlightStart = null;
    this.startTimeMap.clear();
    this.pool.clear();
  }

  private setupVisibilityListener() {
    this.removeVisibilityListener();

    if (typeof document !== 'undefined') {
      this.handleVisibilityChange = () => {
        if (document.hidden) {
          this.pauseWatchdog();
        } else {
          this.resumeWatchdog();
        }
      };

      document.addEventListener('visibilitychange', this.handleVisibilityChange);

      if (document.hidden) {
        this.pauseWatchdog();
      } else {
        this.isPaused = false;
        this.pauseStartTime = null;
      }
    }
  }

  private removeVisibilityListener() {
    if (typeof document !== 'undefined' && this.handleVisibilityChange) {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      this.handleVisibilityChange = null;
    }
  }

  private pauseWatchdog() {
    if (!this.isPaused) {
      this.isPaused = true;
      this.pauseStartTime = this.clock.now();
    }
  }

  private resumeWatchdog() {
    if (this.isPaused && this.pauseStartTime !== null) {
      const now = this.clock.now();
      const pauseStartTime = this.pauseStartTime;
      const pauseDuration = now - pauseStartTime;

      if (this.inFlightStart !== null) {
        if (this.inFlightStart <= pauseStartTime) {
          this.inFlightStart += pauseDuration;
        } else {
          this.inFlightStart = now;
        }
      }

      for (const [seqId, startTime] of this.startTimeMap.entries()) {
        if (startTime <= pauseStartTime) {
          this.startTimeMap.set(seqId, startTime + pauseDuration);
        } else {
          this.startTimeMap.set(seqId, now);
        }
      }

      this.isPaused = false;
      this.pauseStartTime = null;
    }
  }

  private getShiftedTimestamp(t: number, now = this.clock.now()): number {
    if (!this.isPaused || this.pauseStartTime === null) {
      return t;
    }
    if (t <= this.pauseStartTime) {
      return t + (now - this.pauseStartTime);
    } else {
      return now;
    }
  }

  /**
   * Begins a new frame processing request.
   * Returns a unique sequence ID, or null if backpressure blocks request.
   */
  public beginFrame(force = false): number | null {
    if (this.inFlight && !force) {
      return null;
    }

    this.sequenceId += 1;
    const seqId = this.sequenceId;

    this.inFlight = true;
    this.inFlightStart = this.clock.now();
    this.startTimeMap.set(seqId, this.clock.now());
    this.options.onStatusChange?.('checking');

    return seqId;
  }

  /**
   * Completes a frame request, dynamically adjusting capture intervals and recycling buffers.
   */
  public endFrame(
    sequenceId: number,
    status: 'pass' | 'fail',
    decodedData?: string | null,
    error?: string | null,
    recycledBuffer?: ArrayBuffer,
    detail?: TDetail
  ) {
    if (recycledBuffer) {
      this.pool.release(recycledBuffer);
    }

    if (error === 'STALE_FRAME') {
      this.startTimeMap.delete(sequenceId);
      if (sequenceId > this.completedSequenceId) {
        this.completedSequenceId = sequenceId;
        this.inFlight = false;
        this.inFlightStart = null;
      }
      return;
    }

    const rawStartTime = this.startTimeMap.get(sequenceId);
    if (rawStartTime !== undefined) {
      this.startTimeMap.delete(sequenceId);
      const endTime = this.clock.now();
      const startTime = this.isPaused ? this.getShiftedTimestamp(rawStartTime, endTime) : rawStartTime;
      const duration = endTime - startTime;

      if (sequenceId <= this.completedSequenceId) {
        return;
      }
      this.completedSequenceId = sequenceId;

      const updatedHistory = [...this.latencyHistory, duration];
      if (updatedHistory.length > 5) {
        updatedHistory.shift();
      }
      this.latencyHistory = updatedHistory;
      this.options.onLatencyHistoryChange?.(updatedHistory);

      if (status === 'pass') {
        if (decodedData) {
          this.options.onScanSuccess?.(decodedData, detail);
        }
      } else if (status === 'fail') {
        this.options.onScanFail?.(error || undefined);
      }

      // Compute 5-frame median latency
      const sorted = [...updatedHistory].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const medianLatency =
        sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];

      // Pace towards the measured latency (#1096): the target is 1.2x the 5-frame median, so the
      // worker is busy a little under half the time. Rising is smoothed (one slow frame cannot
      // spike the delay); falling is immediate, so sampling speeds up as soon as decodes do.
      // The old rule added 50 ms on every slow frame and ratcheted towards 1 fps.
      const target = Math.min(
        this.maxSamplingDelay,
        Math.max(this.minSamplingDelay, Math.round(medianLatency * LATENCY_HEADROOM))
      );
      const nextDelay =
        target >= this.samplingDelay
          ? Math.min(this.maxSamplingDelay, Math.round(this.samplingDelay + (target - this.samplingDelay) * RISE_SMOOTHING))
          : target;
      this.samplingDelay = nextDelay;
      this.options.onDelayChange?.(nextDelay);
      this.options.onStatusChange?.(status);

      this.inFlight = false;
      this.inFlightStart = null;
    }
  }

  /**
   * Updates the adaptive sampling bounds without resetting in-flight state.
   */
  public setSamplingBounds(minSamplingDelay: number, maxSamplingDelay: number) {
    this.minSamplingDelay = minSamplingDelay;
    this.maxSamplingDelay = maxSamplingDelay;
  }

  public setWatchdogTimeout(timeout: number) {
    this.watchdogTimeout = timeout;
  }

  public getWatchdogTimeout(): number {
    return this.watchdogTimeout;
  }

  /** Records a sign of life from the worker; the watchdog measures silence from the latest one. */
  public heartbeat() {
    this.lastHeartbeat = this.clock.now();
  }

  public checkWatchdog(): boolean {
    if (this.isPaused) {
      return false;
    }
    if (this.inFlight && this.inFlightStart !== null) {
      const since = this.lastHeartbeat !== null ? Math.max(this.inFlightStart, this.lastHeartbeat) : this.inFlightStart;
      const elapsed = this.clock.now() - since;
      if (elapsed > this.watchdogTimeout) {
        console.warn(`Watchdog: Worker silent for ${elapsed.toFixed(0)}ms (> ${this.watchdogTimeout}ms). Recreating worker.`);
        this.triggerRecovery(elapsed);
        return true;
      }
    }
    return false;
  }

  private startWatchdog() {
    this.stopWatchdog();
    const poll = () => {
      this.watchdogTimer = this.clock.setTimeout(poll, WATCHDOG_POLL_MS);
      this.checkWatchdog();
    };
    this.watchdogTimer = this.clock.setTimeout(poll, WATCHDOG_POLL_MS);
  }

  private stopWatchdog() {
    if (this.watchdogTimer !== null) {
      this.clock.clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  public triggerRecovery(elapsed: number, notify = true) {
    if (!this.inFlight) return;
    this.inFlight = false;
    this.inFlightStart = null;
    if (notify) {
      this.options.onWatchdogTriggered?.(elapsed);
    }
  }

  public getSamplingDelay(): number {
    return this.samplingDelay;
  }

  public getLatencyHistory(): number[] {
    return this.latencyHistory;
  }

  public getInFlight(): boolean {
    return this.inFlight;
  }

  public getIsPaused(): boolean {
    return this.isPaused;
  }

  public getInFlightStart(): number | null {
    return this.inFlightStart;
  }

  public getStartTimeMap(): Map<number, number> {
    return new Map(this.startTimeMap);
  }
}

