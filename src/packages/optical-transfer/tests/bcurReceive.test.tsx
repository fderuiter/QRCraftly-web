// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
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
});
