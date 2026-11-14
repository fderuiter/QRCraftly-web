/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QrEncoder } from '@/packages/qr-matrix';
import { setQrCanvasRuntime } from '@/utils/qrCanvasRuntime';
import { createFakeQrEncoder } from '../../tests/fixtures/fakeQrEncoder';
import { useQrEncoder } from './useQrEncoder';

/** A load the test settles by hand. */
function pendingLoad() {
  let resolve: (encoder: QrEncoder) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<QrEncoder>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const fakeEncoder = (): QrEncoder => createFakeQrEncoder();

describe('useQrEncoder (#1711)', () => {
  let loads: ReturnType<typeof pendingLoad>[];
  let restore: () => void;

  beforeEach(() => {
    loads = [];
    restore = setQrCanvasRuntime({
      loadEncoder: () => {
        const load = pendingLoad();
        loads.push(load);
        return load.promise;
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it('is loading until the encoder arrives, then ready with it', async () => {
    const { result } = renderHook(() => useQrEncoder());
    expect(result.current.status).toBe('loading');
    const encoder = fakeEncoder();
    await waitFor(() => expect(loads.length).toBeGreaterThan(0));
    await act(async () => loads.forEach((load) => load.resolve(encoder)));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.status === 'ready' && result.current.encoder).toBe(encoder);
  });

  it('is ready at once with an encoder already in memory', () => {
    const encoder = fakeEncoder();
    const restoreSync = setQrCanvasRuntime({ loadEncoder: () => encoder });
    try {
      const { result } = renderHook(() => useQrEncoder());
      expect(result.current.status === 'ready' && result.current.encoder).toBe(encoder);
    } finally {
      restoreSync();
    }
  });

  it('reports a failed load instead of loading forever, and does not ask again on its own', async () => {
    const { result } = renderHook(() => useQrEncoder());
    await waitFor(() => expect(loads.length).toBeGreaterThan(0));
    // The mount asks once, even though the first render already started the load.
    expect(loads).toHaveLength(1);
    const before = loads.length;
    await act(async () => loads.forEach((load) => load.reject(new Error('wasm failed'))));
    await waitFor(() => expect(result.current.status).toBe('failed'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(loads.length).toBe(before);
    expect(result.current.status).toBe('failed');
  });

  it('loads again when asked to retry, once per press, and becomes ready', async () => {
    const { result } = renderHook(() => useQrEncoder());
    await waitFor(() => expect(loads.length).toBeGreaterThan(0));
    await act(async () => loads.forEach((load) => load.reject(new Error('wasm failed'))));
    await waitFor(() => expect(result.current.status).toBe('failed'));
    const before = loads.length;

    act(() => {
      if (result.current.status !== 'failed') throw new Error('expected a failed load');
      const { retry } = result.current;
      retry();
      // A second press while the first retry loads starts nothing more.
      retry();
    });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(loads.length).toBe(before + 1));
    const encoder = fakeEncoder();
    await act(async () => loads.at(-1)?.resolve(encoder));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(loads.length).toBe(before + 1);
  });

  it('publishes nothing from a load that settles after unmount', async () => {
    const { result, unmount } = renderHook(() => useQrEncoder());
    await waitFor(() => expect(loads.length).toBeGreaterThan(0));
    unmount();
    await act(async () => loads.forEach((load) => load.reject(new Error('late'))));
    expect(result.current.status).toBe('loading');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('publishes nothing from a load that succeeds after unmount', async () => {
    const { result, unmount } = renderHook(() => useQrEncoder());
    await waitFor(() => expect(loads.length).toBeGreaterThan(0));
    const seen: string[] = [];
    unmount();
    await act(async () => loads.forEach((load) => load.resolve(fakeEncoder())));
    seen.push(result.current.status);
    expect(seen).toEqual(['loading']);
  });
});
