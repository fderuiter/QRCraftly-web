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

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { PixelFrame, ScannabilityStatus } from '@/packages/scannability';
import { DEFAULT_CONFIG } from '@/constants';
import { pixelsAcross, renderCondition, runViewingTest, testViewingConditions, viewingConditions } from './viewingConditions';

const frame: PixelFrame = { data: new Uint8ClampedArray(4), width: 1, height: 1 };

describe('viewing conditions', () => {
  it('sees fewer pixels across a code the farther away or smaller it is', () => {
    expect(pixelsAcross(10, 100)).toBeGreaterThan(pixelsAcross(10, 300));
    expect(pixelsAcross(10, 100)).toBeGreaterThan(pixelsAcross(5, 100));
    expect(pixelsAcross(10, 100)).toBeCloseTo((1280 * 10) / (100 * 1.27), 5);
  });

  it('tries the design itself, three distances at the printed size, glare, dim light and a tilt', () => {
    const conditions = viewingConditions(8);
    expect(conditions.map((condition) => condition.id)).toEqual(['as-designed', 'distance-100', 'distance-200', 'distance-300', 'glare', 'low-light', 'angle']);
    expect(conditions.find((condition) => condition.id === 'distance-300')?.label).toBe('From 3.0 m away');
    expect(conditions.filter((condition) => condition.kind === 'distance').every((condition) => 'widthCm' in condition && condition.widthCm === 8)).toBe(true);
  });

  it('reports pass for a decoded code, fail for one that was not found, and null when nothing could be checked', async () => {
    const statuses: Record<string, ScannabilityStatus | null> = {
      'as-designed': 'physical-pass',
      'distance-100': 'digital-pass',
      'distance-200': 'fail',
      'distance-300': null,
    };
    const render = vi.fn((condition: { id: string }) => (condition.id === 'glare' ? null : frame));
    const evaluate = vi.fn(async () => null as ScannabilityStatus | null);
    const ids = ['as-designed', 'distance-100', 'distance-200', 'distance-300', 'glare'];
    let call = 0;
    evaluate.mockImplementation(async () => statuses[ids[Math.min(call++, 3)]] ?? null);
    const results = await runViewingTest(viewingConditions(8).slice(0, 5), render, evaluate);
    expect(results.map((result) => result.passed)).toEqual([true, true, false, null, null]);
    // Each printable frame is evaluated once without duplicate sequential retries; undrawable glare is not evaluated.
    expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it('creates zero new canvas elements during repeated viewing condition test executions', async () => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 128;
    sourceCanvas.height = 128;

    // First execution primes the canvas pool
    await testViewingConditions(sourceCanvas, DEFAULT_CONFIG, 33, 8);

    // Spy on document.createElement during subsequent executions
    const createSpy = vi.spyOn(document, 'createElement');
    createSpy.mockClear();

    await testViewingConditions(sourceCanvas, DEFAULT_CONFIG, 33, 8);
    await testViewingConditions(sourceCanvas, DEFAULT_CONFIG, 33, 8);

    expect(createSpy).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it('renders valid pixel output frames for all 7 viewing conditions', () => {
    const mockContext = {
      fillStyle: '#ffffff',
      imageSmoothingEnabled: true,
      globalAlpha: 1.0,
      globalCompositeOperation: 'source-over',
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      putImageData: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      })),
    } as unknown as CanvasRenderingContext2D;

    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockContext);

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 128;
    sourceCanvas.height = 128;

    const conditions = viewingConditions(8);
    expect(conditions).toHaveLength(7);

    for (const condition of conditions) {
      const pixels = renderCondition(sourceCanvas, condition);
      expect(pixels).not.toBeNull();
      expect(pixels!.width).toBe(512);
      expect(pixels!.height).toBe(512);
      expect(pixels!.data.length).toBe(512 * 512 * 4);
    }

    getContextSpy.mockRestore();
  });

  it('completes viewing condition analysis in under 100 milliseconds', async () => {
    const mockContext = {
      fillStyle: '#ffffff',
      imageSmoothingEnabled: true,
      globalAlpha: 1.0,
      globalCompositeOperation: 'source-over',
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      putImageData: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      })),
    } as unknown as CanvasRenderingContext2D;

    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockContext);

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 128;
    sourceCanvas.height = 128;

    const conditions = viewingConditions(8);
    const startTime = performance.now();
    const results = await runViewingTest(
      conditions,
      (condition) => renderCondition(sourceCanvas, condition),
      async () => 'digital-pass'
    );
    const duration = performance.now() - startTime;

    expect(results).toHaveLength(7);
    expect(duration).toBeLessThan(100);

    getContextSpy.mockRestore();
  });
});
