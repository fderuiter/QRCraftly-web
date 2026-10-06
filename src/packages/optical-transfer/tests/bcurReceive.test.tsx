// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
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
