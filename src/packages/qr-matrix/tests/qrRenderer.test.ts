// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { drawQR } from '../index';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { QRStyle } from '@/packages/core/types';

describe('drawQR', () => {
  let mockContext: any;
  let mockModules: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      roundRect: vi.fn(),
      quadraticCurveTo: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      save: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      setLineDash: vi.fn(),
      strokeRect: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      canvas: { width: 0, height: 0 },
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    };

    mockModules = {
      size: 21,
      get: vi.fn().mockReturnValue(false),
    };
  });

  it('draws background and modules', () => {
    mockModules.get.mockImplementation((r: number, c: number) => {
      return r === 10 && c === 10;
    });

    drawQR(mockContext, mockModules, DEFAULT_CONFIG, null, null, 100);

    expect(mockContext.clearRect).toHaveBeenCalled();
    expect(mockContext.fillRect).toHaveBeenCalled();
  });

  it('draws rounded rects for MODERN style', () => {
    mockModules.get.mockImplementation((r: number, c: number) => {
      return r === 10 && c === 10;
    });

    const config = { ...DEFAULT_CONFIG, style: QRStyle.MODERN };
    drawQR(mockContext, mockModules, config, null, null, 100);

    expect(mockContext.quadraticCurveTo).toHaveBeenCalled();
  });

  it('draws circles for SWISS style', () => {
    mockModules.get.mockImplementation((r: number, c: number) => {
      return r === 10 && c === 10;
    });

    const config = { ...DEFAULT_CONFIG, style: QRStyle.SWISS };
    drawQR(mockContext, mockModules, config, null, null, 100);

    expect(mockContext.arc).toHaveBeenCalled();
  });

  it('draws logo when provided', () => {
    const logoImg = { width: 100, height: 100 } as HTMLImageElement;
    drawQR(mockContext, mockModules, { ...DEFAULT_CONFIG, logoUrl: 'test' }, logoImg, null, 100);

    expect(mockContext.drawImage).toHaveBeenCalledWith(logoImg, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
  });

  it('draws border when enabled', () => {
    const config = { ...DEFAULT_CONFIG, isBorderEnabled: true, borderSize: 0.1, borderColor: '#ff0000' };
    drawQR(mockContext, mockModules, config, null, null, 100);

    expect(mockContext.fillRect).toHaveBeenCalled();
    expect(mockContext.fillStyle).toBe(config.fgColor);
  });

  it('draws dashed border', () => {
    const config = { ...DEFAULT_CONFIG, isBorderEnabled: true, borderSize: 0.1, borderStyle: 'dashed' as const };
    drawQR(mockContext, mockModules, config, null, null, 100);

    expect(mockContext.setLineDash).toHaveBeenCalled();
    expect(mockContext.strokeRect).toHaveBeenCalled();
  });

  it('catches and warns on renderer exception', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    drawQR(mockContext, null as any, DEFAULT_CONFIG, null, null, 100);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('uses window.devicePixelRatio or fallback to 1', () => {
    const originalRatio = window.devicePixelRatio;

    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true, writable: true });
    drawQR(mockContext, mockModules, DEFAULT_CONFIG, null, null, 100);
    expect(mockContext.scale).toHaveBeenCalledWith(2, 2);

    Object.defineProperty(window, 'devicePixelRatio', { value: undefined, configurable: true, writable: true });
    drawQR(mockContext, mockModules, DEFAULT_CONFIG, null, null, 100);
    expect(mockContext.scale).toHaveBeenCalledWith(1, 1);

    Object.defineProperty(window, 'devicePixelRatio', { value: originalRatio, configurable: true, writable: true });
  });

  it('does not throw when window is completely undefined', () => {
    const originalWindow = (globalThis as any).window;
    try {
      (globalThis as any).window = undefined;

      drawQR(mockContext, mockModules, DEFAULT_CONFIG, null, null, 100);
      expect(mockContext.scale).toHaveBeenCalledWith(1, 1);
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });

  it('bails out early if fillRect is not a function on the context', () => {
    const invalidContext = { ...mockContext, fillRect: undefined };
    drawQR(invalidContext as any, mockModules, DEFAULT_CONFIG, null, null, 100);
    expect(mockContext.fillRect).not.toHaveBeenCalled();
  });
});

