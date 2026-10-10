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
import { EmpiricalScanPipeline, paintScanFrame, SCAN_FRAME_SIZE, SCAN_WATCHDOG_MS, type ScanOutcome, type WorkerLike, type DetectorLike } from '../index';

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

function setup(overrides: { detector?: DetectorLike | null; worker?: FakeWorker | null; inputActive?: () => boolean } = {}) {
  const results: ScanOutcome[] = [];
  const captureFrame = vi.fn(frame);
  const worker = overrides.worker === undefined ? new FakeWorker() : overrides.worker;
  const pipeline = new EmpiricalScanPipeline({
    captureFrame,
    expectedPayload: () => 'https://qrcraftly.com',
    isInputActive: overrides.inputActive ?? (() => false),
    onResult: (r) => results.push(r),
    detector: overrides.detector ?? null,
    createWorker: () => worker,
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
    expect(results).toHaveLength(1);
    // Still firing: the catch-up waits.
    expect(captureFrame).toHaveBeenCalledTimes(1);

    active = false;
    pipeline.settle();
    await flush();
    expect(captureFrame).toHaveBeenCalledTimes(2);
    worker!.reply(1, { success: false });
    expect(results.map((r) => r.status)).toEqual(['scannable', 'corrupted']);
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
