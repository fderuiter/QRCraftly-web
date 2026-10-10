/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useScannability } from './useScannability';
import { QRProvider, useQRStore } from '@/context/QRContext';
import { DEFAULT_CONFIG } from '@/constants';
import { type QRConfig, QRStyle } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QRProvider, null, children);

const defaultConfig: QRConfig = { ...DEFAULT_CONFIG } as QRConfig;

function makeCanvasRef(): React.RefObject<HTMLCanvasElement | null> {
  const canvas = document.createElement('canvas');
  canvas.width = 100;
  canvas.height = 100;
  return { current: canvas };
}

// Active worker reference helper from our global mock worker control
const getActiveWorker = () => globalThis.mockWorkerControl.activeWorker;

// ---------------------------------------------------------------------------
// Tests: app wiring only. The evaluator's sequencing, watchdog, backpressure and fallback
// behaviour is covered headlessly in src/packages/scannability/tests/.
// ---------------------------------------------------------------------------
describe('useScannability (app wiring)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('throws when used outside QRProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useScannability(makeCanvasRef(), defaultConfig))).toThrow(
      'useQRStore must be used within QRProvider'
    );
    spy.mockRestore();
  });

  it('starts idle with a health score and export risk', () => {
    const { result } = renderHook(() => useScannability(makeCanvasRef(), defaultConfig), { wrapper });
    expect(result.current.status).toBe('idle');
    expect(result.current.health.score).toBe(100);
    expect(result.current.exportRisk).toBe('caution');
    expect(result.current.workerRecoveryActive).toBe(false);
  });

  it('keeps a stable checkScannability identity across renders', () => {
    const { result, rerender } = renderHook(
      ({ config }: { config: QRConfig }) => useScannability(makeCanvasRef(), config),
      { wrapper, initialProps: { config: defaultConfig } }
    );
    const first = result.current.checkScannability;
    rerender({ config: { ...defaultConfig, value: 'https://changed.com' } });
    expect(result.current.checkScannability).toBe(first);
  });

  it('emits a scannability-fail store signal tagged with engine and style', () => {
    const config: QRConfig = { ...defaultConfig, style: QRStyle.CIRCUIT };
    const { result } = renderHook(
      () => ({ scan: useScannability(makeCanvasRef(), config), store: useQRStore() }),
      { wrapper }
    );
    const signal = vi.fn();
    act(() => {
      result.current.store.registerSignal('scannability-fail', signal);
    });

    act(() => result.current.scan.checkScannability());
    act(() => {
      getActiveWorker()!.dispatchMessage({
        success: false,
        physicalReady: false,
        error: 'NOT_FOUND',
        configId: '1',
      });
    });

    expect(result.current.scan.status).toBe('fail');
    expect(result.current.scan.exportRisk).toBe('unsafe');
    expect(signal).toHaveBeenCalledTimes(1);
    expect(signal.mock.calls[0][0]).toEqual({
      engine: expect.any(String),
      styleId: QRStyle.CIRCUIT,
      errorType: 'NOT_FOUND',
    });
  });

  it('falls back to "default" as styleId and stays silent on success', () => {
    const config: QRConfig = { ...defaultConfig, style: '' as QRStyle };
    const { result } = renderHook(
      () => ({ scan: useScannability(makeCanvasRef(), config), store: useQRStore() }),
      { wrapper }
    );
    const signal = vi.fn();
    act(() => {
      result.current.store.registerSignal('scannability-fail', signal);
    });

    act(() => result.current.scan.checkScannability());
    act(() => {
      getActiveWorker()!.dispatchMessage({ success: true, physicalReady: true, configId: '1' });
    });
    expect(result.current.scan.status).toBe('physical-pass');
    expect(signal).not.toHaveBeenCalled();

    act(() => result.current.scan.checkScannability());
    act(() => {
      getActiveWorker()!.dispatchMessage({ success: false, physicalReady: false, error: 'FAIL', configId: '2' });
    });
    expect(signal.mock.calls[0][0].styleId).toBe('default');
  });

  it('sends incrementing request ids and the store module count to the worker', () => {
    const { result } = renderHook(
      () => ({ scan: useScannability(makeCanvasRef(), defaultConfig), store: useQRStore() }),
      { wrapper }
    );
    act(() => result.current.store.setModuleCount(29));

    const imageData = { data: new Uint8ClampedArray(100), width: 5, height: 5 } as ImageData;
    act(() => result.current.scan.checkScannability(imageData));
    expect(getActiveWorker()!.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ configId: '1', moduleCount: 29 }),
      expect.any(Array)
    );

    act(() => result.current.scan.checkScannability(imageData, undefined, 21));
    expect(getActiveWorker()!.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ configId: '2', moduleCount: 21 }),
      expect.any(Array)
    );
  });

  it('recomputes health when the config changes', () => {
    const { result, rerender } = renderHook(
      ({ config }: { config: QRConfig }) => useScannability(makeCanvasRef(), config),
      { wrapper, initialProps: { config: defaultConfig } }
    );
    expect(result.current.health.score).toBe(100);

    rerender({ config: { ...defaultConfig, fgColor: '#eeeeee', eyeColor: '#eeeeee', bgColor: '#ffffff' } });

    expect(result.current.health.criticalWarnings).toContain('critical-contrast');
    expect(result.current.exportRisk).toBe('unsafe');
  });

  it('reports worker crashes as recovery and heals on the next check', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useScannability(makeCanvasRef(), defaultConfig), { wrapper });

    act(() => result.current.checkScannability());
    const crashed = getActiveWorker()!;
    act(() => crashed.dispatchError(new Error('Worker runtime exception')));

    expect(result.current.status).toBe('fail');
    expect(result.current.workerRecoveryActive).toBe(true);
    expect(crashed.terminate).toHaveBeenCalled();

    act(() => result.current.checkScannability());
    const healed = getActiveWorker()!;
    expect(healed).not.toBe(crashed);
    act(() => {
      healed.dispatchMessage({ success: true, physicalReady: true, configId: '2' });
    });
    expect(result.current.status).toBe('physical-pass');
    expect(result.current.workerRecoveryActive).toBe(false);
  });

  it('checks on the main thread when workers cannot be created', async () => {
    const originalWorker = globalThis.Worker;
    globalThis.Worker = class {
      constructor() {
        throw new Error('Worker not supported');
      }
    } as unknown as typeof Worker;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { result } = renderHook(
        () => ({ scan: useScannability(makeCanvasRef(), defaultConfig), store: useQRStore() }),
        { wrapper }
      );
      const signal = vi.fn();
      act(() => {
        result.current.store.registerSignal('scannability-fail', signal);
      });

      const blank = { data: new Uint8ClampedArray(400).fill(255), width: 10, height: 10 } as ImageData;
      await act(async () => {
        result.current.scan.checkScannability(blank);
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      expect(result.current.scan.status).toBe('fail');
      expect(signal.mock.calls[0][0]).toHaveProperty('errorType', 'NOT_FOUND');
    } finally {
      globalThis.Worker = originalWorker;
    }
  });

  it('terminates the worker on unmount once its in-flight check answers', () => {
    const { result, unmount } = renderHook(() => useScannability(makeCanvasRef(), defaultConfig), { wrapper });
    act(() => result.current.checkScannability());
    const worker = getActiveWorker()!;
    unmount();
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.dispatchMessage({ success: true, physicalReady: true, configId: '1' });
    expect(worker.terminate).toHaveBeenCalled();
  });
});
