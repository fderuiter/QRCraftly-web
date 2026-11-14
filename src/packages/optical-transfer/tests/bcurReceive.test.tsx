// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOpticalReceiver } from '../client';
import { receiverOptions } from './fixtures';
import reference from './fixtures/bcur/reference-streams.json';

const stream = reference.vectors.find((entry) => entry.name === 'seven-fragments')!;

describe('real BC-UR streams in the receiver (#1149)', () => {
  // The receiver loads the codec on the first UR code; load it up front so a busy machine does not time the test out.
  beforeAll(async () => {
    await import('../bcur');
  }, 30_000);

  afterEach(() => {
    globalThis.mockWorkerControl.reset();
  });

  it('reads a wallet-style stream made by the reference library and offers its bytes as a file', async () => {
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ autoDownload: false })));

    for (const part of stream.parts) {
      if (result.current.bcur) break;
      await act(async () => {
        result.current.handleFrame(part.toUpperCase());
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    await waitFor(() => expect(result.current.bcur).not.toBeNull());
    expect(result.current.bcur?.type).toBe('bytes');
    const content = result.current.bcur?.content;
    expect(content?.kind).toBe('file');
    const hex = Array.from(content?.kind === 'file' ? content.bytes : [], (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe(stream.fileHex);
    expect(result.current.receiverError).toBeNull();
    expect(result.current.receiverSuccess).toBe(false);
  }, 20_000);

  it('clears a finished stream when the receiver is reset', async () => {
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ autoDownload: false })));
    for (const part of stream.parts) {
      if (result.current.bcur) break;
      await act(async () => {
        result.current.handleFrame(part);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    await waitFor(() => expect(result.current.bcur).not.toBeNull());
    act(() => result.current.handleClear());
    expect(result.current.bcur).toBeNull();
    expect(result.current.bcurProgress).toBeNull();
  }, 20_000);

  it('reads UR codes with the BC-UR decoder only, never the transfer worker', async () => {
    const posted: unknown[] = [];
    globalThis.mockWorkerControl.setInterceptor((message: unknown) => {
      posted.push(message);
    });
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ autoDownload: false })));
    for (const part of stream.parts) {
      if (result.current.bcur) break;
      await act(async () => {
        result.current.handleFrame(part.toUpperCase());
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    await waitFor(() => expect(result.current.bcur).not.toBeNull());
    expect(posted).toEqual([]);
    expect(result.current.receiverError).toBeNull();
  }, 20_000);
});

type BcurModule = typeof import('../bcur');

/** A promise the test settles by hand. */
function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  // The receiver handles the rejection; this copy only keeps the test runner from reporting it twice.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/** Waits until the codec load the receiver started has settled, then lets its callbacks run. */
async function flush() {
  await act(async () => {
    await import('../bcur').catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('BC-UR work queued before Clear or unmount (#1710)', () => {
  let actual: BcurModule;
  let constructed = 0;
  /** What each `ingest` call of the counted decoders returned, in order. */
  let ingested: string[] = [];

  beforeAll(async () => {
    actual = await vi.importActual<BcurModule>('../bcur');
  }, 30_000);

  /** Makes the receiver's next load of the BC-UR codec wait for `gate`, and count the decoders it makes. */
  function gateCodec(gate: Promise<void>) {
    vi.resetModules();
    vi.doMock('../bcur', async () => {
      await gate;
      class CountingDecoder extends actual.BcUrDecoder {
        constructor() {
          super();
          constructed += 1;
        }

        override ingest(text: string) {
          const outcome = super.ingest(text);
          ingested.push(outcome.status);
          return outcome;
        }
      }
      return { ...actual, BcUrDecoder: CountingDecoder };
    });
  }

  beforeEach(() => {
    constructed = 0;
    ingested = [];
  });

  afterEach(() => {
    vi.doUnmock('../bcur');
    vi.resetModules();
    globalThis.mockWorkerControl.reset();
  });

  it('drops a stream that finishes after Clear while the codec was still loading', async () => {
    const gate = deferred();
    gateCodec(gate.promise);
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ autoDownload: false })));
    const [only] = reference.vectors.filter((entry) => entry.parts.length === 1);
    act(() => result.current.handleFrame(only.parts[0]));
    act(() => result.current.handleClear());
    gate.resolve();
    await flush();
    await flush();

    expect(result.current.bcur).toBeNull();
    expect(result.current.bcurProgress).toBeNull();
    expect(result.current.phase).not.toBe('complete');
    expect(result.current.receiverError).toBeNull();
    expect(constructed).toBe(0);
  });

  it('makes no decoder for codes queued before the receiver unmounted', async () => {
    const gate = deferred();
    gateCodec(gate.promise);
    const { result, unmount } = renderHook(() => useOpticalReceiver(receiverOptions({ autoDownload: false })));
    act(() => result.current.handleFrame(stream.parts[0]));
    unmount();
    gate.resolve();
    await flush();
    await flush();
    expect(constructed).toBe(0);
  });

  it('does not count parts queued before Clear towards the next receive', async () => {
    const gate = deferred();
    gateCodec(gate.promise);
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ autoDownload: false })));
    act(() => {
      for (const part of stream.parts.slice(0, 3)) result.current.handleFrame(part);
    });
    act(() => result.current.handleClear());
    act(() => result.current.handleFrame(stream.parts[3]));
    gate.resolve();
    await flush();
    await flush();

    expect(result.current.bcurProgress?.received).toBe(1);
    expect(constructed).toBe(1);
  });

  it('puts a wallet-style stream in progress into the receiver phase', async () => {
    gateCodec(Promise.resolve());
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ autoDownload: false })));
    act(() => result.current.handleFrame(stream.parts[0]));
    await flush();
    await flush();
    expect(result.current.bcurProgress).not.toBeNull();
    expect(result.current.phase).toBe('receiving');
  });

  it('says the codec could not load, then loads it again on the next code', async () => {
    const gate = deferred();
    gateCodec(gate.promise);
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ autoDownload: false })));
    act(() => result.current.handleFrame(stream.parts[0]));
    gate.reject(new Error('chunk failed to load'));
    await flush();
    await flush();
    expect(result.current.receiverError).toMatch(/could not load/i);
    expect(result.current.phase).toBe('failed');

    gateCodec(Promise.resolve());
    for (const part of stream.parts) {
      if (result.current.bcur) break;
      act(() => result.current.handleFrame(part));
      await flush();
    }
    await waitFor(() => expect(result.current.bcur).not.toBeNull());
    expect(result.current.receiverError).toBeNull();
    expect(result.current.phase).toBe('complete');
  });

  it('does not let a part queued behind the finishing one report the stream again', async () => {
    const gate = deferred();
    gateCodec(gate.promise);
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ autoDownload: false })));
    act(() => {
      for (const part of [...stream.parts, ...stream.parts]) result.current.handleFrame(part);
    });
    gate.resolve();
    await flush();
    await flush();
    await waitFor(() => expect(result.current.bcur).not.toBeNull());
    // Nothing is read after the part that finished the stream.
    expect(ingested.filter((status) => status === 'complete')).toHaveLength(1);
    expect(ingested.at(-1)).toBe('complete');
    expect(result.current.phase).toBe('complete');
    expect(result.current.receiverError).toBeNull();
  });

  it('does not start a finished stream again from a frame read before the re-render', async () => {
    gateCodec(Promise.resolve());
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ autoDownload: false })));
    const [only] = reference.vectors.filter((entry) => entry.parts.length === 1);
    // The camera keeps the callback it was given, so a frame can arrive with the pre-completion one.
    const staleHandleFrame = result.current.handleFrame;
    act(() => staleHandleFrame(only.parts[0]));
    await flush();
    await waitFor(() => expect(result.current.bcur).not.toBeNull());
    act(() => staleHandleFrame(only.parts[0]));
    await flush();
    expect(constructed).toBe(1);
    expect(ingested).toEqual(['complete']);
  });
});
