/**
 * @vitest-environment jsdom
 */
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

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { QRModules } from '@/packages/core/types';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { scheduleVirtualRender, type RenderedInfo, type VirtualRenderInput } from './virtualRender';

// The module-level drawing is not under test here; the copy only has to exist and be handed on.
vi.mock('@/packages/qr-matrix', () => ({ drawQRInternal: vi.fn() }));

/** The 2D context the off-screen copy draws into; only the calls the copy makes are modelled. */
interface FakeContext {
  clearRect: Mock;
  fillRect: Mock;
  getImageData: Mock;
}

/** A capture result the test resolves or rejects by hand. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets the pending promise callbacks of the copy run. */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

const MODULE_COUNT = 21;

const modules: QRModules = {
  size: MODULE_COUNT,
  get: () => false,
};

let context: FakeContext;
let requestIdle: unknown;

/** Stands in for OffscreenCanvas so the copy gets a predictable 2D context in jsdom. */
class FakeOffscreenCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(): FakeContext {
    return context;
  }
}

function makeInput(onRendered: (info: RenderedInfo) => void): VirtualRenderInput {
  return {
    modules,
    config: DEFAULT_CONFIG,
    logoImg: null,
    borderLogoImg: null,
    mazeData: null,
    onRendered,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  context = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn(),
  };
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  // Without requestIdleCallback the schedule falls back to a 50 ms timeout, which fake timers control.
  requestIdle = Reflect.get(window, 'requestIdleCallback');
  Reflect.deleteProperty(window, 'requestIdleCallback');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (requestIdle !== undefined) Reflect.set(window, 'requestIdleCallback', requestIdle);
  vi.restoreAllMocks();
});

describe('scheduleVirtualRender (#1708)', () => {
  it('does not capture or report when cancelled before the scheduled run', async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const onRendered = vi.fn();

    const scheduled = scheduleVirtualRender(makeInput(onRendered));
    scheduled.cancel();
    await vi.advanceTimersByTimeAsync(50);
    await flushPromises();

    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(onRendered).not.toHaveBeenCalled();
  });

  it('closes the bitmap and reports nothing when cancelled while the capture is pending', async () => {
    const capture = deferred<{ close: Mock }>();
    const createImageBitmap = vi.fn(() => capture.promise);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const onRendered = vi.fn();

    const scheduled = scheduleVirtualRender(makeInput(onRendered));
    await vi.advanceTimersByTimeAsync(50);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);

    scheduled.cancel();
    const bitmap = { close: vi.fn() };
    capture.resolve(bitmap);
    await flushPromises();

    expect(onRendered).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('reports the bitmap once and leaves it open when not cancelled', async () => {
    const capture = deferred<{ close: Mock }>();
    vi.stubGlobal('createImageBitmap', vi.fn(() => capture.promise));
    const onRendered = vi.fn();

    scheduleVirtualRender(makeInput(onRendered));
    await vi.advanceTimersByTimeAsync(50);
    const bitmap = { close: vi.fn() };
    capture.resolve(bitmap);
    await flushPromises();

    expect(onRendered).toHaveBeenCalledTimes(1);
    expect(onRendered).toHaveBeenCalledWith({ moduleCount: MODULE_COUNT, virtualImageBitmap: bitmap });
    expect(bitmap.close).not.toHaveBeenCalled();
  });

  it('reports nothing, and reads no pixels back, when cancelled and the capture then rejects', async () => {
    const capture = deferred<{ close: Mock }>();
    vi.stubGlobal('createImageBitmap', vi.fn(() => capture.promise));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onRendered = vi.fn();

    const scheduled = scheduleVirtualRender(makeInput(onRendered));
    await vi.advanceTimersByTimeAsync(50);
    scheduled.cancel();
    capture.reject(new Error('capture failed'));
    await flushPromises();

    expect(onRendered).not.toHaveBeenCalled();
    expect(context.getImageData).not.toHaveBeenCalled();
  });

  it('reports the pixels as ImageData when createImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const imageData = { width: 512, height: 512, data: new Uint8ClampedArray(4) };
    context.getImageData.mockReturnValue(imageData);
    const onRendered = vi.fn();

    scheduleVirtualRender(makeInput(onRendered));
    await vi.advanceTimersByTimeAsync(50);

    expect(onRendered).toHaveBeenCalledTimes(1);
    expect(onRendered).toHaveBeenCalledWith({ moduleCount: MODULE_COUNT, virtualImageData: imageData });
  });
});
