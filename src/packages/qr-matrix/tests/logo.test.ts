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
import { renderLogo, type LogoMetrics } from '../index';
import { DEFAULT_CONFIG } from '@/constants';
import type { QRConfig } from '@/types';

describe('renderLogo', () => {
  const createMockContext = () => ({
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D);

  const mockMetrics: LogoMetrics = {
    logoSizePx: 40,
    logoPaddingPx: 5,
    cutoutModuleSize: 5,
    effectiveLogoSizeModules: 4,
    effectivePaddingModules: 0.5,
  };

  it('does nothing if no logoUrl or logoImg', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      logoUrl: '',
    };
    renderLogo(ctx, config, null, 200, mockMetrics);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('renders logo with no padding', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      logoUrl: 'logo.png',
      logoPaddingStyle: 'none',
    };
    const mockImg = {} as HTMLImageElement;
    renderLogo(ctx, config, mockImg, 200, mockMetrics);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledWith(mockImg, 80, 80, 40, 40);
  });

  it('renders logo with circle padding and custom background color', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      logoUrl: 'logo.png',
      logoPaddingStyle: 'circle',
      logoBackgroundColor: '#ff0000',
    };
    const mockImg = {} as HTMLImageElement;
    renderLogo(ctx, config, mockImg, 200, mockMetrics);
    expect(ctx.fillStyle).toBe('#ff0000');
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalledWith(100, 100, 25, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledWith(mockImg, 80, 80, 40, 40);
  });

  it('renders logo with circle padding and default background color fallback', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      logoUrl: 'logo.png',
      logoPaddingStyle: 'circle',
      logoBackgroundColor: '',
      bgColor: '#0000ff',
    };
    const mockImg = {} as HTMLImageElement;
    renderLogo(ctx, config, mockImg, 200, mockMetrics);
    expect(ctx.fillStyle).toBe('#0000ff');
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalledWith(100, 100, 25, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledWith(mockImg, 80, 80, 40, 40);
  });

  it('renders logo with square padding', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      logoUrl: 'logo.png',
      logoPaddingStyle: 'square',
      logoBackgroundColor: '#00ff00',
    };
    const mockImg = {} as HTMLImageElement;
    renderLogo(ctx, config, mockImg, 200, mockMetrics);
    expect(ctx.fillStyle).toBe('#00ff00');
    expect(ctx.fillRect).toHaveBeenCalledWith(75, 75, 50, 50);
    expect(ctx.drawImage).toHaveBeenCalledWith(mockImg, 80, 80, 40, 40);
  });
});
