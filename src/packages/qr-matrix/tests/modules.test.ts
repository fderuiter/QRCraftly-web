import { describe, it, expect, vi } from 'vitest';
import { renderModules } from '../index';
import { QRStyle } from '@/types';

describe('renderModules', () => {
  const createMockCtx = () => {
    const mockGradient = {
      addColorStop: vi.fn(),
    };
    return {
      beginPath: vi.fn(),
      rect: vi.fn(),
      fillRect: vi.fn(),
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
      createLinearGradient: vi.fn().mockReturnValue(mockGradient),
      createRadialGradient: vi.fn().mockReturnValue(mockGradient),
      fillStyle: '',
      strokeStyle: '',
    } as unknown as CanvasRenderingContext2D;
  };

  const createMockModules = (moduleCount: number, activeCoords: [number, number][]) => {
    const grid = Array.from({ length: moduleCount }, () => Array(moduleCount).fill(false));
    activeCoords.forEach(([r, c]) => {
      if (r >= 0 && r < moduleCount && c >= 0 && c < moduleCount) {
        grid[r][c] = true;
      }
    });
    return {
      get: (r: number, c: number) => grid[r]?.[c] ?? false,
      size: moduleCount,
    } as any;
  };

  const baseConfig = {
    style: QRStyle.STANDARD,
    fgColor: '#000000',
    bgColor: '#ffffff',
    logoUrl: '',
    logoSize: 0.2,
    logoPadding: 1,
    logoPaddingStyle: 'square',
    errorCorrectionLevel: 'H',
  } as any;

  const mockLogoMetrics = {
    logoSizePx: 0,
    logoPaddingPx: 0,
    cutoutModuleSize: 0,
    effectiveLogoSizeModules: 0,
    effectivePaddingModules: 0,
  };

  it('renders standard modules using Math.floor/Math.ceil', () => {
    const ctx = createMockCtx();
    const modules = createMockModules(21, [[10, 10]]);
    renderModules(ctx, modules, { ...baseConfig, style: QRStyle.STANDARD }, 0, 0, 10, 21, mockLogoMetrics, false);

    expect(ctx.rect).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('renders standard modules when isVirtual is true using Math.round', () => {
    const ctx = createMockCtx();
    const modules = createMockModules(21, [[10, 10]]);
    renderModules(ctx, modules, { ...baseConfig, style: QRStyle.STANDARD }, 0, 0, 10, 21, mockLogoMetrics, true);

    expect(ctx.rect).toHaveBeenCalled();
  });

  it('renders modern modules', () => {
    const ctx = createMockCtx();
    const modules = createMockModules(21, [[10, 10]]);
    renderModules(ctx, modules, { ...baseConfig, style: QRStyle.MODERN }, 0, 0, 10, 21, mockLogoMetrics, false);

    expect(ctx.beginPath).toHaveBeenCalled();
  });

  it('renders swiss style modules', () => {
    const ctx = createMockCtx();
    const modules = createMockModules(21, [[10, 10]]);
    renderModules(ctx, modules, { ...baseConfig, style: QRStyle.SWISS }, 0, 0, 10, 21, mockLogoMetrics, false);

    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalled();
  });

  it('renders fluid style modules', () => {
    const ctx = createMockCtx();
    const modules = createMockModules(21, [[10, 10]]);
    renderModules(ctx, modules, { ...baseConfig, style: QRStyle.FLUID }, 0, 0, 10, 21, mockLogoMetrics, false);

    expect(ctx.quadraticCurveTo).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('renders hive style modules', () => {
    const ctx = createMockCtx();
    const modules = createMockModules(21, [[10, 10]]);
    renderModules(ctx, modules, { ...baseConfig, style: QRStyle.HIVE }, 0, 0, 10, 21, mockLogoMetrics, false);

    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.closePath).toHaveBeenCalled();
  });

  it('renders grunge style modules', () => {
    const ctx = createMockCtx();
    const modules = createMockModules(21, [[10, 10]]);
    renderModules(ctx, modules, { ...baseConfig, style: QRStyle.GRUNGE }, 0, 0, 10, 21, mockLogoMetrics, false);

    expect(ctx.beginPath).toHaveBeenCalled();
  });

  it('renders starburst style modules', () => {
    const ctx = createMockCtx();
    const modules = createMockModules(21, [[10, 10]]);
    renderModules(ctx, modules, { ...baseConfig, style: QRStyle.STARBURST }, 0, 0, 10, 21, mockLogoMetrics, false);

    expect(ctx.lineTo).toHaveBeenCalled();
  });

  it('renders circuit modules with all adjacent direction links', () => {
    const ctx = createMockCtx();
    const activeCoords: [number, number][] = [
      [10, 10],
      [9, 10],
      [11, 10],
      [10, 9],
      [10, 11]
    ];
    const modules = createMockModules(21, activeCoords);
    renderModules(ctx, modules, { ...baseConfig, style: QRStyle.CIRCUIT }, 0, 0, 10, 21, mockLogoMetrics, false);

    expect(ctx.rect).toHaveBeenCalled();
  });

  it('excludes modules covered by logo', () => {
    const ctx = createMockCtx();
    const modules = createMockModules(21, [[10, 10]]);
    
    const configWithLogo = {
      ...baseConfig,
      logoUrl: 'http://example.com/logo.png',
      logoPaddingStyle: 'square',
    };
    const logoMetricsWithCutout = {
      ...mockLogoMetrics,
      cutoutModuleSize: 5,
    };

    renderModules(ctx, modules, configWithLogo, 0, 0, 10, 21, logoMetricsWithCutout, false);

    expect(ctx.rect).not.toHaveBeenCalled();
  });

  it('builds linear gradient when gradientType is linear', () => {
    const ctx = createMockCtx();
    const modules = createMockModules(21, [[10, 10]]);
    const linearConfig = {
      ...baseConfig,
      gradientType: 'linear',
      gradientColorStops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
      gradientAngle: 90,
    };

    renderModules(ctx, modules, linearConfig, 0, 0, 10, 21, mockLogoMetrics, false);

    expect(ctx.createLinearGradient).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('builds radial gradient when gradientType is radial', () => {
    const ctx = createMockCtx();
    const modules = createMockModules(21, [[10, 10]]);
    const radialConfig = {
      ...baseConfig,
      gradientType: 'radial',
      gradientColorStops: [
        { offset: 0, color: '#00ff00' },
        { offset: 1, color: '#ff00ff' },
      ],
    };

    renderModules(ctx, modules, radialConfig, 0, 0, 10, 21, mockLogoMetrics, false);

    expect(ctx.createRadialGradient).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });
});

