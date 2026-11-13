// @vitest-environment jsdom
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TILE_SLOT_FAILURES,
  TILE_JOB_DEADLINE_MS,
  createDecoderPool,
  createTileReader,
  type TileCode,
  type TileReadRequest,
  type TileReadResponse,
  type TileWorker,
} from '../multicode';

/** A worker the test answers by hand. It records every request it was posted. */
class FakeTileWorker implements TileWorker {
  onmessage: ((event: MessageEvent<TileReadResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: TileReadRequest[] = [];
  terminated = false;
  throwOnPost = false;
  postMessage(message: TileReadRequest): void {
    if (this.throwOnPost) throw new Error('DataCloneError');
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Answers the request at `index` with these codes. */
  answer(index: number, codes: Array<TileCode | null> = []): void {
    const request = this.posted[index];
    this.onmessage?.(new MessageEvent('message', { data: { id: request.id, codes } }));
  }
  /** Reports a crash the way a real worker does, as an `ErrorEvent`. */
  crash(): void {
    this.onerror?.(new ErrorEvent('error', { message: 'boom' }));
  }
  /** Reports a reply that could not be deserialized. */
  garble(): void {
    this.onmessageerror?.(new MessageEvent('messageerror'));
  }
}

/** The smallest ImageBitmap the reader touches: its size and `close`. */
class OffscreenCanvasLike implements ImageBitmap {
  readonly width = 64;
  readonly height = 64;
  closed = false;
  close(): void {
    this.closed = true;
  }
}

const code = (text: string): TileCode => ({
  text,
  version: 1,
  level: 'L',
  corners: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
});

function setup(options: { poolSize?: number; spawn?: () => TileWorker; grab?: () => Promise<ImageBitmap> } = {}) {
  const callbacks: Array<() => void> = [];
  const video = {
    readyState: 4,
    videoWidth: 64,
    videoHeight: 64,
    requestVideoFrameCallback: (callback: () => void) => callbacks.push(callback),
    cancelVideoFrameCallback: vi.fn(),
  };
  const workers: FakeTileWorker[] = [];
  const spawnWorker =
    options.spawn ??
    (() => {
      const worker = new FakeTileWorker();
      workers.push(worker);
      return worker;
    });
  const bitmaps: OffscreenCanvasLike[] = [];
  const grab =
    options.grab ??
    (() => {
      const bitmap = new OffscreenCanvasLike();
      bitmaps.push(bitmap);
      return Promise.resolve<ImageBitmap>(bitmap);
    });
  const texts: string[] = [];
  const onUnavailable = vi.fn();
  const reader = createTileReader({
    getVideo: () => video,
    poolSize: options.poolSize ?? 1,
    onText: (text) => texts.push(text),
    spawnWorker,
    grab,
    onUnavailable,
  });
  /** Runs one camera frame callback and lets its grab and post finish. */
  const nextFrame = async () => {
    callbacks.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { reader, workers, bitmaps, texts, nextFrame, onUnavailable, video };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('tile reader job ownership (#1707)', () => {
  it('frees a slot whose worker never answers and reads through a fresh worker', async () => {
    const { reader, workers, texts, nextFrame } = setup();
    reader.start();
    await nextFrame();
    expect(workers[0].posted).toHaveLength(1);
    // Every slot busy: frames are skipped until the deadline frees it.
    await nextFrame();
    expect(workers[0].posted).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(TILE_JOB_DEADLINE_MS + 1);
    expect(workers[0].terminated).toBe(true);
    await nextFrame();
    expect(workers).toHaveLength(2);
    workers[1].answer(0, [code('fresh')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(texts).toEqual(['fresh']);
    reader.stop();
  });

  it('recovers when every slot goes silent at once', async () => {
    const { reader, workers, nextFrame } = setup({ poolSize: 2 });
    reader.start();
    await nextFrame();
    await nextFrame();
    expect(workers.map((worker) => worker.posted.length)).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(TILE_JOB_DEADLINE_MS + 1);
    await nextFrame();
    expect(workers).toHaveLength(3);
    expect(workers[2].posted).toHaveLength(1);
    reader.stop();
  });

  it('settles a crashed worker’s job and replaces the worker', async () => {
    const { reader, workers, texts, nextFrame } = setup();
    reader.start();
    await nextFrame();
    workers[0].crash();
    await vi.advanceTimersByTimeAsync(0);
    expect(workers[0].terminated).toBe(true);
    await nextFrame();
    workers[1].answer(0, [code('after crash')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(texts).toEqual(['after crash']);
    reader.stop();
  });

  it('settles the job of a worker whose reply could not be read', async () => {
    const { reader, workers, nextFrame } = setup();
    reader.start();
    await nextFrame();
    workers[0].garble();
    await vi.advanceTimersByTimeAsync(0);
    await nextFrame();
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].posted).toHaveLength(1);
    reader.stop();
  });

  it('treats a failed post as a failure, closes the frame and frees the slot', async () => {
    const { reader, workers, bitmaps, nextFrame } = setup();
    reader.start();
    workers[0].throwOnPost = true;
    await nextFrame();
    expect(bitmaps[0].closed).toBe(true);
    expect(workers[0].terminated).toBe(true);
    await nextFrame();
    expect(workers[1].posted).toHaveLength(1);
    reader.stop();
  });

  it('gives up after repeated failures and reports the reader unavailable once', async () => {
    const spawn = vi.fn((): TileWorker => {
      throw new Error('blocked by CSP');
    });
    const { reader, onUnavailable, nextFrame, bitmaps } = setup({ spawn });
    reader.start();
    for (let frame = 0; frame < MAX_TILE_SLOT_FAILURES + 3; frame++) await nextFrame();
    expect(spawn).toHaveBeenCalledTimes(MAX_TILE_SLOT_FAILURES);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    // No frame is grabbed once there is nothing to read it, and every grabbed frame was closed.
    const grabbed = bitmaps.length;
    await nextFrame();
    expect(bitmaps).toHaveLength(grabbed);
    expect(bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
    reader.stop();
  });

  it('settles pending jobs on stop so the next run starts with free slots', async () => {
    const { reader, workers, texts, nextFrame } = setup();
    reader.start();
    await nextFrame();
    reader.stop();
    expect(workers[0].terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    reader.start();
    await nextFrame();
    expect(workers[1].posted).toHaveLength(1);
    // A late reply from the old run's worker changes nothing in the new run.
    workers[0].answer(0, [code('old run')]);
    workers[1].answer(0, [code('new run')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(texts).toEqual(['new run']);
    reader.stop();
  });

  it('closes a frame grabbed across stop and start, and never posts it', async () => {
    let finishGrab: (bitmap: ImageBitmap) => void = () => undefined;
    const first = new OffscreenCanvasLike();
    let calls = 0;
    const grab = () => {
      calls += 1;
      if (calls === 1) return new Promise<ImageBitmap>((resolve) => (finishGrab = resolve));
      return Promise.resolve<ImageBitmap>(new OffscreenCanvasLike());
    };
    const { reader, workers, nextFrame } = setup({ grab });
    reader.start();
    await nextFrame();
    reader.stop();
    reader.start();
    finishGrab(first);
    await vi.advanceTimersByTimeAsync(0);
    expect(first.closed).toBe(true);
    expect(workers.every((worker) => worker.posted.length === 0)).toBe(true);
    // The new run still reads frames.
    await nextFrame();
    expect(workers[1].posted).toHaveLength(1);
    reader.stop();
  });
});

describe('decoder pool drops (#1707)', () => {
  it('hands each superseded queued job back so its frame can be closed', async () => {
    const dropped: string[] = [];
    const pool = createDecoderPool<string, string>({
      size: 1,
      run: (job) => new Promise((resolve) => setTimeout(() => resolve(job), 10)),
      onResult: () => undefined,
      onDrop: (job) => dropped.push(job),
    });
    pool.submit(1, ['a']);
    pool.submit(2, ['b']);
    pool.submit(3, ['c']);
    expect(dropped).toEqual(['b']);
    await vi.advanceTimersByTimeAsync(30);
    await pool.idle();
  });
});
