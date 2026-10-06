// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOpticalSender } from '../client';
import { BcUrDecoder, type BcUrIngest } from '../bcur';
import { TRANSFER_DENSITY_PROFILES } from '../index';
import { senderOptions } from './fixtures';

const encoded = vi.hoisted(() => ({ calls: [] as Array<{ text: string; options: unknown }> }));

vi.mock('@/packages/qr-matrix/encoder', () => ({
  loadQrEncoder: async () => ({
    create: (text: string, options: unknown) => {
      encoded.calls.push({ text, options });
      return { version: 9, modules: { size: 53, data: new Uint8Array(53 * 53) } };
    },
  }),
}));

describe('wallet-compatible sending (#1149)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    encoded.calls = [];
    globalThis.mockWorkerControl.reset();
  });

  /** Runs the sender's animation frames with the clock a whole frame ahead each time. */
  function driveFrames(count: number): () => Promise<void> {
    const callbacks: Array<(time: number) => void> = [];
    let now = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => callbacks.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    return async () => {
      for (let i = 0; i < count; i++) {
        const callback = callbacks.shift();
        if (!callback) return;
        now += 1000;
        await act(async () => callback(now));
      }
    };
  }

  it('streams real BC-UR parts a BC-UR decoder reassembles, without the transfer worker', async () => {
    const file = Uint8Array.from({ length: 700 }, (_, i) => (i * 37 + 11) & 0xff);
    const posted: unknown[] = [];
    globalThis.mockWorkerControl.setInterceptor((message: unknown) => posted.push(message));
    const run = driveFrames(40);
    const options = senderOptions();
    const { result } = renderHook(() => useOpticalSender(options));
    act(() => {
      result.current.setSelectedFile(new File([file], 'seed.bin', { type: 'application/octet-stream' }));
      result.current.setWalletCompat(true);
    });
    result.current.canvasRef.current = document.createElement('canvas');

    act(() => result.current.startTransfer());
    await waitFor(() => expect(result.current.isTransferring).toBe(true));
    expect(options.verifyFrame).toHaveBeenCalledTimes(1);
    await run();

    const { errorCorrectionLevel, maxVersion } = TRANSFER_DENSITY_PROFILES.balanced;
    expect(encoded.calls.length).toBeGreaterThan(20);
    for (const call of encoded.calls) {
      expect(call.text).toMatch(/^UR:BYTES\/\d+-\d+\/[A-Z]+$/);
      expect(call.options).toEqual({ errorCorrectionLevel, version: maxVersion });
    }
    expect(options.renderFrame).toHaveBeenCalledTimes(encoded.calls.length);
    expect(result.current.totalFrames).toBeGreaterThan(1);
    expect(result.current.currentPass).toBeGreaterThan(1);
    expect(posted).toEqual([]);

    // Pure parts first, then mixed ones: a receiver that missed every other part still finishes.
    const decoder = new BcUrDecoder();
    let outcome: BcUrIngest = { status: 'rejected' };
    for (const [index, call] of encoded.calls.entries()) {
      if (index % 2 === 0 || outcome.status === 'complete') continue;
      outcome = decoder.ingest(call.text);
    }
    expect(outcome).toMatchObject({ status: 'complete', result: { type: 'bytes', content: { kind: 'file', bytes: file } } });
  });

  it('sends one file at a time', async () => {
    const { result } = renderHook(() => useOpticalSender(senderOptions()));
    act(() => {
      result.current.setSelectedFiles([new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]);
      result.current.setWalletCompat(true);
    });
    act(() => result.current.startTransfer());
    expect(result.current.handshakeError).toMatch(/one file at a time/);
    expect(result.current.isTransferring).toBe(false);
    expect(result.current.isVerifyingHandshake).toBe(false);
  });

  it('never sends a private transfer as BC-UR', async () => {
    let start: { type: string } | null = null;
    globalThis.mockWorkerControl.setInterceptor((message: { type: string }) => {
      if (message.type === 'START') start = message;
    });
    const { result } = renderHook(() => useOpticalSender(senderOptions()));
    act(() => {
      result.current.setSelectedFile(new File(['secret'], 'secret.txt', { type: 'text/plain' }));
      result.current.setIsPrivate(true);
      result.current.setWalletCompat(true);
    });
    act(() => result.current.startTransfer());
    await waitFor(() => expect(start).not.toBeNull());
    expect(encoded.calls).toEqual([]);
  });

  it('refuses to start when the first frame would not scan', async () => {
    const { result } = renderHook(() => useOpticalSender(senderOptions({ verifyFrame: vi.fn(async () => false) })));
    act(() => {
      result.current.setSelectedFile(new File(['x'.repeat(300)], 'x.txt'));
      result.current.setWalletCompat(true);
    });
    act(() => result.current.startTransfer());
    await waitFor(() => expect(result.current.handshakeError).toMatch(/Transfer QR frame/));
    expect(result.current.isTransferring).toBe(false);
  });
});
