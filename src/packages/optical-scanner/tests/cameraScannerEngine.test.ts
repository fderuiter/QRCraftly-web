/**
 * Headless tests for the Camera Scanner Engine.
 *
 * Runs in the node environment with no React, no DOM and no global worker mock: the frame source,
 * worker and clock are all fakes injected through the engine's public configuration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createCameraScannerEngine,
  createStaleFrameGuard,
  type CameraFrameGrabber,
  type CameraFrameSource,
  type CameraScannerEngine,
  type CameraScannerEngineConfig,
  type CameraScanResult,
  type ScannerClock,
  type ScannerRequest,
  type ScannerResponse,
  type ScannerWorkerFactory,
  type ScannerWorkerHandlers,
} from '../index';

/** Deterministic clock: timers and display frames fire only when the test advances time. */
class FakeClock implements ScannerClock {
  private current = 0;
  private nextId = 1;
  private tasks = new Map<number, { at: number; callback: () => void }>();

  now() {
    return this.current;
  }

  setTimeout(callback: () => void, ms: number) {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.current + Math.max(0, ms), callback });
    return id;
  }

  clearTimeout(handle: number) {
    this.tasks.delete(handle);
  }

  requestFrame(callback: () => void) {
    return this.setTimeout(callback, 16);
  }

  cancelFrame(handle: number) {
    this.tasks.delete(handle);
  }

  get pendingCount() {
    return this.tasks.size;
  }

  /** Advances time, running every task that falls due (including tasks scheduled meanwhile). */
  advance(ms: number) {
    const target = this.current + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, task] of this.tasks) {
        if (task.at <= target && task.at < nextAt) {
          nextAt = task.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const task = this.tasks.get(nextId);
      this.tasks.delete(nextId);
      this.current = Math.max(this.current, nextAt);
      task?.callback();
    }
    this.current = target;
  }
}

type Listener = () => void;

/** Plain-object stand-in for an HTMLVideoElement. */
class FakeSource implements CameraFrameSource {
  videoWidth = 1920;
  videoHeight = 1080;
  paused = false;
  ended = false;
  srcObject: unknown = { id: 'camera-stream' };
  src = '';
  currentSrc = '';
  readyState?: number;
  readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  get listenerCount() {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    return count;
  }
}

/** Fake worker generation. Tests answer frames through `reply`, `crash`, or not at all (stall). */
class FakeWorker {
  readonly frames: ScannerRequest[] = [];
  released = false;
  terminated = false;

  constructor(private readonly handlers: ScannerWorkerHandlers) {}

  get attached() {
    return !this.released && !this.terminated;
  }

  reply(frame: ScannerRequest, response: Partial<ScannerResponse>) {
    this.handlers.onMessage({
      status: 'fail',
      sequenceId: frame.sequenceId,
      epochId: frame.epochId,
      ...response,
    });
  }

  replyLatest(response: Partial<ScannerResponse>) {
    const frame = this.frames.at(-1);
    if (!frame) throw new Error('No frame has been posted to this worker');
    this.reply(frame, response);
  }

  sendRaw(payload: unknown) {
    this.handlers.onMessage(payload);
  }

  crash() {
    this.handlers.onError(new Error('worker crashed'));
  }
}

function createHarness(overrides: Partial<CameraScannerEngineConfig> = {}) {
  const clock = new FakeClock();
  const source = new FakeSource();
  const workers: FakeWorker[] = [];
  let failSpawns = false;

  const createWorker: ScannerWorkerFactory = (handlers) => {
    if (failSpawns) throw new Error('SecurityError: worker blocked by CSP');
    const worker = new FakeWorker(handlers);
    workers.push(worker);
    return {
      postFrame: (request) => {
        worker.frames.push(request);
      },
      release: () => {
        worker.released = true;
      },
      terminate: () => {
        worker.terminated = true;
      },
    };
  };

  const grabber: CameraFrameGrabber = {
    grabBitmap: (_source, width, height) => Promise.resolve({ width, height, close: () => {} }),
    grabPixels: (_source, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
  };

  const decodeSync = vi.fn<(pixels: { data: Uint8ClampedArray }, w: number, h: number) => string | null>(
    () => null
  );

  const events = {
    onScanSuccess: vi.fn<(data: string) => void>(),
    onScanFail: vi.fn<(error?: string) => void>(),
    onStatusChange: vi.fn<(status: string) => void>(),
    onMetricsChange: vi.fn<(metrics: { samplingDelay: number; latencyHistory: number[] }) => void>(),
  };

  const engine: CameraScannerEngine = createCameraScannerEngine({
    getSource: () => source,
    clock,
    createWorker,
    grabber,
    decodeSync,
    // Most tests drive one frame at a time; confirmation and the platform detector have their own tests.
    detector: null,
    confirmations: 1,
    repeatHoldMs: 0,
    ...overrides,
  });
  const unsubscribe = engine.subscribe(events);

  /** Advances fake time and flushes the promise-based bitmap capture. */
  const step = async (ms: number) => {
    clock.advance(ms);
    await Promise.resolve();
    await Promise.resolve();
  };

  /** Steps time until the engine posts its next frame, then answers it after `latencyMs`. */
  const answerNextFrame = async (latencyMs: number, response: Partial<ScannerResponse>) => {
    const worker = workers.at(-1);
    const before = worker?.frames.length ?? 0;
    for (let i = 0; i < 200 && (worker?.frames.length ?? 0) === before; i++) {
      await step(4);
    }
    clock.advance(latencyMs);
    worker?.replyLatest(response);
  };

  return {
    clock,
    source,
    answerNextFrame,
    workers,
    engine,
    events,
    decodeSync,
    unsubscribe,
    step,
    currentWorker: () => workers.at(-1),
    blockWorkerSpawns: () => {
      failSpawns = true;
    },
  };
}

describe('Camera Scanner Engine (headless)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('decoding', () => {
    it('emits scan success with the decoded payload for a valid frame', async () => {
      const h = createHarness();
      h.engine.start();
      await h.step(16);

      expect(h.workers).toHaveLength(1);
      expect(h.currentWorker()?.frames).toHaveLength(1);

      h.currentWorker()?.replyLatest({ status: 'pass', decodedData: 'https://qrcraftly.com' });

      expect(h.events.onScanSuccess).toHaveBeenCalledWith('https://qrcraftly.com', expect.objectContaining({ text: 'https://qrcraftly.com' }));
      expect(h.events.onStatusChange).toHaveBeenCalledWith('checking');
      expect(h.events.onStatusChange).toHaveBeenLastCalledWith('pass');
    });

    it('emits scan failure for a frame with no code', async () => {
      const h = createHarness();
      h.engine.start();
      await h.step(16);

      h.currentWorker()?.replyLatest({ status: 'fail', error: 'NOT_FOUND' });

      expect(h.events.onScanFail).toHaveBeenCalledWith('NOT_FOUND');
      expect(h.events.onScanSuccess).not.toHaveBeenCalled();
      expect(h.events.onStatusChange).toHaveBeenLastCalledWith('fail');
    });

    it('posts the centre region and the downscaled whole frame in turn (#1099)', async () => {
      const h = createHarness();
      h.source.videoWidth = 3840;
      h.source.videoHeight = 2160;
      h.engine.start();
      await h.answerNextFrame(10, { status: 'fail' });
      await h.answerNextFrame(10, { status: 'fail' });

      const [centre, whole] = h.currentWorker()?.frames ?? [];
      expect(centre?.region).toEqual({ x: 840, y: 0, width: 2160, height: 2160 });
      expect([centre?.width, centre?.height]).toEqual([1280, 1280]);
      expect(whole?.region).toEqual({ x: 0, y: 0, width: 3840, height: 2160 });
      expect([whole?.width, whole?.height]).toEqual([1280, 720]);
    });

    it('cuts the centre region at native resolution from a 1080p camera (#1099)', async () => {
      const h = createHarness();
      h.source.videoWidth = 1920;
      h.source.videoHeight = 1080;
      h.engine.start();
      await h.step(16);

      const centre = h.currentWorker()?.frames[0];
      expect(centre?.region).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
      expect([centre?.width, centre?.height]).toEqual([1080, 1080]);
    });

    it('ignores malformed worker responses', async () => {
      const h = createHarness();
      h.engine.start();
      await h.step(16);

      h.currentWorker()?.sendRaw({ status: 'maybe', sequenceId: 'x' });

      expect(h.events.onScanSuccess).not.toHaveBeenCalled();
      expect(h.events.onScanFail).not.toHaveBeenCalled();
    });

    it('treats a STALE_FRAME response as dropped rather than failed', async () => {
      const h = createHarness();
      h.engine.start();
      await h.step(16);

      h.currentWorker()?.replyLatest({ status: 'fail', error: 'STALE_FRAME' });
      expect(h.events.onScanFail).not.toHaveBeenCalled();

      await h.step(33 + 16);
      expect(h.currentWorker()?.frames).toHaveLength(2);
    });

    it('does not emit results for out-of-order responses to older frames', async () => {
      const h = createHarness();
      h.engine.start();
      await h.step(16);
      const first = h.currentWorker()?.frames[0];
      h.currentWorker()?.replyLatest({ status: 'fail' });
      await h.step(33 + 16);
      const second = h.currentWorker()?.frames[1];
      expect(first && second).toBeTruthy();
      if (!first || !second) return;

      h.currentWorker()?.reply(second, { status: 'pass', decodedData: 'NEW' });
      h.currentWorker()?.reply(first, { status: 'pass', decodedData: 'OLD' });

      expect(h.events.onScanSuccess).toHaveBeenCalledTimes(1);
      expect(h.events.onScanSuccess).toHaveBeenCalledWith('NEW', expect.objectContaining({ text: 'NEW' }));
    });
  });

  describe('platform detector first (#1099)', () => {
    it('reads frames with the native detector and never spawns or posts to the worker', async () => {
      const detect = vi.fn(async () => ({ text: 'NATIVE', bytes: null, corners: null }));
      const h = createHarness({ detector: { detect }, confirmations: 2, repeatHoldMs: 3000 });
      h.engine.start();
      await h.step(16);
      await h.step(4);

      expect(detect).toHaveBeenCalledWith(h.source);
      expect(h.workers).toHaveLength(0);
      // Native results are trusted on one frame, even with two confirmations required.
      expect(h.events.onScanSuccess).toHaveBeenCalledTimes(1);
      expect(h.events.onScanSuccess).toHaveBeenCalledWith('NATIVE', expect.objectContaining({ source: 'native' }));
    });

    it('hands over to the worker for good when the detector fails', async () => {
      const detect = vi.fn(async () => {
        throw new DOMException('Source not supported', 'NotSupportedError');
      });
      const h = createHarness({ detector: { detect } });
      h.engine.start();
      await h.step(16);
      await h.step(4);
      expect(h.workers).toHaveLength(1);

      await h.answerNextFrame(10, { status: 'pass', decodedData: 'FROM-WORKER', decoder: 'qr-decode' });
      expect(h.events.onScanSuccess).toHaveBeenCalledWith('FROM-WORKER', expect.objectContaining({ source: 'qr-decode' }));
      expect(detect).toHaveBeenCalledTimes(1);
    });

    it('reports bytes, corners and the decoder from the worker', async () => {
      const h = createHarness();
      h.engine.start();
      await h.answerNextFrame(12, {
        status: 'pass',
        decodedData: 'AB',
        decodedBytes: new Uint8Array([65, 66]),
        corners: [10, 10, 50, 10, 50, 50, 10, 50],
        decoder: 'qr-decode',
      });

      const [, result] = h.events.onScanSuccess.mock.calls[0] as unknown as [string, CameraScanResult];
      expect(Array.from(result.bytes ?? [])).toEqual([65, 66]);
      expect(result.corners?.[2]).toEqual({ x: 50, y: 50 });
      expect(result.source).toBe('qr-decode');
      expect(result.durationMs).toBe(12);
    });
  });

  describe('multi-frame confirmation (#1099)', () => {
    it('does not emit a single decode, and emits once two agree within 500 ms', async () => {
      const h = createHarness({ confirmations: 2, repeatHoldMs: 3000 });
      h.engine.start();
      await h.answerNextFrame(10, { status: 'pass', decodedData: 'MISREAD' });
      await h.answerNextFrame(10, { status: 'pass', decodedData: 'REAL' });
      expect(h.events.onScanSuccess).not.toHaveBeenCalled();

      await h.answerNextFrame(10, { status: 'pass', decodedData: 'REAL' });
      expect(h.events.onScanSuccess).toHaveBeenCalledTimes(1);
      expect(h.events.onScanSuccess).toHaveBeenCalledWith('REAL', expect.objectContaining({ text: 'REAL' }));
    });

    it.each([250, 600, 1500])(
      'confirms a code only the centre pass reads within 5 s at %i ms per decode (#1292)',
      async (latencyMs) => {
        const h = createHarness({ confirmations: 2, repeatHoldMs: 3000 });
        h.engine.start();
        // The rotation is centre, frame, centre, inverted: odd frames read the code, even ones miss.
        for (let frame = 1; h.clock.now() < 5000 && h.events.onScanSuccess.mock.calls.length === 0; frame++) {
          await h.answerNextFrame(latencyMs, frame % 2 === 1 ? { status: 'pass', decodedData: 'SMALL' } : { status: 'fail' });
        }
        expect(h.events.onScanSuccess).toHaveBeenCalledWith('SMALL', expect.objectContaining({ text: 'SMALL' }));
        expect(h.clock.now()).toBeLessThanOrEqual(5000);
      }
    );

    it('confirms a code only one pass in four reads, however slow the decodes (#1292)', async () => {
      const h = createHarness({ confirmations: 2, repeatHoldMs: 3000 });
      h.engine.start();
      for (let frame = 1; frame <= 6; frame++) {
        await h.answerNextFrame(1500, frame % 4 === 2 ? { status: 'pass', decodedData: 'WIDE' } : { status: 'fail' });
      }
      expect(h.events.onScanSuccess).toHaveBeenCalledTimes(1);
    });

    it('never lets two different codes confirm each other, or a code seen a rotation ago', async () => {
      const h = createHarness({ confirmations: 2, repeatHoldMs: 3000 });
      h.engine.start();
      for (const decodedData of ['A', 'B', 'A', 'B', 'A']) {
        await h.answerNextFrame(1500, { status: 'pass', decodedData });
      }
      // A read, then four misses: more than one full rotation of the strategies.
      for (let miss = 0; miss < 4; miss++) await h.answerNextFrame(1500, { status: 'fail' });
      await h.answerNextFrame(1500, { status: 'pass', decodedData: 'A' });
      expect(h.events.onScanSuccess).not.toHaveBeenCalled();
    });

    it('emits a payload that stays in view once per hold period in continuous scanning', async () => {
      const h = createHarness({ confirmations: 2, repeatHoldMs: 3000 });
      h.engine.start();
      for (let frame = 0; frame < 40; frame++) {
        await h.answerNextFrame(10, { status: 'pass', decodedData: 'HELD' });
      }
      const firstPeriod = h.events.onScanSuccess.mock.calls.length;
      expect(firstPeriod).toBe(1);

      await h.step(3000);
      await h.answerNextFrame(10, { status: 'pass', decodedData: 'HELD' });
      await h.answerNextFrame(10, { status: 'pass', decodedData: 'HELD' });
      expect(h.events.onScanSuccess).toHaveBeenCalledTimes(2);
    });
  });

  describe('backpressure and adaptive sampling', () => {
    it('does not dispatch a new frame while one is in flight', async () => {
      const h = createHarness();
      h.engine.start();
      await h.step(16);
      await h.step(500);

      expect(h.currentWorker()?.frames).toHaveLength(1);

      h.currentWorker()?.replyLatest({ status: 'fail' });
      await h.step(500);
      expect(h.currentWorker()?.frames).toHaveLength(2);
    });

    it('slows sampling when worker latency is high and speeds up when it is low', async () => {
      const h = createHarness();
      h.engine.start();

      for (let i = 0; i < 3; i++) {
        await h.answerNextFrame(300, { status: 'fail' });
      }
      const slowed = h.engine.getMetrics().samplingDelay;
      expect(slowed).toBeGreaterThan(100);
      expect(h.events.onMetricsChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ samplingDelay: slowed })
      );

      for (let i = 0; i < 8; i++) {
        await h.answerNextFrame(5, { status: 'fail' });
      }
      expect(h.engine.getMetrics().samplingDelay).toBeLessThan(slowed);
      expect(h.engine.getMetrics().latencyHistory.length).toBeLessThanOrEqual(5);
    });

    it('respects updated sampling bounds', async () => {
      const h = createHarness({ maxSamplingDelay: 1000 });
      h.engine.setOptions({ minSamplingDelay: 16, maxSamplingDelay: 120 });
      h.engine.start();

      for (let i = 0; i < 5; i++) {
        await h.answerNextFrame(900, { status: 'fail' });
      }
      expect(h.engine.getMetrics().samplingDelay).toBeLessThanOrEqual(120);
    });
  });

  describe('watchdog recovery', () => {
    it('recreates a worker that stays silent for 5 s and keeps scanning', async () => {
      const h = createHarness();
      h.engine.start();
      await h.step(16);
      const first = h.currentWorker();

      await h.step(4900);
      expect(h.workers).toHaveLength(1);

      await h.step(300);
      expect(h.workers).toHaveLength(2);
      expect(first?.terminated).toBe(true);

      await h.step(1100);
      const second = h.currentWorker();
      expect(second?.frames.length).toBeGreaterThan(0);
      second?.replyLatest({ status: 'pass', decodedData: 'RECOVERED' });
      expect(h.events.onScanSuccess).toHaveBeenCalledWith('RECOVERED', expect.objectContaining({ text: 'RECOVERED' }));
    });

    it('drops late responses from a replaced worker', async () => {
      const h = createHarness();
      h.engine.start();
      await h.step(16);
      const first = h.currentWorker();
      const staleFrame = first?.frames[0];

      await h.step(5200);
      expect(h.workers).toHaveLength(2);

      if (staleFrame) first?.reply(staleFrame, { status: 'pass', decodedData: 'LATE' });
      expect(h.events.onScanSuccess).not.toHaveBeenCalled();
    });

    it('recovers from a worker crash event', async () => {
      const h = createHarness();
      h.engine.start();
      await h.step(16);

      h.currentWorker()?.crash();
      expect(h.workers).toHaveLength(2);
      expect(h.workers[0].terminated).toBe(true);

      await h.step(1100);
      h.currentWorker()?.replyLatest({ status: 'pass', decodedData: 'AFTER-CRASH' });
      expect(h.events.onScanSuccess).toHaveBeenCalledWith('AFTER-CRASH', expect.objectContaining({ text: 'AFTER-CRASH' }));
    });

    it('never restarts a slow worker that keeps answering (#1096)', async () => {
      const h = createHarness();
      h.engine.start();
      // A throttled phone decoding grainy frames: every answer takes 1.8 s.
      for (let i = 0; i < 12; i++) {
        await h.answerNextFrame(1800, { status: 'fail' });
      }
      expect(h.workers).toHaveLength(1);
      expect(h.workers[0].terminated).toBe(false);
      expect(h.decodeSync).not.toHaveBeenCalled();
    });

    it('restarts a worker that never answers with the same 5 s budget every time', async () => {
      const h = createHarness();
      h.engine.start();
      await h.step(16);

      await h.step(5200);
      expect(h.workers).toHaveLength(2);
      const restartedAt = h.clock.now();
      await h.step(1100);
      expect(h.workers[1].frames.length).toBe(1);
      await h.step(restartedAt + 4700 - h.clock.now());
      expect(h.workers).toHaveLength(2);
      await h.step(700);
      expect(h.workers).toHaveLength(3);
    });

    it('resets the restart count once a worker answers again', async () => {
      const h = createHarness();
      h.engine.start();
      await h.step(16);
      h.currentWorker()?.crash();
      h.currentWorker()?.crash();
      expect(h.workers).toHaveLength(3);

      await h.step(1100);
      h.currentWorker()?.replyLatest({ status: 'fail' });

      // Three more consecutive failures are allowed before the main-thread fallback.
      await h.step(100);
      h.currentWorker()?.crash();
      h.currentWorker()?.crash();
      h.currentWorker()?.crash();
      expect(h.workers).toHaveLength(6);
      h.currentWorker()?.crash();
      expect(h.workers).toHaveLength(6);
    });

    it('falls back to main-thread decoding after three failed restarts', async () => {
      const h = createHarness();
      h.decodeSync.mockReturnValue('MAIN-THREAD');
      h.engine.start();
      await h.step(16);

      h.currentWorker()?.crash();
      h.currentWorker()?.crash();
      h.currentWorker()?.crash();
      expect(h.workers).toHaveLength(4);
      h.currentWorker()?.crash();
      expect(h.workers).toHaveLength(4);
      expect(h.workers.every((w) => w.terminated)).toBe(true);

      await h.step(1100);
      expect(h.decodeSync).toHaveBeenCalled();
      const [, width, height] = h.decodeSync.mock.calls[0];
      expect(Math.max(width, height)).toBeLessThanOrEqual(800);
      expect(h.events.onScanSuccess).toHaveBeenCalledWith('MAIN-THREAD', expect.objectContaining({ text: 'MAIN-THREAD' }));
      expect(h.workers).toHaveLength(4);
    });

    it('falls back to main-thread decoding when no worker can be spawned', async () => {
      const h = createHarness();
      h.blockWorkerSpawns();
      h.decodeSync.mockReturnValue('NO-WORKER');
      h.engine.start();
      await h.step(16);
      await h.step(1);

      expect(h.workers).toHaveLength(0);
      expect(h.events.onScanSuccess).toHaveBeenCalledWith('NO-WORKER', expect.objectContaining({ text: 'NO-WORKER' }));
    });
  });

  describe('video sources and lifecycle', () => {
    it('does not sample a paused live stream', async () => {
      const h = createHarness();
      h.source.paused = true;
      h.engine.start();
      await h.step(500);
      expect(h.currentWorker()?.frames).toHaveLength(0);

      h.source.paused = false;
      await h.step(100);
      expect(h.currentWorker()?.frames).toHaveLength(1);
    });

    it('samples a paused video file once and again on seek, then resumes on play', async () => {
      const h = createHarness();
      h.source.srcObject = null;
      h.source.src = 'blob:recording';
      h.source.paused = true;
      h.engine.start();
      await h.step(16);
      expect(h.currentWorker()?.frames).toHaveLength(1);

      await h.step(500);
      expect(h.currentWorker()?.frames).toHaveLength(1);

      h.source.emit('seeked');
      await h.step(0);
      expect(h.currentWorker()?.frames).toHaveLength(2);

      h.currentWorker()?.replyLatest({ status: 'fail' });
      h.source.paused = false;
      h.source.emit('play');
      await h.step(16);
      expect(h.currentWorker()?.frames).toHaveLength(3);
    });

    it('stop suspends sampling and detaches source listeners; start resumes cleanly', async () => {
      const h = createHarness();
      h.source.srcObject = null;
      h.source.src = 'blob:recording';
      h.engine.start();
      await h.step(16);
      expect(h.source.listenerCount).toBeGreaterThan(0);

      h.engine.stop();
      expect(h.source.listenerCount).toBe(0);
      expect(h.events.onStatusChange).toHaveBeenLastCalledWith('idle');
      expect(h.clock.pendingCount).toBe(0);

      // A late answer for the stopped session is ignored.
      h.currentWorker()?.replyLatest({ status: 'pass', decodedData: 'STALE' });
      expect(h.events.onScanSuccess).not.toHaveBeenCalled();

      h.engine.start();
      await h.step(16);
      h.currentWorker()?.replyLatest({ status: 'pass', decodedData: 'FRESH' });
      expect(h.events.onScanSuccess).toHaveBeenCalledWith('FRESH', expect.objectContaining({ text: 'FRESH' }));
      expect(h.workers).toHaveLength(1);
    });

    it('survives rapid start/stop cycles without leaking timers, listeners or workers', async () => {
      const h = createHarness();
      h.source.srcObject = null;
      h.source.src = 'blob:recording';
      for (let i = 0; i < 20; i++) {
        h.engine.start();
        await h.step(i % 3);
        h.engine.stop();
      }
      expect(h.clock.pendingCount).toBe(0);
      expect(h.source.listenerCount).toBe(0);
      expect(h.workers).toHaveLength(1);

      h.engine.destroy();
      expect(h.workers[0].released).toBe(true);
      expect(h.workers[0].terminated).toBe(false);
    });

    it('destroy releases the worker, silences events and ignores later starts', async () => {
      const h = createHarness();
      h.engine.start();
      await h.step(16);
      const worker = h.currentWorker();

      h.engine.destroy();
      expect(worker?.attached).toBe(false);
      expect(h.clock.pendingCount).toBe(0);

      h.engine.start();
      await h.step(100);
      expect(h.workers).toHaveLength(1);
      expect(worker?.frames).toHaveLength(1);
    });

    it('stops notifying a listener after it unsubscribes', async () => {
      const h = createHarness();
      h.unsubscribe();
      h.engine.start();
      await h.step(16);
      h.currentWorker()?.replyLatest({ status: 'pass', decodedData: 'QUIET' });
      expect(h.events.onScanSuccess).not.toHaveBeenCalled();
    });

    it('skips a stream until it has delivered its first frame', async () => {
      const h = createHarness();
      h.source.readyState = 0;
      h.engine.start();
      await h.step(200);
      expect(h.currentWorker()?.frames).toHaveLength(0);

      h.source.readyState = 2;
      await h.step(100);
      expect(h.currentWorker()?.frames).toHaveLength(1);
    });

    it('waits for a source to appear', async () => {
      let available = false;
      const h = createHarness({ getSource: () => (available ? new FakeSource() : null) });
      h.engine.start();
      await h.step(200);
      expect(h.currentWorker()?.frames).toHaveLength(0);

      available = true;
      await h.step(100);
      expect(h.currentWorker()?.frames).toHaveLength(1);
    });
  });

  describe('sessions sharing one worker (#1095)', () => {
    /**
     * Stand-in for the page's shared scanner worker: one stale-frame guard (the real one the
     * worker uses) serves every engine, and every admitted frame is answered after `latencyMs`.
     */
    function createSharedWorker(clock: FakeClock, latencyMs: number) {
      const guard = createStaleFrameGuard();
      const state = { codeVisible: false, posted: 0, stale: 0 };
      const factory: ScannerWorkerFactory = (handlers) => {
        let attached = true;
        return {
          postFrame: (request) => {
            state.posted += 1;
            const admitted = guard.admit(request.epochId, request.sequenceId);
            if (!admitted) state.stale += 1;
            const answer: Partial<ScannerResponse> = !admitted
              ? { status: 'fail', error: 'STALE_FRAME' }
              : state.codeVisible
                ? { status: 'pass', decodedData: 'REOPENED' }
                : { status: 'fail' };
            clock.setTimeout(() => {
              if (attached) handlers.onMessage({ sequenceId: request.sequenceId, epochId: request.epochId, ...answer });
            }, admitted ? latencyMs : 1);
          },
          release: () => {
            attached = false;
          },
          terminate: () => {
            attached = false;
          },
        };
      };
      return { factory, state };
    }

    const grabber: CameraFrameGrabber = {
      grabBitmap: (_source, width, height) => Promise.resolve({ width, height, close: () => {} }),
      grabPixels: (_source, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    };

    async function run(clock: FakeClock, ms: number) {
      for (let elapsed = 0; elapsed < ms; elapsed += 4) {
        clock.advance(4);
        await Promise.resolve();
        await Promise.resolve();
      }
    }

    it('decodes the first frame of a reopened scanner after a long session with no code', async () => {
      const clock = new FakeClock();
      const source = new FakeSource();
      const worker = createSharedWorker(clock, 20);
      const config = { getSource: () => source, clock, grabber, createWorker: worker.factory, detector: null, confirmations: 1 as const };

      const first = createCameraScannerEngine(config);
      first.start();
      await run(clock, 20_000);
      expect(worker.state.posted).toBeGreaterThan(200);
      first.destroy();

      worker.state.codeVisible = true;
      const postedBefore = worker.state.posted;
      const second = createCameraScannerEngine(config);
      const onScanSuccess = vi.fn();
      second.subscribe({ onScanSuccess });
      second.start();
      await run(clock, 60);

      expect(onScanSuccess).toHaveBeenCalledWith('REOPENED', expect.objectContaining({ text: 'REOPENED' }));
      expect(worker.state.posted - postedBefore).toBe(1);
      expect(worker.state.stale).toBe(0);
      second.destroy();
    });

    it('decodes at once when the same engine is stopped and started again', async () => {
      const clock = new FakeClock();
      const source = new FakeSource();
      const worker = createSharedWorker(clock, 20);
      const engine = createCameraScannerEngine({ getSource: () => source, clock, grabber, createWorker: worker.factory, detector: null, confirmations: 1 as const });
      const onScanSuccess = vi.fn();
      engine.subscribe({ onScanSuccess });

      engine.start();
      await run(clock, 5_000);
      engine.stop();
      worker.state.codeVisible = true;
      engine.start();
      await run(clock, 60);

      expect(onScanSuccess).toHaveBeenCalledTimes(1);
      expect(worker.state.stale).toBe(0);
    });
  });
});
