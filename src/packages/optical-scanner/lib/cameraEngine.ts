import { loadQrReader, type QrReader } from '@/packages/qr-decode';
import {
  cornersFromArray,
  getDownscaledDimensions,
  isValidScannerResponse,
  mapCorners,
  type DecodedCode,
  type ScanCorners,
  type ScanDecoder,
  type ScannerStatus,
  type ScanRegion,
} from './contracts';
import { AdaptiveFrameScheduler, DEFAULT_WATCHDOG_TIMEOUT_MS } from './scheduler';
import { CAMERA_STRATEGY_COUNT, cameraStrategyFor, decodeCameraCode } from './decodeSync';
import { systemClock, type ScannerClock } from './clock';
import { getNativeQrDetector } from './nativeDetector';
import { createResultGate, DEFAULT_REPEAT_HOLD_MS } from './resultGate';
import {
  connectSharedScannerWorker,
  type ScannerWorkerFactory,
  type ScannerWorkerHandle,
} from './workerRunner';

/**
 * Hang budget: how long the worker may stay silent with a frame in flight before it is replaced.
 * Each frame costs one bounded decoder pass, so a slow but healthy worker answers well within it;
 * only a real hang or crash restarts the worker (#1096).
 */
const WATCHDOG_TIMEOUT_MS = DEFAULT_WATCHDOG_TIMEOUT_MS;
/** Consecutive hangs or crashes allowed before the engine switches to main-thread decoding. */
const MAX_WORKER_RESTARTS = 3;
/** Longest edge of a frame posted to the worker. */
const WORKER_MAX_DIMENSION = 1280;
/**
 * Longest edge of the centre region posted to the worker. The region under the reticle is cut at
 * the camera's native resolution up to this size, so a small code in a 1920x1080 frame keeps every
 * pixel instead of losing a third of them to the whole-frame downscale (#1099).
 */
const REGION_MAX_DIMENSION = 1280;
/** Longest edge of a frame decoded on the main thread (kept smaller to protect the UI thread). */
const MAIN_THREAD_MAX_DIMENSION = 800;
const DEFAULT_FRAME_WIDTH = 640;
/** `HTMLMediaElement.HAVE_CURRENT_DATA`. */
const HAVE_CURRENT_DATA = 2;
const DEFAULT_FRAME_HEIGHT = 480;

type SourceEvent = 'pause' | 'seeked' | 'play' | 'playing' | 'loadeddata';

/**
 * The subset of `HTMLVideoElement` the engine samples from. Any `HTMLVideoElement` satisfies it;
 * headless tests pass a plain object.
 */
export interface CameraFrameSource {
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly srcObject: unknown;
  readonly src: string;
  readonly currentSrc: string;
  /** `HTMLMediaElement.readyState`; frames are skipped until it reaches HAVE_CURRENT_DATA (2). */
  readonly readyState?: number;
  addEventListener(type: SourceEvent, listener: () => void): void;
  removeEventListener(type: SourceEvent, listener: () => void): void;
}

/** Raw RGBA pixels for main-thread decoding. */
export interface CameraFramePixels {
  data: Uint8ClampedArray;
}

/**
 * Turns the current frame of a source into worker or main-thread input.
 */
export interface CameraFrameGrabber {
  /**
   * Captures a transferable bitmap for the worker: `region` of the frame (the whole frame when
   * omitted), scaled to `width` x `height`.
   */
  grabBitmap(source: CameraFrameSource, width: number, height: number, region?: ScanRegion): Promise<ImageBitmap>;
  /** Captures downscaled RGBA pixels for the main-thread fallback, or null when no canvas exists. */
  grabPixels(source: CameraFrameSource, width: number, height: number): CameraFramePixels | null;
}

export interface CameraScannerEngineOptions {
  /** Minimum sleep between frame captures in milliseconds (default 16). */
  minSamplingDelay?: number;
  /** Maximum sleep between frame captures in milliseconds (default 1000). */
  maxSamplingDelay?: number;
}

/** A code the camera read, as `onScanSuccess` reports it (#1099). */
export interface CameraScanResult extends DecodedCode {
  /** The decoder that read it. */
  source: ScanDecoder;
  /** How long the frame took to decode, in milliseconds. */
  durationMs: number;
}

/** Reads QR codes straight from the camera source on the main thread (the platform's detector). */
export interface CameraCodeDetector {
  detect(source: CameraFrameSource): Promise<DecodedCode | null>;
}

export interface CameraScannerEngineMetrics {
  samplingDelay: number;
  latencyHistory: number[];
}

export interface CameraScannerEngineEvents {
  /** A confirmed code: its text, and the full result (bytes, corners, decoder). */
  onScanSuccess?: (data: string, result: CameraScanResult) => void;
  onScanFail?: (error?: string) => void;
  onStatusChange?: (status: ScannerStatus) => void;
  onMetricsChange?: (metrics: CameraScannerEngineMetrics) => void;
}

export interface CameraScannerEngineConfig extends CameraScannerEngineOptions {
  /** Returns the element to sample, read on every tick so it may change between frames. */
  getSource: () => CameraFrameSource | null | undefined;
  /** Worker factory; defaults to the package's shared scanner worker. */
  createWorker?: ScannerWorkerFactory;
  /** Time source; defaults to the system clock. */
  clock?: ScannerClock;
  /** Frame grabber; defaults to `createImageBitmap` and a 2D canvas. */
  grabber?: CameraFrameGrabber;
  /**
   * Main-thread decoder used after worker fallback; defaults to one pass of our reader per frame,
   * rotating strategies by `sequenceId` like the worker does. Frames before the reader has loaded
   * count as misses.
   */
  decodeSync?: (
    pixels: CameraFramePixels,
    width: number,
    height: number,
    sequenceId: number
  ) => DecodedCode | string | null;
  /**
   * The platform's QR detector. When there is one, frames never go to the worker. Defaults to the
   * page's `BarcodeDetector` if it reads QR codes; pass null to always use the worker.
   */
  detector?: CameraCodeDetector | null;
  /**
   * Agreeing decodes needed before a result is emitted (default 2, within 500 ms). Results from
   * the platform detector need one. Pass 1 for streams where every frame differs (file transfer).
   */
  confirmations?: 1 | 2;
  /** How long the same payload is not emitted again, in milliseconds (default 3000; 0 = every decode). */
  repeatHoldMs?: number;
}

/**
 * Headless camera scanning engine: owns the frame loop, adaptive sampling, the private worker
 * (epochs, watchdog, backoff and main-thread fallback) and backpressure.
 */
export interface CameraScannerEngine {
  /** Starts (or restarts) sampling frames from the source. */
  start(): void;
  /** Stops sampling; the engine can be started again. */
  stop(): void;
  /** Stops sampling, detaches from the worker and drops all listeners. The engine is unusable afterwards. */
  destroy(): void;
  /** Registers event listeners and returns a function that removes them. */
  subscribe(events: CameraScannerEngineEvents): () => void;
  /** Updates the adaptive sampling bounds. */
  setOptions(options: CameraScannerEngineOptions): void;
  /** Latest sampling metrics. */
  getMetrics(): CameraScannerEngineMetrics;
}

/**
 * Page-wide epoch counter. Every scan session and every worker generation gets a new, larger
 * epoch, so the shared worker can tell a new session's frame 1 from a stale frame (#1095).
 */
let lastEpoch = 0;
const nextEpoch = (): number => {
  lastEpoch += 1;
  return lastEpoch;
};

function isVideoElement(source: CameraFrameSource): source is CameraFrameSource & HTMLVideoElement {
  return typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement;
}

/** The page's `BarcodeDetector` as a {@link CameraCodeDetector}, or null when it cannot read QR codes. */
async function defaultDetector(): Promise<CameraCodeDetector | null> {
  const native = await getNativeQrDetector();
  if (!native) return null;
  return { detect: (source) => (isVideoElement(source) ? native.detect(source) : Promise.resolve(null)) };
}

/** The part of a frame each decode strategy looks at: the centre square, or the whole frame. */
function regionFor(sequenceId: number, width: number, height: number): ScanRegion {
  if (cameraStrategyFor(sequenceId) === 'frame') return { x: 0, y: 0, width, height };
  const side = Math.min(width, height);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side };
}

function asDecodedCode(value: DecodedCode | string): DecodedCode {
  return typeof value === 'string' ? { text: value, bytes: null, corners: null } : value;
}

/**
 * The default main-thread decoder: our reader (#1178), loaded on the first frame. Until it has
 * loaded, frames are misses; a failed load is retried on a later frame.
 */
function createDefaultDecodeSync(): NonNullable<CameraScannerEngineConfig['decodeSync']> {
  let reader: QrReader | null = null;
  let loading: Promise<void> | null = null;
  return (pixels, width, height, sequenceId) => {
    if (!reader) {
      loading ??= loadQrReader().then(
        (loaded) => {
          reader = loaded;
        },
        (err: unknown) => {
          console.error('The QR reader did not load for main-thread decoding:', err);
          loading = null;
        }
      );
      return null;
    }
    return decodeCameraCode(reader, pixels.data, width, height, cameraStrategyFor(sequenceId));
  };
}

/**
 * Default grabber backed by `createImageBitmap` and a reusable 2D canvas.
 */
function createDefaultGrabber(): CameraFrameGrabber {
  let canvas: HTMLCanvasElement | null = null;
  return {
    grabBitmap: (source, width, height, region) => {
      if (!isVideoElement(source) || typeof createImageBitmap !== 'function') {
        return Promise.reject(new Error('Frame source cannot be captured as an ImageBitmap'));
      }
      const options: ImageBitmapOptions = { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' };
      if (!region) return createImageBitmap(source, options);
      // Only the region is copied out of the video frame.
      return createImageBitmap(source, region.x, region.y, region.width, region.height, options);
    },
    grabPixels: (source, width, height) => {
      if (!isVideoElement(source) || typeof document === 'undefined') return null;
      canvas ??= document.createElement('canvas');
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(source, 0, 0, width, height);
      return ctx.getImageData(0, 0, width, height);
    },
  };
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Creates a Camera Scanner Engine. Nothing runs until `start()` is called.
 */
export function createCameraScannerEngine(config: CameraScannerEngineConfig): CameraScannerEngine {
  const clock = config.clock ?? systemClock;
  const createWorker = config.createWorker ?? connectSharedScannerWorker;
  const grabber = config.grabber ?? createDefaultGrabber();
  const decodeSync = config.decodeSync ?? createDefaultDecodeSync();
  const { getSource } = config;
  const gate = createResultGate({
    confirmations: config.confirmations ?? 2,
    // A code read by one strategy only is read once per rotation, however slow the decodes (#1292).
    windowMisses: CAMERA_STRATEGY_COUNT - 1,
    holdMs: config.repeatHoldMs ?? DEFAULT_REPEAT_HOLD_MS,
  });

  const listeners = new Set<CameraScannerEngineEvents>();
  const emit = (notify: (events: CameraScannerEngineEvents) => void) => {
    for (const events of [...listeners]) notify(events);
  };

  let worker: ScannerWorkerHandle | null = null;
  /** The platform detector: undefined until the page has been checked for one. */
  let detector: CameraCodeDetector | null | undefined = config.detector;
  let detectorCheck: Promise<void> | null = null;
  let epoch = 0;
  let restartAttempts = 0;
  let useMainThread = false;
  let running = false;
  let destroyed = false;
  let loopSuspended = false;
  let timerId: number | null = null;
  let frameId: number | null = null;
  let boundSource: { source: CameraFrameSource; handlers: Array<[SourceEvent, () => void]> } | null = null;

  const scheduler = new AdaptiveFrameScheduler<CameraScanResult>({
    minSamplingDelay: config.minSamplingDelay,
    maxSamplingDelay: config.maxSamplingDelay,
    clock,
    onStatusChange: (status) => emit((e) => e.onStatusChange?.(status)),
    onDelayChange: () => emit((e) => e.onMetricsChange?.(getMetrics())),
    onLatencyHistoryChange: () => emit((e) => e.onMetricsChange?.(getMetrics())),
    onScanSuccess: (data, result) => {
      const scan = result ?? { text: data, bytes: null, corners: null, source: 'qr-decode', durationMs: 0 };
      if (!gate.offer(data, scan.source, clock.now())) return;
      emit((e) => e.onScanSuccess?.(data, scan));
    },
    onScanFail: (error) => {
      gate.miss();
      emit((e) => e.onScanFail?.(error ?? undefined));
    },
    onWatchdogTriggered: () => recoverWorker(),
  });

  function getMetrics(): CameraScannerEngineMetrics {
    return {
      samplingDelay: scheduler.getSamplingDelay(),
      latencyHistory: [...scheduler.getLatencyHistory()],
    };
  }

  function markWorkerHealthy() {
    restartAttempts = 0;
    scheduler.setWatchdogTimeout(WATCHDOG_TIMEOUT_MS);
  }

  function handleWorkerMessage(owner: ScannerWorkerHandle, payload: unknown) {
    if (owner !== worker) return;
    // Any answer, even a stale or invalid one, shows the worker is alive.
    scheduler.heartbeat();
    if (!isValidScannerResponse(payload)) {
      console.error('Invalid scanner response payload:', payload);
      return;
    }
    if (payload.epochId !== undefined && payload.epochId !== epoch) {
      // Response produced for a worker generation that has since been replaced.
      return;
    }
    if (payload.status === 'pass' || payload.error !== 'STALE_FRAME') {
      markWorkerHealthy();
    }
    const corners: ScanCorners | null = cornersFromArray(payload.corners);
    const result: CameraScanResult | undefined =
      payload.status === 'pass' && payload.decodedData
        ? {
            text: payload.decodedData,
            bytes: payload.decodedBytes ?? null,
            corners,
            source: payload.decoder ?? 'qr-decode',
            durationMs: frameDuration(payload.sequenceId),
          }
        : undefined;
    scheduler.endFrame(payload.sequenceId, payload.status, payload.decodedData, payload.error, payload.buffer, result);
  }

  /** Time since a frame was captured, from the scheduler's own bookkeeping. */
  function frameDuration(sequenceId: number): number {
    const started = scheduler.getStartTimeMap().get(sequenceId);
    return started === undefined ? 0 : clock.now() - started;
  }

  function spawnWorker() {
    let handle: ScannerWorkerHandle | null = null;
    try {
      handle = createWorker({
        onMessage: (data) => {
          if (handle) handleWorkerMessage(handle, data);
        },
        onError: (reason) => {
          if (handle && handle === worker) {
            console.error('Scanner worker thread error:', reason);
            recoverWorker();
          }
        },
      });
      worker = handle;
    } catch (err) {
      console.warn('Scanner worker unavailable, activating main-thread fallback:', err);
      worker = null;
      useMainThread = true;
    }
  }

  function discardWorker() {
    const current = worker;
    worker = null;
    if (!current) return;
    try {
      current.terminate();
    } catch (err) {
      console.error('Failed to terminate scanner worker:', err);
    }
  }

  function recoverWorker() {
    if (destroyed || useMainThread) return;
    restartAttempts += 1;
    epoch = nextEpoch();
    discardWorker();

    if (restartAttempts > MAX_WORKER_RESTARTS) {
      console.warn('Scanner worker failed repeatedly. Activating main-thread fallback.');
      useMainThread = true;
      scheduler.setWatchdogTimeout(WATCHDOG_TIMEOUT_MS);
      scheduler.triggerRecovery(WATCHDOG_TIMEOUT_MS, false);
      return;
    }

    console.warn(
      `Watchdog: Recreating scanner worker. Attempt ${restartAttempts} of ${MAX_WORKER_RESTARTS} consecutive retries.`
    );
    scheduler.triggerRecovery(WATCHDOG_TIMEOUT_MS, false);
    spawnWorker();
  }

  function decodeOnMainThread(source: CameraFrameSource, seqId: number, width: number, height: number) {
    const dims = getDownscaledDimensions(width, height, MAIN_THREAD_MAX_DIMENSION);
    let pixels: CameraFramePixels | null;
    try {
      pixels = grabber.grabPixels(source, dims.width, dims.height);
    } catch (err) {
      console.error('Failed to read frame pixels for main-thread decode:', err);
      scheduler.endFrame(seqId, 'fail', null, 'CANVAS_READ_ERROR');
      return;
    }
    if (!pixels) {
      scheduler.endFrame(seqId, 'fail', null, 'CANVAS_UNAVAILABLE');
      return;
    }
    const frame = pixels;
    clock.setTimeout(() => {
      try {
        const found = decodeSync(frame, dims.width, dims.height, seqId);
        if (found) {
          restartAttempts = 0;
          const code = asDecodedCode(found);
          scheduler.endFrame(seqId, 'pass', code.text, null, undefined, {
            ...code,
            corners: mapCorners(code.corners, width / dims.width, height / dims.height),
            source: 'qr-decode',
            durationMs: frameDuration(seqId),
          });
        } else {
          scheduler.endFrame(seqId, 'fail', null, null);
        }
      } catch (err) {
        console.error('Main-thread QR decoding error:', err);
        scheduler.endFrame(seqId, 'fail', null, errorMessage(err, 'DECODE_ERROR'));
      }
    }, 0);
  }

  function decodeNatively(active: CameraCodeDetector, source: CameraFrameSource, seqId: number) {
    active
      .detect(source)
      .then((code) => {
        if (code) {
          scheduler.endFrame(seqId, 'pass', code.text, null, undefined, {
            ...code,
            source: 'native',
            durationMs: frameDuration(seqId),
          });
        } else {
          scheduler.endFrame(seqId, 'fail', null, null);
        }
      })
      .catch((err: unknown) => {
        // A detector that cannot read this source (or broke) hands over to the worker for good.
        console.warn('Native QR detector failed, switching to the scanner worker:', err);
        detector = null;
        if (!worker && !useMainThread) spawnWorker();
        scheduler.endFrame(seqId, 'fail', null, 'NATIVE_DETECTOR_ERROR');
      });
  }

  function decodeOnWorker(source: CameraFrameSource, seqId: number, width: number, height: number) {
    const region = regionFor(seqId, width, height);
    const dims = getDownscaledDimensions(
      region.width,
      region.height,
      region.width === width && region.height === height ? WORKER_MAX_DIMENSION : REGION_MAX_DIMENSION
    );
    grabber
      .grabBitmap(source, dims.width, dims.height, region)
      .then((image) => {
        const target = worker;
        if (!target) {
          image.close();
          scheduler.endFrame(seqId, 'fail', null, 'WORKER_UNAVAILABLE');
          return;
        }
        try {
          target.postFrame(
            { image, width: dims.width, height: dims.height, sequenceId: seqId, epochId: epoch, region },
            [image]
          );
        } catch (err) {
          console.error('Failed to post camera frame to scanner worker:', err);
          scheduler.endFrame(seqId, 'fail', null, 'DISPATCH_ERROR');
        }
      })
      .catch((err: unknown) => {
        console.error('Failed to capture camera frame:', err);
        scheduler.endFrame(seqId, 'fail', null, 'CAPTURE_ERROR');
      });
  }

  /** Captures one frame. `force` bypasses backpressure (used for paused or seeked video files). */
  function captureFrame(force = false): boolean {
    const source = getSource();
    if (!source) return false;
    // Until the page has been checked for a platform detector, no decoder is chosen.
    if (detector === undefined) return false;
    // A stream that has not delivered its first frame yet cannot be captured.
    if (typeof source.readyState === 'number' && source.readyState < HAVE_CURRENT_DATA) return false;
    if (!force && scheduler.getInFlight()) return false;

    const width = source.videoWidth || DEFAULT_FRAME_WIDTH;
    const height = source.videoHeight || DEFAULT_FRAME_HEIGHT;
    const seqId = scheduler.beginFrame(force);
    if (seqId === null) return false;

    if (detector) {
      decodeNatively(detector, source, seqId);
    } else if (useMainThread || !worker) {
      decodeOnMainThread(source, seqId, width, height);
    } else {
      decodeOnWorker(source, seqId, width, height);
    }
    return true;
  }

  function clearLoopTimers() {
    if (timerId !== null) {
      clock.clearTimeout(timerId);
      timerId = null;
    }
    if (frameId !== null) {
      clock.cancelFrame(frameId);
      frameId = null;
    }
  }

  function scheduleNextTick() {
    clearLoopTimers();
    timerId = clock.setTimeout(() => {
      timerId = null;
      frameId = clock.requestFrame(tick);
    }, scheduler.getSamplingDelay());
  }

  function resumeLoop() {
    if (!running || !loopSuspended) return;
    loopSuspended = false;
    clearLoopTimers();
    frameId = clock.requestFrame(tick);
  }

  function unbindSource() {
    if (!boundSource) return;
    const { source, handlers } = boundSource;
    boundSource = null;
    for (const [type, handler] of handlers) {
      try {
        source.removeEventListener(type, handler);
      } catch (err) {
        console.error('Failed to detach video listeners:', err);
      }
    }
  }

  function bindSource(source: CameraFrameSource) {
    if (boundSource?.source === source) return;
    unbindSource();
    const captureNow = () => {
      captureFrame(true);
    };
    const handlers: Array<[SourceEvent, () => void]> = [
      ['pause', captureNow],
      ['seeked', captureNow],
      ['loadeddata', captureNow],
      ['play', resumeLoop],
      ['playing', resumeLoop],
    ];
    for (const [type, handler] of handlers) {
      source.addEventListener(type, handler);
    }
    boundSource = { source, handlers };
  }

  function tick() {
    frameId = null;
    if (!running) return;

    const source = getSource();
    if (!source) {
      scheduleNextTick();
      return;
    }

    const isVideoFile = !source.srcObject && (!!source.src || !!source.currentSrc);
    if (isVideoFile) {
      bindSource(source);
      if (source.paused || source.ended) {
        // Paused or finished video files are sampled once; play/seeked events drive the rest.
        captureFrame(true);
        loopSuspended = true;
        return;
      }
    } else {
      unbindSource();
      if (source.paused || source.ended) {
        scheduleNextTick();
        return;
      }
    }

    if (scheduler.getInFlight()) {
      scheduler.checkWatchdog();
      if (scheduler.getInFlight()) {
        scheduleNextTick();
        return;
      }
    }

    captureFrame();
    scheduleNextTick();
  }

  /** Uses the platform detector when there is one, otherwise the worker (spawned once). */
  function chooseDecoder() {
    if (detector === undefined) {
      detectorCheck ??= defaultDetector().then(
        (found) => {
          detector = found;
          if (!found && running && !worker && !useMainThread) spawnWorker();
        },
        () => {
          detector = null;
          if (running && !worker && !useMainThread) spawnWorker();
        }
      );
      return;
    }
    if (!detector && !worker && !useMainThread) spawnWorker();
  }

  function start() {
    if (destroyed) return;
    restartAttempts = 0;
    epoch = nextEpoch();
    gate.reset();
    scheduler.setWatchdogTimeout(WATCHDOG_TIMEOUT_MS);
    scheduler.start();
    chooseDecoder();
    if (!running) {
      running = true;
      loopSuspended = false;
      clearLoopTimers();
      frameId = clock.requestFrame(tick);
    }
  }

  function stop() {
    const wasRunning = running;
    running = false;
    loopSuspended = false;
    clearLoopTimers();
    unbindSource();
    restartAttempts = 0;
    scheduler.setWatchdogTimeout(WATCHDOG_TIMEOUT_MS);
    scheduler.stop();
    if (wasRunning) emit((e) => e.onStatusChange?.('idle'));
  }

  function destroy() {
    if (destroyed) return;
    stop();
    destroyed = true;
    const current = worker;
    worker = null;
    current?.release();
    listeners.clear();
  }

  return {
    start,
    stop,
    destroy,
    subscribe: (events) => {
      listeners.add(events);
      return () => {
        listeners.delete(events);
      };
    },
    setOptions: (options) => {
      scheduler.setSamplingBounds(options.minSamplingDelay ?? 16, options.maxSamplingDelay ?? 1000);
    },
    getMetrics,
  };
}
