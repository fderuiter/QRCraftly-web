/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import { afterEach, describe, expect, it, vi } from 'vitest';

const { performScannabilityCheck, loadQrReader } = vi.hoisted(() => ({
  performScannabilityCheck: vi.fn(),
  loadQrReader: vi.fn(),
}));

vi.mock('../checker', () => ({ performScannabilityCheck }));
vi.mock('@/packages/qr-decode', () => ({ loadQrReader }));

import { isCanvasScannable, isFrameScannable, warmScanCheck } from '../scan';

const frame = { imageData: { data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData, width: 1, height: 1, moduleCount: 21 };

afterEach(() => {
  vi.clearAllMocks();
});

describe('the shared scan check (#1600)', () => {
  it('retries the reader after a failed load, then loads it once', async () => {
    loadQrReader.mockRejectedValueOnce(new Error('offline'));
    await expect(warmScanCheck()).rejects.toThrow('offline');

    const reader = { read: vi.fn() };
    loadQrReader.mockResolvedValue(reader);
    performScannabilityCheck.mockReturnValue({ success: true });
    await expect(isFrameScannable(frame)).resolves.toBe(true);
    await expect(isFrameScannable(frame)).resolves.toBe(true);
    expect(loadQrReader).toHaveBeenCalledTimes(2);
    expect(performScannabilityCheck).toHaveBeenCalledWith(reader, { data: frame.imageData.data, width: 1, height: 1 }, 1, 1, 21, undefined);
  });

  it('reports a failing frame', async () => {
    performScannabilityCheck.mockReturnValue({ success: false });
    await expect(isFrameScannable(frame)).resolves.toBe(false);
  });

  it('fails a canvas without a 2D context and checks one with it', async () => {
    const blank = { getContext: () => null, width: 1, height: 1 } as unknown as HTMLCanvasElement;
    await expect(isCanvasScannable(blank)).resolves.toBe(false);

    const imageData = frame.imageData;
    const canvas = { getContext: () => ({ getImageData: () => imageData }), width: 1, height: 1 } as unknown as HTMLCanvasElement;
    performScannabilityCheck.mockReturnValue({ success: true });
    await expect(isCanvasScannable(canvas)).resolves.toBe(true);
    expect(performScannabilityCheck).toHaveBeenCalledWith(expect.anything(), { data: imageData.data, width: 1, height: 1 }, 1, 1, undefined, undefined);
  });
});
