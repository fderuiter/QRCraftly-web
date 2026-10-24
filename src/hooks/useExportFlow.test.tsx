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
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { QRType, type QRConfig } from '@/packages/core/types';
import { ToastProvider } from '@/components/ui/Toast';
import { SCAN_VALIDATION_ERROR, type ExportStatus } from './useQRDownload';
import { useExportFlow, type ExportFlowInput } from './useExportFlow';

const exportAsset = vi.hoisted(() => vi.fn());
vi.mock('./useQRDownload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useQRDownload')>()),
  useQRDownload: () => ({ exportAsset }),
}));

const config: QRConfig = { ...DEFAULT_CONFIG, type: QRType.URL, value: 'https://example.com' };
const input = (overrides: Partial<ExportFlowInput> = {}): ExportFlowInput => ({
  config,
  effectiveConfig: config,
  isEmpty: false,
  refused: false,
  previewFailure: null,
  verdict: 'physical-pass',
  health: undefined,
  ...overrides,
});
const failing = { verdict: 'fail' as const, health: { score: 20, warnings: [], criticalWarnings: ['Low contrast'] } };
const wrapper = ({ children }: { children: React.ReactNode }) => <ToastProvider>{children}</ToastProvider>;
const renderFlow = (overrides?: Partial<ExportFlowInput>) => renderHook(() => useExportFlow(input(overrides)), { wrapper });
const scanFailure = (): ExportStatus => ({ success: false, format: 'png', error: Object.assign(new Error('Failed'), { name: SCAN_VALIDATION_ERROR }) });

describe('useExportFlow', () => {
  beforeEach(() => {
    exportAsset.mockReset();
    exportAsset.mockImplementation(async (format: string) => ({ success: true, format }));
  });
  afterEach(() => vi.useRealTimers());

  it('downloads the chosen format with the same options as before (size, file name, color space)', async () => {
    const { result } = renderFlow();
    await act(async () => result.current.run('download'));
    expect(exportAsset).toHaveBeenCalledTimes(1);
    expect(exportAsset).toHaveBeenCalledWith('png', { size: 2048, filename: 'url-example.com', colorSpace: 'rgb' });
    expect(result.current.status.done).toEqual({ format: 'png', message: 'PNG downloaded' });
  });

  it.each([
    ['copy', 'clipboard', 'Copied'],
    ['copy-svg', 'svg-copy', 'SVG code copied'],
    ['share', 'share', 'Shared'],
  ] as const)('runs %s as the %s export', async (action, format, message) => {
    const { result } = renderFlow();
    await act(async () => result.current.run(action));
    expect(exportAsset).toHaveBeenCalledWith(format, expect.objectContaining({ filename: 'url-example.com' }));
    expect(result.current.status.done).toEqual({ format, message });
  });

  it('downloads a format from the command menu without changing the chosen one', async () => {
    const { result } = renderFlow();
    await act(async () => result.current.run('download', 'svg'));
    expect(exportAsset).toHaveBeenCalledWith('svg', expect.anything());
    expect(result.current.options.format).toBe('png');
  });

  it('opens the wallet dialog and closes the download options, even when the code may not scan', () => {
    const { result } = renderFlow(failing);
    act(() => result.current.options.setOpen(true));
    act(() => result.current.run('wallet'));
    expect(result.current.wallet.open).toBe(true);
    expect(result.current.options.open).toBe(false);
    expect(result.current.gate.open).toBe(false);
    act(() => result.current.wallet.close());
    expect(result.current.wallet.open).toBe(false);
  });

  it('exports nothing while the form is empty or refused', () => {
    for (const overrides of [{ isEmpty: true }, { refused: true }]) {
      const { result } = renderFlow(overrides);
      act(() => result.current.run('download'));
      act(() => result.current.run('wallet'));
      expect(result.current.wallet.open).toBe(false);
    }
    expect(exportAsset).not.toHaveBeenCalled();
  });

  it('asks first when the code may not scan; cancel exports nothing', () => {
    const { result } = renderFlow(failing);
    act(() => result.current.run('copy'));
    expect(result.current.gate.open).toBe(true);
    expect(result.current.gate.advice).not.toBeNull();
    act(() => result.current.gate.cancel());
    expect(result.current.gate.open).toBe(false);
    expect(exportAsset).not.toHaveBeenCalled();
  });

  it('exports with allowUnsafe once the gate is confirmed', async () => {
    const { result } = renderFlow(failing);
    act(() => result.current.run('download'));
    await act(async () => result.current.gate.confirm());
    expect(exportAsset).toHaveBeenCalledTimes(1);
    expect(exportAsset).toHaveBeenCalledWith('png', expect.objectContaining({ allowUnsafe: true }));
  });

  it('offers the gate again when the finished image fails the scan check, then retries with allowUnsafe (#1255)', async () => {
    exportAsset.mockResolvedValueOnce(scanFailure());
    const { result } = renderFlow();
    await act(async () => result.current.run('download'));
    expect(result.current.gate.open).toBe(true);
    expect(result.current.status.done).toBeNull();
    await act(async () => result.current.gate.confirm());
    expect(exportAsset).toHaveBeenCalledTimes(2);
    expect(exportAsset).toHaveBeenLastCalledWith('png', expect.objectContaining({ allowUnsafe: true }));
    expect(result.current.status.done).toEqual({ format: 'png', message: 'PNG downloaded' });
  });

  it('shows the busy format while an export runs and clears it after', async () => {
    let finish: (status: ExportStatus) => void = () => {};
    exportAsset.mockImplementationOnce(() => new Promise<ExportStatus>((resolve) => { finish = resolve; }));
    const { result } = renderFlow();
    act(() => result.current.run('copy'));
    expect(result.current.status.busy).toBe('clipboard');
    await act(async () => finish({ success: true, format: 'clipboard' }));
    expect(result.current.status.busy).toBeNull();
  });

  it('clears the done mark after 2 seconds', async () => {
    vi.useFakeTimers();
    const { result } = renderFlow();
    await act(async () => result.current.run('download'));
    expect(result.current.status.done).not.toBeNull();
    act(() => vi.advanceTimersByTime(1999));
    expect(result.current.status.done).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.status.done).toBeNull();
    expect(exportAsset).toHaveBeenCalledTimes(1);
  });
});
