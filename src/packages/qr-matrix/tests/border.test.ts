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
import { renderBorder, renderBorderDecoration } from '../index';
import { DEFAULT_CONFIG } from '@/constants';
import type { QRConfig } from '@/types';

describe('renderBorder', () => {
  const createMockContext = () => ({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D);

  it('renders solid border', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      borderColor: '#ff0000',
      borderStyle: 'solid',
    };
    renderBorder(ctx, config, 200, 20);
    expect(ctx.fillStyle).toBe('#ff0000');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 200);
  });

  it('renders dashed border', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      borderColor: '#ff0000',
      borderStyle: 'dashed',
      bgColor: '#ffffff',
    };
    renderBorder(ctx, config, 200, 20);
    expect(ctx.setLineDash).toHaveBeenNthCalledWith(1, [10, 10]);
    expect(ctx.setLineDash).toHaveBeenNthCalledWith(2, []);
    expect(ctx.strokeRect).toHaveBeenCalled();
  });

  it('renders dotted border', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      borderColor: '#ff0000',
      borderStyle: 'dotted',
      bgColor: '#ffffff',
    };
    renderBorder(ctx, config, 200, 20);
    expect(ctx.setLineDash).toHaveBeenNthCalledWith(1, [4, 4]);
    expect(ctx.setLineDash).toHaveBeenNthCalledWith(2, []);
    expect(ctx.strokeRect).toHaveBeenCalled();
  });

  it('renders double border', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      borderColor: '#ff0000',
      borderStyle: 'double',
      bgColor: '#ffffff',
    };
    renderBorder(ctx, config, 200, 20);
    expect(ctx.strokeStyle).toBe('#ffffff');
    expect(ctx.lineWidth).toBe(3);
    expect(ctx.strokeRect).toHaveBeenCalled();
  });
});

describe('renderBorderDecoration', () => {
  const createMockContext = () => ({
    fillText: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D);

  it('does nothing if no decoration config', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      borderText: '',
      borderLogoUrl: '',
    };
    renderBorderDecoration(ctx, config, 200, 20, null);
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('renders border text at top-center', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      borderText: 'My QR Code',
      borderTextColor: '#00ff00',
      borderTextPosition: 'top-center',
    };
    renderBorderDecoration(ctx, config, 200, 20, null);
    expect(ctx.fillStyle).toBe('#00ff00');
    expect(ctx.fillText).toHaveBeenCalledWith('My QR Code', 100, 10);
  });

  it('renders border text at bottom-center', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      borderText: 'My QR Code',
      borderTextColor: '#00ff00',
      borderTextPosition: 'bottom-center',
    };
    renderBorderDecoration(ctx, config, 200, 20, null);
    expect(ctx.fillStyle).toBe('#00ff00');
    expect(ctx.fillText).toHaveBeenCalledWith('My QR Code', 100, 190);
  });

  it('renders border logo at bottom-center', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      borderLogoUrl: 'logo.png',
      borderLogoPosition: 'bottom-center',
    };
    const mockImg = {} as HTMLImageElement;
    renderBorderDecoration(ctx, config, 200, 20, mockImg);
    expect(ctx.drawImage).toHaveBeenCalledWith(mockImg, 92, 182, 16, 16);
  });

  it('renders border logo at bottom-right', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      borderLogoUrl: 'logo.png',
      borderLogoPosition: 'bottom-right',
    };
    const mockImg = {} as HTMLImageElement;
    renderBorderDecoration(ctx, config, 200, 20, mockImg);
    expect(ctx.drawImage).toHaveBeenCalledWith(mockImg, 164, 182, 16, 16);
  });

  it('renders border text with unsupported position (implicit else / false condition)', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      borderText: 'My QR Code',
      borderTextColor: '#00ff00',
      borderTextPosition: 'top-left' as any,
    };
    renderBorderDecoration(ctx, config, 200, 20, null);
    expect(ctx.fillStyle).toBe('#00ff00');
    expect(ctx.fillText).toHaveBeenCalledWith('My QR Code', 100, 10);
  });

  it('renders border logo with unsupported position (implicit else / false condition)', () => {
    const ctx = createMockContext();
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      borderLogoUrl: 'logo.png',
      borderLogoPosition: 'top-left' as any,
    };
    const mockImg = {} as HTMLImageElement;
    renderBorderDecoration(ctx, config, 200, 20, mockImg);
    expect(ctx.drawImage).toHaveBeenCalledWith(mockImg, 92, 182, 16, 16);
  });
});
