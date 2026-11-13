import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult } from '@/packages/optical-scanner';
import { useImageScan } from './useImageScan';

/** A promise the test settles by hand, as a slow permission prompt or clipboard read does. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const pass = (data: string): ScanResult => ({ status: 'pass', data, durationMs: 1 });
const png = () => new Blob(['png'], { type: 'image/png' });
const imageFile = (name = 'code.png') => new File(['png'], name, { type: 'image/png' });

/** A clipboard item holding one image, with its blob read controlled by `getType`. */
const imageItem = (getType: () => Promise<Blob> = () => Promise.resolve(png())) => ({ types: ['image/png'], getType: vi.fn(getType) });

type ClipboardItems = Array<{ types: string[]; getType: (type: string) => Promise<Blob> }>;

function setClipboardRead(read: () => Promise<ClipboardItems>) {
  const spy = vi.fn(read);
  Object.defineProperty(navigator, 'clipboard', { value: { read: spy }, configurable: true });
  return spy;
}

/** Lets pending promise continuations run. */
const flush = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
});

function setup(scanFile = vi.fn((file: File) => Promise.resolve(pass(file.name)))) {
  const onFound = vi.fn();
  const view = renderHook(() =>
    useImageScan({ scanFile, onFound, onStart: vi.fn(), onShowImageMode: vi.fn(), onReading: vi.fn() })
  );
  return { ...view, scanFile, onFound };
}

describe('useImageScan clipboard acquisition (#1704)', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('decodes a current clipboard image exactly once', async () => {
    setClipboardRead(() => Promise.resolve([imageItem()]));
    const { result, scanFile, onFound } = setup();
    await act(() => result.current.pasteFromClipboard());
    await flush();
    expect(scanFile).toHaveBeenCalledTimes(1);
    expect(onFound).toHaveBeenCalledWith('pasted-image');
    expect(result.current.fileError).toBeNull();
    expect(result.current.fileProcessing).toBe(false);
  });

  it('starts no decode when the clipboard read resolves after reset', async () => {
    const read = deferred<ClipboardItems>();
    setClipboardRead(() => read.promise);
    const { result, scanFile, onFound } = setup();
    act(() => void result.current.pasteFromClipboard());
    act(() => result.current.reset());
    read.resolve([imageItem()]);
    await flush();
    expect(scanFile).not.toHaveBeenCalled();
    expect(onFound).not.toHaveBeenCalled();
    expect(result.current.fileError).toBeNull();
    expect(result.current.fileProcessing).toBe(false);
  });

  it('starts no decode when the image blob arrives after reset', async () => {
    const blob = deferred<Blob>();
    const item = imageItem(() => blob.promise);
    setClipboardRead(() => Promise.resolve([item]));
    const { result, scanFile } = setup();
    act(() => void result.current.pasteFromClipboard());
    await flush();
    expect(item.getType).toHaveBeenCalledTimes(1);
    act(() => result.current.reset());
    blob.resolve(png());
    await flush();
    expect(scanFile).not.toHaveBeenCalled();
    expect(result.current.fileError).toBeNull();
  });

  it('starts no decode when the clipboard resolves after unmount', async () => {
    const read = deferred<ClipboardItems>();
    setClipboardRead(() => read.promise);
    const { result, scanFile, unmount } = setup();
    act(() => void result.current.pasteFromClipboard());
    unmount();
    read.resolve([imageItem()]);
    await flush();
    expect(scanFile).not.toHaveBeenCalled();
  });

  it('keeps a newer file pick when an older clipboard read finishes later', async () => {
    const read = deferred<ClipboardItems>();
    setClipboardRead(() => read.promise);
    const { result, scanFile, onFound } = setup();
    act(() => void result.current.pasteFromClipboard());
    await act(() => result.current.processFile(imageFile('picked.png')));
    expect(onFound).toHaveBeenCalledWith('picked.png');

    read.resolve([imageItem()]);
    await flush();
    expect(scanFile).toHaveBeenCalledTimes(1);
    expect(onFound).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer clipboard paste when an older one finishes later', async () => {
    const older = deferred<ClipboardItems>();
    const reads = [older.promise, Promise.resolve([imageItem()])];
    setClipboardRead(() => reads.shift() ?? Promise.resolve([]));
    const { result, scanFile, onFound } = setup();
    act(() => void result.current.pasteFromClipboard());
    await act(() => result.current.pasteFromClipboard());
    await flush();
    expect(scanFile).toHaveBeenCalledTimes(1);

    older.resolve([{ types: ['text/plain'], getType: vi.fn() }]);
    await flush();
    expect(scanFile).toHaveBeenCalledTimes(1);
    expect(onFound).toHaveBeenCalledTimes(1);
    expect(result.current.fileError).toBeNull();
  });

  it('ignores a late permission denial after a newer dropped file shows its own error', async () => {
    const read = deferred<ClipboardItems>();
    setClipboardRead(() => read.promise);
    const { result, scanFile } = setup();
    act(() => void result.current.pasteFromClipboard());
    act(() => result.current.scanImage(new File(['text'], 'notes.txt', { type: 'text/plain' })));
    expect(result.current.fileError).toBe('Please drop an image file.');

    read.reject(new DOMException('Denied', 'NotAllowedError'));
    await flush();
    expect(result.current.fileError).toBe('Please drop an image file.');
    expect(scanFile).not.toHaveBeenCalled();
  });

  it('ignores a late getType failure after reset', async () => {
    const blob = deferred<Blob>();
    setClipboardRead(() => Promise.resolve([imageItem(() => blob.promise)]));
    const { result } = setup();
    act(() => void result.current.pasteFromClipboard());
    await flush();
    act(() => result.current.reset());
    blob.reject(new Error('gone'));
    await flush();
    expect(result.current.fileError).toBeNull();
  });

  it('still explains an empty clipboard and a refused permission', async () => {
    setClipboardRead(() => Promise.resolve([{ types: ['text/plain'], getType: vi.fn() }]));
    const { result } = setup();
    await act(() => result.current.pasteFromClipboard());
    expect(result.current.fileError).toMatch(/clipboard has no image/);

    setClipboardRead(() => Promise.reject(new DOMException('Denied', 'NotAllowedError')));
    await act(() => result.current.pasteFromClipboard());
    expect(result.current.fileError).toMatch(/did not allow reading the clipboard/);
  });

  it('aborts the active decode on reset and clears busy', async () => {
    let signal: AbortSignal | undefined;
    const decode = deferred<ScanResult>();
    const scanFile = vi.fn((_file: File, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return decode.promise;
    });
    const { result, onFound } = setup(scanFile);
    act(() => void result.current.processFile(imageFile()));
    expect(result.current.fileProcessing).toBe(true);
    act(() => result.current.reset());
    expect(signal?.aborted).toBe(true);
    expect(result.current.fileProcessing).toBe(false);
    decode.resolve(pass('LATE'));
    await flush();
    expect(onFound).not.toHaveBeenCalled();
  });
});
