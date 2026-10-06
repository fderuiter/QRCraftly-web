import { AdaptiveFrameScheduler } from '@/packages/optical-scanner/scheduler';
import { simulatePrint } from '@/packages/scannability';
import type { QrReader } from '@/packages/qr-decode';
import { qrReader } from '../fixtures/qrReader';

/**
 * Optical degradation profile options for simulated scannability checks.
 */
export interface OpticalProfile {
  /**
   * Whether to enable optical degradation simulation (default: true).
   */
  enabled?: boolean;
}

/**
 * Worker queue options for setting processing delays, concurrency, and stalls.
 */
export interface WorkerQueueConfig {
  /**
   * Simulated worker processing delay in milliseconds (default: 0).
   */
  latencyMs?: number;
  /**
   * Message queue transit delay in milliseconds (default: 0).
   */
  queueDelayMs?: number;
  /**
   * Maximum concurrent frame tasks allowed in worker queue (default: 1).
   */
  concurrencyLimit?: number;
  /**
   * If true, simulates out-of-order execution response delivery.
   */
  reorderResponses?: boolean;
  /**
   * If true, simulates worker thread stall/starvation (no response sent).
   */
  stallWorker?: boolean;
}

/**
 * Configuration options for the OpticalScannerHarness.
 */
export interface HarnessConfig {
  /** The QR reader; defaults to the real one (#1178). */
  reader?: QrReader;
  /**
   * Minimum frame sampling capture interval in milliseconds.
   */
  minSamplingDelay?: number;
  /**
   * Maximum frame sampling capture interval in milliseconds.
   */
  maxSamplingDelay?: number;
  /**
   * Optical degradation profile configuration.
   */
  opticalProfile?: OpticalProfile;
  /**
   * Worker message queue configuration options.
   */
  workerConfig?: WorkerQueueConfig;
  /**
   * Callback invoked when a frame completes processing through the worker queue.
   */
  onFrameProcessed?: (result: HarnessFrameResult) => void;
  /**
   * Callback invoked when a frame capture is dropped due to backpressure lock.
   */
  onBackpressureDrop?: (sequenceId: number | null) => void;
  /**
   * Callback invoked when an out-of-order/outdated sequence response is discarded.
   */
  onStaleFrameDiscarded?: (sequenceId: number) => void;
  /**
   * Callback invoked when the worker starvation watchdog is triggered.
   */
  onWatchdogTriggered?: (elapsedMs: number) => void;
  /**
   * Callback invoked when a worker instance is recreated following a stall or reset.
   */
  onWorkerRecreated?: () => void;
}

/**
 * Scannability classification result.
 */
export type ScannabilityClassification = 'scannable' | 'degraded' | 'unscannable';

/**
 * Frame processing execution result emitted by the harness.
 */
export interface HarnessFrameResult {
  /**
   * Sequence identifier assigned by the frame scheduler.
   */
  sequenceId: number;
  /**
   * Decoded status ('pass' if decoded, 'fail' otherwise).
   */
  status: 'pass' | 'fail';
  /**
   * Decoded text payload from QR code scan.
   */
  decodedData: string | null;
  /**
   * Whether the pristine digital frame was scannable.
   */
  digitalScannable: boolean;
  /**
   * Whether the optically degraded frame was scannable.
   */
  opticalScannable: boolean;
  /**
   * Classification of scannability ('scannable', 'degraded', or 'unscannable').
   */
  scannabilityClassification: ScannabilityClassification;
  /**
   * Round-trip latency duration in milliseconds.
   */
  latencyMs: number;
  /**
   * Whether this frame response was discarded as stale/out-of-order.
   */
  isStale: boolean;
  /**
   * Optional error message.
   */
  error?: string | null;
}

/**
 * Cumulative performance and reliability metrics collected by the harness.
 */
export interface HarnessMetrics {
  /**
   * Total number of frame push attempts.
   */
  totalFramesPushed: number;
  /**
   * Number of frames accepted into the processing pipeline.
   */
  framesAccepted: number;
  /**
   * Number of frames rejected by backpressure locks.
   */
  framesBackpressured: number;
  /**
   * Number of frames successfully completed through worker.
   */
  framesProcessed: number;
  /**
   * Number of stale/out-of-order frame responses discarded.
   */
  staleFramesDiscarded: number;
  /**
   * Number of times starvation watchdog was triggered.
   */
  watchdogTriggers: number;
  /**
   * Number of worker thread recreations executed.
   */
  workerRecreations: number;
  /**
   * Number of frames with status 'pass'.
   */
  passCount: number;
  /**
   * Number of frames with status 'fail'.
   */
  failCount: number;
  /**
   * Scannability pass rate percentage (0 - 100).
   */
  scannabilityPassRate: number;
  /**
   * Execution latency history of recent completed frames.
   */
  latencyHistory: number[];
  /**
   * Current number of active worker thread instances.
   */
  activeWorkerInstances: number;
}

/**
 * Structure of frame input submitted to the test harness.
 */
export interface FrameInput {
  /**
   * Raw pixel data array (RGBA).
   */
  pixels: Uint8ClampedArray | Uint8Array;
  /**
   * Frame width in pixels.
   */
  width: number;
  /**
   * Frame height in pixels.
   */
  height: number;
  /**
   * Optional flag to bypass backpressure lock check.
   */
  force?: boolean;
}

/**
 * Integrated Optical Scanner Test Harness.
 * Connects frame scheduling, simulated worker message queues with backpressure,
 * starvation watchdog recovery, and optical scannability evaluations under load.
 */
export class OpticalScannerHarness {
  private scheduler: AdaptiveFrameScheduler;
  private opticalProfile: OpticalProfile;
  private workerConfig: WorkerQueueConfig;
  private config: HarnessConfig;
  private readonly reader: QrReader;

  private totalFramesPushed = 0;
  private framesAccepted = 0;
  private framesBackpressured = 0;
  private framesProcessed = 0;
  private staleFramesDiscarded = 0;
  private watchdogTriggers = 0;
  private workerRecreations = 0;
  private passCount = 0;
  private failCount = 0;
  private activeWorkerInstances = 1;
  private completedSequenceId = 0;

  private pendingQueue: Array<{
    seqId: number;
    pixels: Uint8ClampedArray | Uint8Array;
    width: number;
    height: number;
    submitTime: number;
    delay: number;
  }> = [];

  private isRunning = false;

  /**
   * Initializes a new OpticalScannerHarness session.
   * @param config - Configuration options for scheduler, worker queue, and optical profiles.
   */
  constructor(config: HarnessConfig = {}) {
    this.config = config;
    this.reader = config.reader ?? qrReader;
    this.opticalProfile = {
      enabled: true,
      ...config.opticalProfile,
    };
    this.workerConfig = {
      latencyMs: 0,
      queueDelayMs: 0,
      concurrencyLimit: 1,
      reorderResponses: false,
      stallWorker: false,
      ...config.workerConfig,
    };

    this.scheduler = new AdaptiveFrameScheduler({
      minSamplingDelay: config.minSamplingDelay ?? 16,
      maxSamplingDelay: config.maxSamplingDelay ?? 1000,
      onWatchdogTriggered: (elapsed) => {
        this.handleWatchdogTrigger(elapsed);
      },
    });
  }

  /**
   * Starts the harness session and frame scheduler.
   */
  public start(): void {
    this.isRunning = true;
    this.completedSequenceId = 0;
    this.scheduler.start();
  }

  /**
   * Stops the harness session and clears pending worker queue tasks.
   */
  public stop(): void {
    this.isRunning = false;
    this.scheduler.stop();
    this.pendingQueue = [];
  }

  /**
   * Updates the worker message queue latency and delay settings.
   * @param latencyMs - Simulated worker processing duration in milliseconds.
   * @param queueDelayMs - Simulated message transit delay in milliseconds.
   */
  public setWorkerLatency(latencyMs: number, queueDelayMs = 0): void {
    this.workerConfig.latencyMs = latencyMs;
    this.workerConfig.queueDelayMs = queueDelayMs;
  }

  /**
   * Updates the optical degradation simulation parameters.
   * @param profile - Partial optical profile overrides.
   */
  public setOpticalProfile(profile: Partial<OpticalProfile>): void {
    this.opticalProfile = { ...this.opticalProfile, ...profile };
  }

  /**
   * Updates the worker queue configuration options.
   * @param workerConfig - Partial worker queue configuration overrides.
   */
  public setWorkerConfig(workerConfig: Partial<WorkerQueueConfig>): void {
    this.workerConfig = { ...this.workerConfig, ...workerConfig };
  }

  /**
   * Evaluates digital and optical scannability of a frame synchronously.
   * @param pixels - Raw RGBA pixel array.
   * @param width - Image width.
   * @param height - Image height.
   * @returns Object containing digital and optical scan results and classification.
   */
  public evaluateScannability(
    pixels: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number
  ): {
    digitalScannable: boolean;
    opticalScannable: boolean;
    scannabilityClassification: ScannabilityClassification;
    decodedData: string | null;
  } {
    // Ensure Uint8ClampedArray for decoding
    const clampedPixels =
      pixels instanceof Uint8ClampedArray
        ? pixels
        : new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength);

    // 1. Digital Check
    let [digitalCode] = this.reader.read(clampedPixels, width, height);
    if (!digitalCode) {
      [digitalCode] = this.reader.read(clampedPixels, width, height, { inverted: true });
    }
    const digitalScannable = !!digitalCode;
    const decodedData = digitalCode ? digitalCode.text : null;

    if (!digitalCode) {
      return {
        digitalScannable: false,
        opticalScannable: false,
        scannabilityClassification: 'unscannable',
        decodedData: null,
      };
    }

    // 2. Optical Check (if enabled)
    if (this.opticalProfile.enabled === false) {
      return {
        digitalScannable: true,
        opticalScannable: true,
        scannabilityClassification: 'scannable',
        decodedData,
      };
    }

    const printed = simulatePrint({ data: clampedPixels, width, height }, digitalCode);

    let [opticalCode] = this.reader.read(printed.data, printed.width, printed.height);
    if (!opticalCode) {
      [opticalCode] = this.reader.read(printed.data, printed.width, printed.height, { inverted: true });
    }
    const opticalScannable = !!opticalCode;

    const scannabilityClassification: ScannabilityClassification = opticalScannable
      ? 'scannable'
      : 'degraded';

    return {
      digitalScannable,
      opticalScannable,
      scannabilityClassification,
      decodedData,
    };
  }

  /**
   * Pushes a frame into the harness processing pipeline.
   * Checks scheduler backpressure lock and dispatches to simulated worker queue.
   * @param pixels - Raw RGBA pixel array.
   * @param width - Image width.
   * @param height - Image height.
   * @param force - Optional flag to bypass backpressure lock check.
   * @param taskLatencyMs - Optional override for worker processing delay in milliseconds.
   * @returns Sequence ID if frame was accepted, or null if dropped by backpressure lock.
   */
  public pushFrame(
    pixels: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    force = false,
    taskLatencyMs?: number
  ): number | null {
    this.totalFramesPushed += 1;

    // Backpressure lock check
    const seqId = this.scheduler.beginFrame(force);

    if (seqId === null) {
      this.framesBackpressured += 1;
      this.config.onBackpressureDrop?.(null);
      return null;
    }

    this.framesAccepted += 1;

    // Calculate total simulated delay
    const latency =
      taskLatencyMs !== undefined
        ? taskLatencyMs
        : (this.workerConfig.latencyMs ?? 0) + (this.workerConfig.queueDelayMs ?? 0);

    // Stalled worker simulation: if stallWorker is true, frame remains stuck in flight
    if (this.workerConfig.stallWorker) {
      this.pendingQueue.push({
        seqId,
        pixels,
        width,
        height,
        submitTime: performance.now(),
        delay: 999999, // infinite delay
      });
      return seqId;
    }

    const task = {
      seqId,
      pixels,
      width,
      height,
      submitTime: performance.now(),
      delay: latency,
    };

    if (this.workerConfig.reorderResponses && this.pendingQueue.length > 0) {
      // Insert before earlier pending task to simulate out-of-order response delivery
      this.pendingQueue.unshift(task);
    } else {
      this.pendingQueue.push(task);
    }

    // Process worker queue asynchronously or synchronously based on latency
    this.flushQueue();

    return seqId;
  }

  /**
   * Flushes and processes eligible tasks in the pending worker queue.
   */
  private flushQueue(): void {
    if (this.pendingQueue.length === 0) return;

    const taskList = [...this.pendingQueue];
    this.pendingQueue = [];

    for (const task of taskList) {
      if (task.delay > 0) {
        setTimeout(() => {
          this.completeFrameTask(task);
        }, task.delay);
      } else {
        this.completeFrameTask(task);
      }
    }
  }

  /**
   * Completes a frame processing task and passes results back to scheduler.
   * @param task - Pending frame task object.
   * @param task.seqId - Sequence identifier of the task.
   * @param task.pixels - Raw RGBA pixel array.
   * @param task.width - Image width.
   * @param task.height - Image height.
   * @param task.submitTime - Timestamp when task was submitted.
   */
  private completeFrameTask(task: {
    seqId: number;
    pixels: Uint8ClampedArray | Uint8Array;
    width: number;
    height: number;
    submitTime: number;
  }): void {
    const { seqId, pixels, width, height } = task;

    const evaluation = this.evaluateScannability(pixels, width, height);

    const status: 'pass' | 'fail' = evaluation.digitalScannable ? 'pass' : 'fail';
    const decodedData = evaluation.decodedData;

    // Check if response is stale (arriving out of order after a higher sequence ID was already completed)
    const isStale = seqId <= this.completedSequenceId;

    if (isStale) {
      this.staleFramesDiscarded += 1;
      this.scheduler.endFrame(seqId, status, decodedData, 'STALE_FRAME');
      this.config.onStaleFrameDiscarded?.(seqId);
    } else {
      this.completedSequenceId = seqId;
      this.framesProcessed += 1;
      this.scheduler.endFrame(seqId, status, decodedData, status === 'fail' ? 'DECODE_FAIL' : null);

      if (status === 'pass') {
        this.passCount += 1;
      } else {
        this.failCount += 1;
      }

      const latencyMs = performance.now() - task.submitTime;

      const result: HarnessFrameResult = {
        sequenceId: seqId,
        status,
        decodedData,
        digitalScannable: evaluation.digitalScannable,
        opticalScannable: evaluation.opticalScannable,
        scannabilityClassification: evaluation.scannabilityClassification,
        latencyMs,
        isStale: false,
        error: status === 'fail' ? 'DECODE_FAIL' : null,
      };

      this.config.onFrameProcessed?.(result);
    }
  }

  /**
   * Checks for worker starvation and recovers pipeline if worker is stalled.
   * @returns True if starvation was detected and watchdog recovered worker, false otherwise.
   */
  public checkWatchdog(): boolean {
    return this.scheduler.checkWatchdog();
  }

  /**
   * Handles starvation watchdog triggers by resetting worker queue and unlocking backpressure.
   * @param elapsedMs - Time elapsed during the stall in milliseconds.
   */
  private handleWatchdogTrigger(elapsedMs: number): void {
    this.watchdogTriggers += 1;
    this.workerRecreations += 1;
    this.pendingQueue = []; // Purge stalled messages

    this.scheduler.triggerRecovery(elapsedMs, false);

    this.config.onWatchdogTriggered?.(elapsedMs);
    this.config.onWorkerRecreated?.();
  }

  /**
   * Forcefully triggers worker recreation and resets pipeline state.
   */
  public recreateWorker(): void {
    this.workerRecreations += 1;
    this.pendingQueue = [];
    this.scheduler.triggerRecovery(1500, false);
    this.config.onWorkerRecreated?.();
  }

  /**
   * Runs an automated integration batch of frame inputs through the pipeline.
   * @param frames - Array of frame inputs to push sequentially.
   * @param batchDelayMs - Inter-frame capture delay in milliseconds.
   * @returns Promise resolving to final cumulative HarnessMetrics.
   */
  public async runIntegrationBatch(
    frames: FrameInput[],
    batchDelayMs = 0
  ): Promise<HarnessMetrics> {
    if (!this.isRunning) {
      this.start();
    }

    for (const frame of frames) {
      this.pushFrame(frame.pixels, frame.width, frame.height, frame.force);
      if (batchDelayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, batchDelayMs));
      }
    }

    // Wait for any pending async tasks in queue
    const maxWait = Math.max(
      100,
      (this.workerConfig.latencyMs ?? 0) + (this.workerConfig.queueDelayMs ?? 0) + 50
    );
    await new Promise<void>((r) => setTimeout(r, maxWait));

    return this.getMetrics();
  }

  /**
   * Computes and returns current cumulative performance and reliability metrics.
   * @returns Object containing all metrics counters and rates.
   */
  public getMetrics(): HarnessMetrics {
    const totalScannableEvaluations = this.passCount + this.failCount;
    const scannabilityPassRate =
      totalScannableEvaluations > 0
        ? Math.round((this.passCount / totalScannableEvaluations) * 100)
        : 100;

    return {
      totalFramesPushed: this.totalFramesPushed,
      framesAccepted: this.framesAccepted,
      framesBackpressured: this.framesBackpressured,
      framesProcessed: this.framesProcessed,
      staleFramesDiscarded: this.staleFramesDiscarded,
      watchdogTriggers: this.watchdogTriggers,
      workerRecreations: this.workerRecreations,
      passCount: this.passCount,
      failCount: this.failCount,
      scannabilityPassRate,
      latencyHistory: this.scheduler.getLatencyHistory(),
      activeWorkerInstances: this.activeWorkerInstances,
    };
  }

  /**
   * Resets all internal metrics counters and queue state.
   */
  public resetMetrics(): void {
    this.totalFramesPushed = 0;
    this.framesAccepted = 0;
    this.framesBackpressured = 0;
    this.framesProcessed = 0;
    this.staleFramesDiscarded = 0;
    this.watchdogTriggers = 0;
    this.workerRecreations = 0;
    this.passCount = 0;
    this.failCount = 0;
    this.completedSequenceId = 0;
    this.pendingQueue = [];
    this.scheduler.start();
  }
}
