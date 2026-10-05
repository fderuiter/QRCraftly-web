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
import { renderEyes } from '../index';
import { QRStyle } from '@/types';

describe('renderEyes', () => {
  const createMockCtx = () => {
    return {
      beginPath: vi.fn(),
      rect: vi.fn(),
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      bezierCurveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      ellipse: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      stroke: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
    } as unknown as CanvasRenderingContext2D;
  };

  const baseConfig = {
    value: 'test',
    type: 'URL' as any,
    style: QRStyle.STANDARD,
    eyeColor: '#000000',
    bgColor: '#ffffff',
    fgColor: '#000000',
    logoImage: undefined,
    logoPaddingStyle: 'NONE' as any,
  } as any;

  it('renders standard eyes by default', () => {
    const ctx = createMockCtx();
    renderEyes(ctx, { ...baseConfig, style: QRStyle.STANDARD }, 0, 0, 10, 21);

    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });

  it('renders modern eyes', () => {
    const ctx = createMockCtx();
    renderEyes(ctx, { ...baseConfig, style: QRStyle.MODERN }, 0, 0, 10, 21);

    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('renders swiss dot eyes', () => {
    const ctx = createMockCtx();
    renderEyes(ctx, { ...baseConfig, style: QRStyle.SWISS }, 0, 0, 10, 21);

    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('renders fluid eyes with a squircle eyeball (no circle, so decoders find the finder)', () => {
    const ctx = createMockCtx();
    renderEyes(ctx, { ...baseConfig, style: QRStyle.FLUID }, 0, 0, 10, 21);

    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.quadraticCurveTo).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('renders circuit eyes with cuts and notched square eyeball', () => {
    const ctx = createMockCtx();
    renderEyes(ctx, { ...baseConfig, style: QRStyle.CIRCUIT }, 0, 0, 10, 21);

    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.rect).toHaveBeenCalled();
  });

  it('renders hive eyes with hexagonal eyeball', () => {
    const ctx = createMockCtx();
    renderEyes(ctx, { ...baseConfig, style: QRStyle.HIVE }, 0, 0, 10, 21);

    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.closePath).toHaveBeenCalled();
  });

  it('renders grunge eyes with rough rect frame and scribble eyeball', () => {
    const ctx = createMockCtx();
    renderEyes(ctx, { ...baseConfig, style: QRStyle.GRUNGE }, 0, 0, 10, 21);

    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('renders starburst eyes with star-shaped eyeball', () => {
    const ctx = createMockCtx();
    renderEyes(ctx, { ...baseConfig, style: QRStyle.STARBURST }, 0, 0, 10, 21);

    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('falls back to default standard style for unhandled styles', () => {
    const ctx = createMockCtx();
    renderEyes(ctx, { ...baseConfig, style: 'INVALID_STYLE' as any }, 0, 0, 10, 21);

    expect(ctx.clearRect).not.toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
  });
});
