// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOpticalReceiver } from '../client';
import { receiverOptions } from './fixtures';

type ScanOptions = { onScanSuccess?: (data: string, result: unknown) => void };
let scanOptions: ScanOptions | undefined;

vi.mock('@/packages/optical-scanner/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/packages/optical-scanner/client')>();
  return {
    ...actual,
    useQrScanner: (options: ScanOptions) => {
      scanOptions = options;
      return {
        state: { status: 'idle' },
        start: vi.fn(),
        stop: vi.fn(),
        startScanning: vi.fn(),
        stopScanning: vi.fn(),
      };
    },
  };
});

const corners = [
  { x: 1, y: 1 },
  { x: 9, y: 1 },
  { x: 9, y: 9 },
  { x: 1, y: 9 },
];

describe('lock-on corners (#1062)', () => {
  afterEach(() => vi.useRealTimers());

  it('reports the corners of the code just read and drops them when none follows', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));
    expect(result.current.lockOn).toBeNull();

    act(() => scanOptions?.onScanSuccess?.('not a transfer frame', { text: 'x', bytes: null, corners, source: 'qr-decode', durationMs: 1 }));
    expect(result.current.lockOn).toEqual(corners);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.lockOn).toBeNull();
  });
});
