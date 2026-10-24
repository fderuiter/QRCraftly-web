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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { QRType, type QRConfig } from '@/packages/core/types';
import { getSamplePayload } from '@/packages/qr-payload';
import { QRProvider, useQRStore } from '@/context/QRContext';
import { useGeneratorPreview } from './useGeneratorPreview';

const checkScannability = vi.hoisted(() => vi.fn());
const scannabilityConfigs = vi.hoisted((): Array<{ value: string }> => []);
vi.mock('./useScannability', () => ({
  useScannability: (_ref: unknown, config: { value: string }) => {
    scannabilityConfigs.push(config);
    return { status: 'fail', health: { score: 10, warnings: [], criticalWarnings: ['x'] }, checkScannability, workerRecoveryActive: false };
  },
}));

const canvasRef = { current: null };

function renderPreview(config: Partial<QRConfig>) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QRProvider initialConfig={{ ...DEFAULT_CONFIG, ...config }}>{children}</QRProvider>
  );
  return renderHook(() => ({ preview: useGeneratorPreview(canvasRef), store: useQRStore() }), { wrapper });
}

describe('useGeneratorPreview', () => {
  beforeEach(() => {
    checkScannability.mockReset();
    scannabilityConfigs.length = 0;
  });

  it('passes a real code and its verdict through', () => {
    const { result } = renderPreview({ type: QRType.URL, value: 'https://example.com' });
    const { preview } = result.current;
    expect(preview.effectiveConfig.value).toBe('https://example.com');
    expect(preview.debouncedConfig.value).toBe('https://example.com');
    expect(preview.verdict).toBe('fail');
    expect(preview.noVerdict).toBe(false);
  });

  it('shows the sample with no verdict for an empty form', () => {
    const { result } = renderPreview({ type: QRType.URL, value: '' });
    const { preview } = result.current;
    expect(preview.isEmpty).toBe(true);
    expect(preview.effectiveConfig.value).toBe(getSamplePayload(QRType.URL));
    expect(preview.verdict).toBe('idle');
    expect(preview.health).toBeUndefined();
  });

  it('draws nothing and shows no verdict while a field is refused (#1279)', () => {
    const { result } = renderPreview({ type: QRType.URL, value: 'https://example.com' });
    act(() => result.current.store.setContentRefused(true));
    const { preview } = result.current;
    expect(preview.refused).toBe(true);
    expect(preview.effectiveConfig.value).toBe('');
    expect(preview.verdict).toBe('idle');
  });

  it('gives the scan check the undebounced config', () => {
    renderPreview({ type: QRType.URL, value: 'https://example.com' });
    expect(scannabilityConfigs.at(-1)?.value).toBe('https://example.com');
  });

  it('records the module count and runs one scan check per render', () => {
    const { result } = renderPreview({ type: QRType.URL, value: 'https://example.com' });
    const image: ImageData = { data: new Uint8ClampedArray(4), width: 1, height: 1, colorSpace: 'srgb' };
    act(() => result.current.preview.onRendered({ moduleCount: 29, virtualImageData: image }));
    expect(result.current.preview.moduleCount).toBe(29);
    expect(checkScannability).toHaveBeenCalledTimes(1);
    expect(checkScannability).toHaveBeenCalledWith(image, undefined, 29);
  });

  it('clears a render failure once the preview draws again', () => {
    const { result } = renderPreview({ type: QRType.URL, value: 'https://example.com' });
    act(() => result.current.preview.onRenderFailed('too-long'));
    expect(result.current.preview.previewFailure).toBe('too-long');
    expect(result.current.preview.verdict).toBe('idle');
    act(() => result.current.preview.onRendered({ moduleCount: 21 }));
    expect(result.current.preview.previewFailure).toBeNull();
    expect(checkScannability).not.toHaveBeenCalled();
  });
});
