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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EmpiricalScanPipeline, MAX_WORKER_FAILURES, paintScanFrame, SCAN_FRAME_SIZE, SCAN_WATCHDOG_MS, type ScanOutcome, type WorkerLike, type DetectorLike } from '../index';

const frame = () => ({ data: new Uint8ClampedArray(SCAN_FRAME_SIZE * SCAN_FRAME_SIZE * 4), width: SCAN_FRAME_SIZE, height: SCAN_FRAME_SIZE }) as unknown as ImageData;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeWorker implements WorkerLike {
  posted: Array<{ configId: string; buffer: ArrayBuffer }> = [];
  terminated = false;
  private listener: ((event: MessageEvent<unknown>) => void) | null = null;
  postMessage(message: unknown) {
    this.posted.push(message as { configId: string; buffer: ArrayBuffer });
  }
  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) {
    this.listener = listener;
  }
  removeEventListener() {
    this.listener = null;
  }
  terminate() {
    this.terminated = true;
  }
  reply(index: number, data: Record<string, unknown>) {
    const request = this.posted[index];
    this.listener?.({ data: { configId: request.configId, buffer: request.buffer, physicalReady: false, ...data } } as MessageEvent<unknown>);
  }
}

interface SetupOverrides {
  detector?: DetectorLike | null;
  worker?: FakeWorker | null;
  inputActive?: () => boolean;
  createWorker?: () => WorkerLike | null;
  expectedPayload?: () => string;
}

function setup(overrides: SetupOverrides = {}) {
  const results: ScanOutcome[] = [];
  const captureFrame = vi.fn(frame);
  const worker = overrides.worker === undefined ? new FakeWorker() : overrides.worker;
  const pipeline = new EmpiricalScanPipeline({
    captureFrame,
    expectedPayload: overrides.expectedPayload ?? (() => 'https://qrcraftly.com'),
    isInputActive: overrides.inputActive ?? (() => false),
    onResult: (r) => results.push(r),
    detector: overrides.detector ?? null,
    createWorker: overrides.createWorker ?? (() => worker),
  });
  return { pipeline, results, captureFrame, worker };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('empirical scan pipeline', () => {
  it('reports SCANNABLE with the decoded text from the native detector', async () => {
    const detector = { detect: vi.fn().mockResolvedValue([{ rawValue: 'hello arcade' }]) };
    const { pipeline, results, worker } = setup({ detector });
    pipeline.request();
    await flush();
    expect(results).toEqual([{ status: 'scannable', decoded: 'hello arcade', engine: 'native' }]);
    expect(worker?.posted).toHaveLength(0);
  });

  it('reports CORRUPTED when nothing (or something dangerous) decodes', async () => {
    const detector = { detect: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ rawValue: 'javascript:alert(1)' }]) };
    const { pipeline, results } = setup({ detector });
    pipeline.request();
    await flush();
    pipeline.request();
    await flush();
    expect(results.map((r) => r.status)).toEqual(['corrupted', 'corrupted']);
    expect(results[1].decoded).toBeNull();
  });

  it('falls back to the worker with a zero-copy transfer when the detector fails', async () => {
    const detector = { detect: vi.fn().mockRejectedValue(new Error('unsupported')) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pipeline, results, worker } = setup({ detector });
    pipeline.request();
    await flush();
    expect(worker!.posted).toHaveLength(1);
    const request = worker!.posted[0] as unknown as { imageData: { data: Uint8ClampedArray }; buffer: ArrayBuffer; width: number };
    expect(request.width).toBe(SCAN_FRAME_SIZE);
    expect(request.imageData.data.buffer).toBe(request.buffer);
    worker!.reply(0, { success: true });
    expect(results).toEqual([{ status: 'scannable', decoded: 'https://qrcraftly.com', engine: 'worker' }]);
    warn.mockRestore();
  });

  it('reports CORRUPTED when the worker cannot decode', async () => {
    const { pipeline, results, worker } = setup();
    pipeline.request();
    await flush();
    worker!.reply(0, { success: false });
    expect(results).toEqual([{ status: 'corrupted', decoded: null, engine: 'worker' }]);
  });

  it('recycles returned buffers through the double-buffer pool', async () => {
    const { pipeline, worker } = setup();
    pipeline.request();
    await flush();
    const first = worker!.posted[0].buffer;
    worker!.reply(0, { success: true });
    pipeline.request();
    await flush();
    // The next request reuses a pooled buffer rather than allocating per frame.
    expect(worker!.posted[1].buffer.byteLength).toBe(SCAN_FRAME_SIZE * SCAN_FRAME_SIZE * 4);
    worker!.reply(1, { success: true });
    pipeline.request();
    await flush();
    expect([worker!.posted[1].buffer, worker!.posted[2].buffer]).toContain(first);
  });

  it('coalesces requests while busy and runs one catch-up scan when input stops', async () => {
    let active = true;
    const { pipeline, results, worker, captureFrame } = setup({ inputActive: () => active });
    pipeline.request();
    await flush();
    pipeline.request();
    pipeline.request();
    pipeline.request();
    expect(pipeline.hasPendingCatchUp).toBe(true);
    expect(captureFrame).toHaveBeenCalledTimes(1);

    worker!.reply(0, { success: true });
    // The board changed while that scan ran, so its verdict is not published (#1706).
    expect(results).toHaveLength(0);
    expect(pipeline.isBusy).toBe(false);
    // Still firing: the catch-up waits.
    expect(captureFrame).toHaveBeenCalledTimes(1);

    active = false;
    pipeline.settle();
    await flush();
    expect(captureFrame).toHaveBeenCalledTimes(2);
    worker!.reply(1, { success: false });
    expect(results.map((r) => r.status)).toEqual(['corrupted']);
    expect(pipeline.hasPendingCatchUp).toBe(false);
  });

  it('runs the catch-up immediately when input already stopped', async () => {
    const { pipeline, worker, captureFrame } = setup();
    pipeline.request();
    await flush();
    pipeline.request();
    worker!.reply(0, { success: true });
    await flush();
    expect(captureFrame).toHaveBeenCalledTimes(2);
  });

  it('ignores late replies for superseded scans', async () => {
    const { pipeline, results, worker } = setup();
    pipeline.request();
    await flush();
    worker!.reply(0, { success: true, configId: '999' });
    expect(results).toHaveLength(0);
    expect(pipeline.isBusy).toBe(true);
  });

  it('re-queues dropped requests', async () => {
    const { pipeline, worker, captureFrame } = setup();
    pipeline.request();
    await flush();
    worker!.reply(0, { dropped: true });
    await flush();
    expect(captureFrame).toHaveBeenCalledTimes(2);
  });

  it('frees a stalled worker after the watchdog timeout', async () => {
    vi.useFakeTimers();
    const { pipeline, worker, captureFrame } = setup();
    pipeline.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(pipeline.isBusy).toBe(true);
    await vi.advanceTimersByTimeAsync(SCAN_WATCHDOG_MS + 10);
    expect(captureFrame).toHaveBeenCalledTimes(2);
    expect(worker!.posted).toHaveLength(2);
  });

  it('reports unavailable without any decoder and stops cleanly on dispose', async () => {
    const { pipeline, results } = setup({ worker: null });
    pipeline.request();
    await flush();
    expect(results).toEqual([{ status: 'unavailable', decoded: null, engine: 'none' }]);

    const second = setup();
    second.pipeline.request();
    await flush();
    second.pipeline.dispose();
    expect(second.worker!.terminated).toBe(true);
    second.pipeline.request();
    expect(second.captureFrame).toHaveBeenCalledTimes(1);
  });
});

describe('empirical scan pipeline recovery (#1706)', () => {
  const hanging = (): DetectorLike => ({ detect: vi.fn(() => new Promise<ReadonlyArray<{ rawValue: string }>>(() => undefined)) });

  it('bounds a native detector that never answers and hands over to the worker', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const detector = hanging();
    const { pipeline, results, worker } = setup({ detector });
    pipeline.request();
    await vi.advanceTimersByTimeAsync(SCAN_WATCHDOG_MS + 10);
    expect(worker!.posted).toHaveLength(1);
    worker!.reply(0, { success: true });
    expect(results).toEqual([{ status: 'scannable', decoded: 'https://qrcraftly.com', engine: 'worker' }]);
    // The hung detector is not asked again.
    pipeline.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(detector.detect).toHaveBeenCalledTimes(1);
    expect(worker!.posted).toHaveLength(2);
    warn.mockRestore();
  });

  it('reports unavailable when the detector hangs and there is no worker', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pipeline, results } = setup({ detector: hanging(), worker: null });
    pipeline.request();
    await vi.advanceTimersByTimeAsync(SCAN_WATCHDOG_MS + 10);
    expect(results).toEqual([{ status: 'unavailable', decoded: null, engine: 'none' }]);
    expect(pipeline.isBusy).toBe(false);
    warn.mockRestore();
  });

  it('ignores a native answer that arrives after the deadline', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let answer: (codes: ReadonlyArray<{ rawValue: string }>) => void = () => undefined;
    const detector = { detect: vi.fn(() => new Promise<ReadonlyArray<{ rawValue: string }>>((resolve) => (answer = resolve))) };
    const { pipeline, results, worker } = setup({ detector });
    pipeline.request();
    await vi.advanceTimersByTimeAsync(SCAN_WATCHDOG_MS + 10);
    answer([{ rawValue: 'too late' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toHaveLength(0);
    worker!.reply(0, { success: false });
    expect(results).toEqual([{ status: 'corrupted', decoded: null, engine: 'worker' }]);
    warn.mockRestore();
  });

  it('replaces a silent worker, then reports unavailable after repeated failures', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn(() => {
      const next = new FakeWorker();
      workers.push(next);
      return next;
    });
    const { pipeline, results } = setup({ createWorker });
    pipeline.request();
    await vi.advanceTimersByTimeAsync(0);
    for (let failure = 0; failure < MAX_WORKER_FAILURES; failure++) {
      await vi.advanceTimersByTimeAsync(SCAN_WATCHDOG_MS + 10);
    }
    expect(createWorker).toHaveBeenCalledTimes(MAX_WORKER_FAILURES);
    expect(workers.every((w) => w.terminated)).toBe(true);
    expect(results).toEqual([{ status: 'unavailable', decoded: null, engine: 'none' }]);
    expect(pipeline.isBusy).toBe(false);

    // No endless retries: later requests answer at once without a new worker.
    await vi.advanceTimersByTimeAsync(SCAN_WATCHDOG_MS * 5);
    pipeline.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(createWorker).toHaveBeenCalledTimes(MAX_WORKER_FAILURES);
    expect(results.at(-1)?.status).toBe('unavailable');
  });

  it('recovers through a fresh worker after one stall', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const { pipeline, results } = setup({
      createWorker: () => {
        const next = new FakeWorker();
        workers.push(next);
        return next;
      },
    });
    pipeline.request();
    await vi.advanceTimersByTimeAsync(SCAN_WATCHDOG_MS + 10);
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    workers[1].reply(0, { success: true });
    expect(results).toEqual([{ status: 'scannable', decoded: 'https://qrcraftly.com', engine: 'worker' }]);
  });

  it('treats a worker that throws on post or on creation as a failure, not a hang', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: WorkerLike = {
      postMessage: () => {
        throw new Error('DataCloneError');
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      terminate: vi.fn(),
    };
    const posting = setup({ createWorker: () => broken });
    posting.pipeline.request();
    await flush();
    expect(posting.results).toEqual([{ status: 'unavailable', decoded: null, engine: 'none' }]);
    expect(posting.pipeline.isBusy).toBe(false);
    expect(broken.terminate).toHaveBeenCalledTimes(MAX_WORKER_FAILURES);

    const creating = setup({
      createWorker: () => {
        throw new Error('blocked by CSP');
      },
    });
    creating.pipeline.request();
    await flush();
    expect(creating.results).toEqual([{ status: 'unavailable', decoded: null, engine: 'none' }]);
    expect(creating.pipeline.isBusy).toBe(false);
    warn.mockRestore();
  });

  it('names the board the worker scanned, not the board shown when it answers', async () => {
    let payload = 'https://board-a.example';
    const { pipeline, results, worker } = setup({ expectedPayload: () => payload });
    pipeline.request();
    await flush();
    payload = 'https://board-b.example';
    worker!.reply(0, { success: true });
    expect(results).toEqual([{ status: 'scannable', decoded: 'https://board-a.example', engine: 'worker' }]);
  });

  it('publishes no native verdict for a board that changed while it decoded', async () => {
    let answer: (codes: ReadonlyArray<{ rawValue: string }>) => void = () => undefined;
    const detector = {
      detect: vi
        .fn<DetectorLike['detect']>()
        .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
        .mockResolvedValue([]),
    };
    const { pipeline, results, captureFrame } = setup({ detector });
    pipeline.request();
    await flush();
    pipeline.request();
    answer([{ rawValue: 'old board' }]);
    await flush();
    expect(captureFrame).toHaveBeenCalledTimes(2);
    expect(results).toEqual([{ status: 'corrupted', decoded: null, engine: 'native' }]);
  });

  it('drops pending work and timers on dispose', async () => {
    vi.useFakeTimers();
    let answer: (codes: ReadonlyArray<{ rawValue: string }>) => void = () => undefined;
    const detector = { detect: vi.fn(() => new Promise<ReadonlyArray<{ rawValue: string }>>((resolve) => (answer = resolve))) };
    const { pipeline, results, captureFrame } = setup({ detector });
    pipeline.request();
    pipeline.request();
    pipeline.dispose();
    expect(vi.getTimerCount()).toBe(0);
    answer([{ rawValue: 'late' }]);
    await vi.advanceTimersByTimeAsync(SCAN_WATCHDOG_MS * 2);
    pipeline.settle();
    expect(results).toHaveLength(0);
    expect(captureFrame).toHaveBeenCalledTimes(1);
  });
});

describe('scan frame painter', () => {
  it('paints only dark cells inside a quiet zone', () => {
    const rects: number[][] = [];
    const ctx = { fillStyle: '' as string, fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]) };
    paintScanFrame(ctx, 100, 2, 1, (r, c) => r === c, { fg: '#000', bg: '#fff' });
    expect(rects[0]).toEqual([0, 0, 100, 100]);
    expect(rects).toHaveLength(3);
    expect(rects[1][0]).toBe(25);
    expect(rects[2][0]).toBe(50);
  });
});
