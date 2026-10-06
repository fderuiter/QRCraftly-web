/**
 * Headless tests for the Scannability Health Evaluator.
 *
 * Runs in the node environment with no React, no DOM and no global worker mock: the canvas, the
 * worker, the frame reader, the clock and the main-thread check are fakes injected through the
 * evaluator's public configuration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createScannabilityEvaluator,
  type PixelFrame,
  type ScannabilityAssessment,
  type ScannabilityCanvas,
  type ScannabilityClock,
  type ScannabilityEvaluatorConfig,
  type ScannabilityFrameReader,
  type ScannabilityResult,
  type ScannabilityWorkerFactory,
  type ScannabilityWorkerHandlers,
  type WorkerRequest,
} from '../index';
import { DEFAULT_CONFIG } from '@/constants';
import type { QRConfig } from '@/types';

/** Deterministic clock: timers and idle callbacks run only when the test advances time. */
class FakeClock implements ScannabilityClock {
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

  scheduleIdle(callback: () => void, timeoutMs: number) {
    this.setTimeout(callback, timeoutMs);
  }

  get pendingCount() {
    return this.tasks.size;
  }

  /** Moves time forward without running anything (to model worker latency). */
  skip(ms: number) {
    this.current += ms;
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

class FakeBitmap implements ImageBitmap {
  readonly close = vi.fn(() => {
    this.width = 0;
    this.height = 0;
  });
  constructor(
    public width = 10,
    public height = 10
  ) {}
}

class FakeCanvas implements ScannabilityCanvas {
  constructor(
    public width = 20,
    public height = 20
  ) {}
}

interface Posted {
  request: WorkerRequest;
  transfer: Transferable[];
}

/** One fake worker generation. Tests answer through `reply`, `crash`, or not at all (stall). */
class FakeWorker {
  readonly posted: Posted[] = [];
  terminated = false;
  failNextPost = false;

  constructor(private readonly handlers: ScannabilityWorkerHandlers) {}

  get last(): WorkerRequest {
    const entry = this.posted.at(-1);
    if (!entry) throw new Error('Nothing has been posted to this worker');
    return entry.request;
  }

  reply(response: Record<string, unknown>, configId = this.last.configId) {
    this.handlers.onMessage({ configId, ...response });
  }

  sendRaw(payload: unknown) {
    this.handlers.onMessage(payload);
  }

  crash() {
    this.handlers.onError(new Error('worker crashed'));
  }
}

const frameOf = (width = 10, height = 10): PixelFrame => ({
  data: new Uint8ClampedArray(width * height * 4).fill(255),
  width,
  height,
});

function isWorkerRequestLike(value: unknown): value is WorkerRequest {
  return typeof value === 'object' && value !== null && 'width' in value && 'height' in value;
}

function createHarness(overrides: Partial<ScannabilityEvaluatorConfig> = {}) {
  const clock = new FakeClock();
  const workers: FakeWorker[] = [];
  let spawnMode: 'ok' | 'unsupported' | 'throw' = 'ok';
  let canvas: FakeCanvas | null = new FakeCanvas();

  const createWorker: ScannabilityWorkerFactory = (handlers) => {
    if (spawnMode === 'throw') throw new Error('SecurityError: worker blocked by CSP');
    if (spawnMode === 'unsupported') return null;
    const worker = new FakeWorker(handlers);
    workers.push(worker);
    return {
      post: (request, transfer) => {
        if (worker.failNextPost) {
          worker.failNextPost = false;
          throw new Error('DataCloneError: message serialization failed');
        }
        if (!isWorkerRequestLike(request)) throw new Error('unexpected request shape');
        worker.posted.push({ request, transfer });
      },
      terminate: () => {
        worker.terminated = true;
      },
    };
  };

  const captured: FakeBitmap[] = [];
  let captureMode: 'ok' | 'reject' | 'unsupported' = 'ok';
  const frames: ScannabilityFrameReader = {
    captureBitmap: vi.fn((source: ScannabilityCanvas) => {
      if (captureMode === 'unsupported') return null;
      if (captureMode === 'reject') return Promise.reject(new Error('capture failed'));
      const bitmap = new FakeBitmap(source.width, source.height);
      captured.push(bitmap);
      return Promise.resolve(bitmap);
    }),
    readPixels: vi.fn((source: ScannabilityCanvas) => frameOf(source.width, source.height)),
    bitmapToPixels: vi.fn((bitmap: ImageBitmap) => frameOf(bitmap.width, bitmap.height)),
  };

  const runCheck = vi.fn<(frame: PixelFrame, moduleCount?: number) => ScannabilityResult>(
    () => ({ success: true, physicalReady: true })
  );
  const onFail = vi.fn<(errorType: string) => void>();
  const assessments: ScannabilityAssessment[] = [];

  const evaluator = createScannabilityEvaluator({
    config: { ...DEFAULT_CONFIG },
    getCanvas: () => canvas,
    onFail,
    createWorker,
    clock,
    frames,
    runCheck,
    ...overrides,
  });
  evaluator.subscribe((assessment) => assessments.push(assessment));

  /** Lets resolved promises (bitmap capture, answers) run. */
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  return {
    clock,
    evaluator,
    workers,
    frames,
    captured,
    runCheck,
    onFail,
    assessments,
    flush,
    worker: () => {
      const worker = workers.at(-1);
      if (!worker) throw new Error('No worker has been spawned');
      return worker;
    },
    status: () => evaluator.getAssessment().status,
    setSpawnMode: (mode: 'ok' | 'unsupported' | 'throw') => {
      spawnMode = mode;
    },
    setCaptureMode: (mode: 'ok' | 'reject' | 'unsupported') => {
      captureMode = mode;
    },
    setCanvas: (next: FakeCanvas | null) => {
      canvas = next;
    },
  };
}

describe('Scannability Health Evaluator (headless)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('one question, one answer', () => {
    it('starts idle with a health score and export risk for the config', () => {
      const h = createHarness();
      expect(h.evaluator.getAssessment()).toEqual({
        status: 'idle',
        health: expect.objectContaining({ score: 100 }),
        exportRisk: 'caution',
        workerRecoveryActive: false,
      });
      expect(h.workers).toHaveLength(0);
    });

    it('answers a pixel check through the worker with status, health and export risk', async () => {
      const h = createHarness();
      const frame = frameOf();
      const answer = h.evaluator.check({ imageData: frame, moduleCount: 21 });

      expect(h.worker().posted).toHaveLength(1);
      expect(h.worker().posted[0].request).toMatchObject({
        imageData: frame,
        width: 10,
        height: 10,
        configId: '1',
        moduleCount: 21,
      });
      expect(h.worker().posted[0].transfer).toEqual([frame.data.buffer]);

      h.worker().reply({ success: true, physicalReady: true });

      await expect(answer).resolves.toEqual({
        status: 'physical-pass',
        health: expect.objectContaining({ score: 100 }),
        exportRisk: 'safe',
        workerRecoveryActive: false,
      });
      expect(h.onFail).not.toHaveBeenCalled();
    });

    it('transfers a caller bitmap to the worker', () => {
      const h = createHarness();
      const bitmap = new FakeBitmap(30, 30);
      void h.evaluator.check({ imageBitmap: bitmap });

      expect(h.worker().posted[0].request).toMatchObject({ imageBitmap: bitmap, width: 30, height: 30 });
      expect(h.worker().posted[0].transfer).toEqual([bitmap]);
      expect(bitmap.close).not.toHaveBeenCalled();
    });

    it('maps a digital-only pass and a failure, reporting only failures that carry an error', () => {
      const h = createHarness();
      void h.evaluator.check({ imageData: frameOf() });
      h.worker().reply({ success: true, physicalReady: false });
      expect(h.status()).toBe('digital-pass');

      void h.evaluator.check({ imageData: frameOf() });
      h.worker().reply({ success: false, physicalReady: false, error: null });
      expect(h.status()).toBe('fail');
      expect(h.onFail).not.toHaveBeenCalled();

      void h.evaluator.check({ imageData: frameOf() });
      h.worker().reply({ success: false, physicalReady: false, error: 'SECURITY_VIOLATION' });
      expect(h.onFail).toHaveBeenCalledWith('SECURITY_VIOLATION');
      expect(h.evaluator.getAssessment().exportRisk).toBe('unsafe');
    });

    it('folds localized contrast metrics into the health score', () => {
      const h = createHarness();
      void h.evaluator.check({ imageData: frameOf() });
      h.worker().reply({
        success: true,
        physicalReady: true,
        localContrastViolations: 6,
        minLocalContrast: 1.8,
      });

      const { health } = h.evaluator.getAssessment();
      expect(health.score).toBeLessThan(100);
      expect(health.warnings.some((w) => w.includes('Local contrast drop detected'))).toBe(true);
    });

    it('recomputes health and export risk when the config changes', () => {
      const h = createHarness();
      const lowContrast: QRConfig = { ...DEFAULT_CONFIG, fgColor: '#eeeeee', eyeColor: '#eeeeee', bgColor: '#ffffff' };
      h.evaluator.setConfig(lowContrast);

      const assessment = h.evaluator.getAssessment();
      expect(assessment.health.criticalWarnings).toContain('critical-contrast');
      expect(assessment.exportRisk).toBe('unsafe');
      expect(h.assessments.at(-1)).toBe(assessment);
    });

    it('uses the injected module count when a check does not name one', () => {
      const h = createHarness({ getModuleCount: () => 33 });
      void h.evaluator.check({ imageData: frameOf() });
      expect(h.worker().last.moduleCount).toBe(33);

      void h.evaluator.check({ imageData: frameOf(), moduleCount: 25 });
      expect(h.worker().last.moduleCount).toBe(25);
    });
  });

  describe('request sequencing', () => {
    it('ignores a late result for a superseded request and resolves it with null', async () => {
      const h = createHarness();
      const first = h.evaluator.check({ imageData: frameOf() });
      const second = h.evaluator.check({ imageData: frameOf() });

      h.worker().reply({ success: false, physicalReady: false, error: 'NOT_FOUND' }, '1');
      expect(h.onFail).not.toHaveBeenCalled();
      await expect(first).resolves.toBeNull();

      h.worker().reply({ success: true, physicalReady: true }, '2');
      await expect(second).resolves.toMatchObject({ status: 'physical-pass' });
    });

    it('ignores untracked messages without a request id', () => {
      const h = createHarness();
      void h.evaluator.check({ imageData: frameOf() });
      h.worker().sendRaw({ success: true, physicalReady: true, error: null });
    });

    it('keeps checking on a superseded ACK and returns to idle on a dropped current request', async () => {
      const h = createHarness();
      void h.evaluator.check({ imageBitmap: new FakeBitmap() });
      const current = h.evaluator.check({ imageBitmap: new FakeBitmap() });

      h.worker().reply({ dropped: true }, '1');

      h.worker().reply({ dropped: true }, '2');
      expect(h.status()).toBe('idle');
      await expect(current).resolves.toBeNull();
      expect(h.clock.pendingCount).toBe(0);
    });

    it('fails the check when the worker answers with an invalid payload', () => {
      const h = createHarness();
      void h.evaluator.check({ imageData: frameOf() });
      h.worker().sendRaw({ success: 'yes' });
      expect(h.status()).toBe('fail');
      expect(h.onFail).toHaveBeenCalledWith('VALIDATION_ERROR');
    });
  });

  describe('watchdog and main-thread fallback', () => {
    it('answers on the main thread when the worker stalls for 1500ms', async () => {
      const h = createHarness();
      const frame = frameOf();
      const answer = h.evaluator.check({ imageData: frame, moduleCount: 21 });

      h.clock.advance(1499);
      expect(h.runCheck).not.toHaveBeenCalled();
      h.clock.advance(1);

      expect(h.runCheck).toHaveBeenCalledWith(frame, 21);
      await expect(answer).resolves.toMatchObject({ status: 'physical-pass', workerRecoveryActive: true });
    });

    it('reads the canvas in the fallback when the transferred bitmap is gone', () => {
      const h = createHarness();
      const bitmap = new FakeBitmap();
      void h.evaluator.check({ imageBitmap: bitmap });
      bitmap.close(); // a transferred bitmap reports 0x0 on the main thread

      h.clock.advance(1500);

      expect(h.frames.readPixels).toHaveBeenCalled();
      expect(h.runCheck).toHaveBeenCalledWith(expect.objectContaining({ width: 20, height: 20 }), undefined);
    });

    it('fails when the watchdog finds no pixels to evaluate', () => {
      const h = createHarness();
      const bitmap = new FakeBitmap();
      void h.evaluator.check({ imageBitmap: bitmap });
      bitmap.close();
      h.setCanvas(new FakeCanvas(0, 0));

      h.clock.advance(1500);

      expect(h.runCheck).not.toHaveBeenCalled();
      expect(h.status()).toBe('fail');
    });

    it('replaces the worker after consecutive watchdog timeouts', () => {
      const h = createHarness();
      void h.evaluator.check({ imageData: frameOf() });
      h.clock.advance(1500);
      expect(h.worker().terminated).toBe(false);

      void h.evaluator.check({ imageData: frameOf() });
      h.clock.advance(1500);
      const stalled = h.worker();
      expect(stalled.terminated).toBe(true);

      void h.evaluator.check({ imageData: frameOf() });
      expect(h.workers).toHaveLength(2);
      expect(h.worker()).not.toBe(stalled);
    });

    it('fails immediately on a worker crash, then heals on the next check', async () => {
      const h = createHarness();
      const pending = h.evaluator.check({ imageData: frameOf() });
      const crashed = h.worker();
      crashed.crash();

      expect(h.evaluator.getAssessment()).toMatchObject({ status: 'fail', workerRecoveryActive: true });
      expect(crashed.terminated).toBe(true);
      expect(h.onFail).toHaveBeenCalledWith('WORKER_ERROR');
      await expect(pending).resolves.toMatchObject({ status: 'fail' });
      expect(h.clock.pendingCount).toBe(0);

      void h.evaluator.check({ imageData: frameOf() });
      expect(h.worker()).not.toBe(crashed);
      h.worker().reply({ success: false, physicalReady: false, error: 'LOW_CONTRAST' });
      expect(h.evaluator.getAssessment()).toMatchObject({ status: 'fail', workerRecoveryActive: false });
    });

    it('runs every check on the main thread when workers are unavailable', async () => {
      const h = createHarness({ getModuleCount: () => 21 });
      h.setSpawnMode('unsupported');
      const bitmap = new FakeBitmap();
      h.runCheck.mockReturnValue({ success: false, physicalReady: false, error: 'NOT_FOUND' });

      const answer = h.evaluator.check({ imageBitmap: bitmap });
      expect(h.runCheck).not.toHaveBeenCalled(); // deferred to an idle callback
      h.clock.advance(100);

      expect(h.frames.bitmapToPixels).toHaveBeenCalledWith(bitmap);
      expect(h.runCheck).toHaveBeenCalledWith(expect.objectContaining({ width: 10 }), 21);
      expect(bitmap.close).toHaveBeenCalledTimes(1);
      expect(h.onFail).toHaveBeenCalledWith('NOT_FOUND');
      await expect(answer).resolves.toMatchObject({ status: 'fail' });
    });

    it('falls back to the main thread when spawning the worker throws', () => {
      const h = createHarness();
      h.setSpawnMode('throw');
      void h.evaluator.check({ imageData: frameOf() });
      h.clock.advance(100);
      expect(h.status()).toBe('physical-pass');
      expect(h.workers).toHaveLength(0);
    });

    it('returns to idle without a canvas when no worker is available', async () => {
      const h = createHarness();
      h.setSpawnMode('unsupported');
      h.setCanvas(null);
      const answer = h.evaluator.check();
      h.clock.advance(100);
      expect(h.status()).toBe('idle');
      await expect(answer).resolves.toBeNull();
    });

    it('reports a failing main-thread check as a validation error', () => {
      const h = createHarness();
      h.setSpawnMode('unsupported');
      h.runCheck.mockImplementation(() => {
        throw new Error('decoder exploded');
      });
      void h.evaluator.check({ imageData: frameOf() });
      h.clock.advance(100);
      expect(h.status()).toBe('fail');
      expect(h.onFail).toHaveBeenCalledWith('VALIDATION_ERROR');
    });
  });

  describe('canvas capture and buffer transfer', () => {
    it('captures the canvas as a bitmap when a check carries no pixels', async () => {
      const h = createHarness();
      void h.evaluator.check();
      expect(h.worker().posted).toHaveLength(0);

      h.clock.advance(100);
      await h.flush();

      const [bitmap] = h.captured;
      expect(h.worker().posted[0].request).toMatchObject({ imageBitmap: bitmap, width: 20, height: 20 });
      expect(h.worker().posted[0].transfer).toEqual([bitmap]);
    });

    it('goes idle when the canvas has no size', () => {
      const h = createHarness();
      h.setCanvas(new FakeCanvas(0, 0));
      void h.evaluator.check();
      h.clock.advance(100);
      expect(h.status()).toBe('idle');
      expect(h.clock.pendingCount).toBe(0);
    });

    it('resends canvas pixels when the worker cannot draw bitmaps, and stops capturing bitmaps', async () => {
      const h = createHarness();
      void h.evaluator.check({ imageBitmap: new FakeBitmap(), moduleCount: 21 });
      h.worker().reply({ retryWithImageData: true });

      expect(h.worker().last).toMatchObject({
        configId: '1',
        moduleCount: 21,
        imageData: expect.objectContaining({ width: 20, height: 20 }),
      });
      expect(h.worker().posted[1].transfer).toEqual([expect.any(ArrayBuffer)]);

      h.worker().reply({ success: true, physicalReady: true });
      void h.evaluator.check();
      h.clock.advance(100);
      await h.flush();

      expect(h.frames.captureBitmap).not.toHaveBeenCalled();
      expect(h.worker().last.imageData).toBeDefined();
    });

    it('falls back to a synchronous pixel read when bitmap capture fails', async () => {
      const h = createHarness();
      h.setCaptureMode('reject');
      void h.evaluator.check();
      h.clock.advance(100);
      await h.flush();
      expect(h.worker().last.imageData).toMatchObject({ width: 20, height: 20 });
    });

    it('closes the bitmap and fails when the worker rejects the transfer', () => {
      const h = createHarness();
      void h.evaluator.check({ imageData: frameOf() });
      h.worker().reply({ success: true, physicalReady: true });
      h.worker().failNextPost = true;

      const bitmap = new FakeBitmap();
      void h.evaluator.check({ imageBitmap: bitmap });

      expect(bitmap.close).toHaveBeenCalledTimes(1);
      expect(h.status()).toBe('fail');
    });

    it('drops frames while the worker is busy and slower than a display frame', async () => {
      const h = createHarness();
      void h.evaluator.check({ imageBitmap: new FakeBitmap() });
      h.clock.skip(50);
      h.worker().reply({ success: true, physicalReady: true });

      void h.evaluator.check({ imageBitmap: new FakeBitmap() });
      const dropped = new FakeBitmap();
      const answer = h.evaluator.check({ imageBitmap: dropped });

      expect(h.worker().posted).toHaveLength(2);
      expect(dropped.close).toHaveBeenCalledTimes(1);
      await expect(answer).resolves.toBeNull();
    });

    it('never leaks a bitmap across 1,000 rapid checks', () => {
      const h = createHarness();
      const bitmaps: FakeBitmap[] = [];
      for (let i = 0; i < 1000; i++) {
        const bitmap = new FakeBitmap();
        bitmaps.push(bitmap);
        void h.evaluator.check({ imageBitmap: bitmap });
      }
      const transferred = h.worker().posted.length;
      const closed = bitmaps.filter((b) => b.close.mock.calls.length > 0).length;
      expect(transferred + closed).toBe(1000);
    });
  });

  describe('lifecycle', () => {
    it('destroy terminates an idle worker at once', () => {
      const h = createHarness();
      void h.evaluator.check({ imageData: frameOf() });
      h.worker().reply({ success: true, physicalReady: true });
      h.evaluator.destroy();

      expect(h.worker().terminated).toBe(true);
      expect(h.clock.pendingCount).toBe(0);
    });

    it('destroy resolves pending checks and terminates a busy worker once it answers', async () => {
      const h = createHarness();
      const answer = h.evaluator.check({ imageData: frameOf() });
      h.evaluator.destroy();

      await expect(answer).resolves.toBeNull();
      expect(h.worker().terminated).toBe(false);
      h.worker().reply({ success: true, physicalReady: true });
      expect(h.worker().terminated).toBe(true);
      expect(h.clock.pendingCount).toBe(0);

      const bitmap = new FakeBitmap();
      await expect(h.evaluator.check({ imageBitmap: bitmap })).resolves.toBeNull();
      expect(bitmap.close).toHaveBeenCalledTimes(1);
    });

    it('destroy terminates a busy worker that never answers after the watchdog window', () => {
      const h = createHarness();
      void h.evaluator.check({ imageData: frameOf() });
      h.evaluator.destroy();

      h.clock.advance(1499);
      expect(h.worker().terminated).toBe(false);
      h.clock.advance(1);
      expect(h.worker().terminated).toBe(true);
      expect(h.runCheck).not.toHaveBeenCalled();
    });

    it('stops notifying a listener after it unsubscribes', () => {
      const h = createHarness();
      const listener = vi.fn();
      const unsubscribe = h.evaluator.subscribe(listener);
      void h.evaluator.check({ imageData: frameOf() });
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
      h.worker().reply({ success: true, physicalReady: true });
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
