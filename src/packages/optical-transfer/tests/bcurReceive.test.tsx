// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOpticalReceiver } from '../client';
import { receiverOptions } from './fixtures';
import reference from './fixtures/bcurReference.json';

const stream = reference.find((entry) => entry.name === 'twenty-parts')!;

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

  it('drops the droplet decoder\'s error once the BC-UR stream completes', async () => {
    // Our own droplets are `ur:bytes` codes too, so the droplet worker also reads a wallet's parts and
    // can fail on them, in any order relative to the BC-UR decoder. Make it fail on every part.
    globalThis.mockWorkerControl.setResponseOverride({ type: 'ERROR', error: 'Malformed fountain session header.' });
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ autoDownload: false })));
    for (const part of stream.parts) {
      if (result.current.bcur) break;
      await act(async () => {
        result.current.handleFrame(part);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    await waitFor(() => expect(result.current.bcur).not.toBeNull());
    // Let any worker reply still in flight arrive.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current.receiverError).toBeNull();
  }, 20_000);
});
