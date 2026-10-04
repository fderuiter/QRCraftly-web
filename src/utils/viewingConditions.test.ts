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

import { describe, expect, it, vi } from 'vitest';
import type { PixelFrame, ScannabilityStatus } from '@/packages/scannability';
import { pixelsAcross, runViewingTest, viewingConditions } from './viewingConditions';

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
    // The unanswered distance was retried once; the undrawable one was never evaluated.
    expect(evaluate).toHaveBeenCalledTimes(5);
  });
});
