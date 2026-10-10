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

import { describe, it, expect, vi } from 'vitest';
import { calculateLayout, renderFrame } from '../index';
import { DEFAULT_CONFIG } from '@/constants';
import type { QRConfig } from '@/types';

describe('Frame Matrix & Layout Rendering', () => {
  it('adjusts draw bounds when frameStyle is active', () => {
    const normalLayout = calculateLayout(DEFAULT_CONFIG as QRConfig, 512, 29);

    const framedConfig: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      frameStyle: 'pill',
      framePosition: 'bottom',
    };
    const framedLayout = calculateLayout(framedConfig, 512, 29);

    expect(framedLayout.drawSize).toBeLessThan(normalLayout.drawSize);
    expect(framedLayout.quietPx).toBeCloseTo(4 * framedLayout.cellSize, 9);
  });

  it('renders frame shapes onto canvas context without error', () => {
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 50 }),
      fillStyle: '',
      strokeStyle: '',
      font: '',
      textAlign: '',
      textBaseline: '',
    } as unknown as CanvasRenderingContext2D;

    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      frameStyle: 'speech-bubble',
      frameText: 'SCAN HERE',
      framePosition: 'bottom',
      frameIcon: 'scan',
      frameBgColor: '#2563eb',
      frameTextColor: '#ffffff',
    };

    const layout = calculateLayout(config, 512, 29);
    expect(() => renderFrame(mockCtx, config, 512, layout)).not.toThrow();
  });
});
