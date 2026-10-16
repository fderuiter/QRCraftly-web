/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SOCIAL_DIMENSIONS,
  drawWithTemplate,
  SvgContext,
} from '../index';
import { DEFAULT_CONFIG } from '@/constants';
import { SocialFormat, TemplateStyle, type QRConfig, QRStyle, QRType } from '@/types';
import * as qrMatrix from '@/packages/qr-matrix';
import * as qrMatrixCanvas from '@/packages/qr-matrix/canvas';
import { calculateLayout } from '@/packages/qr-matrix';

// ---------------------------------------------------------------------------
// SOCIAL_DIMENSIONS
// ---------------------------------------------------------------------------
describe('SOCIAL_DIMENSIONS', () => {
  it('maps SQUARE_1_1 to 1080x1080', () => {
    expect(SOCIAL_DIMENSIONS[SocialFormat.SQUARE_1_1]).toEqual({ width: 1080, height: 1080 });
  });

  it('maps PORTRAIT_4_5 to 1080x1350', () => {
    expect(SOCIAL_DIMENSIONS[SocialFormat.PORTRAIT_4_5]).toEqual({ width: 1080, height: 1350 });
  });

  it('maps STORY_9_16 to 1080x1920', () => {
    expect(SOCIAL_DIMENSIONS[SocialFormat.STORY_9_16]).toEqual({ width: 1080, height: 1920 });
  });

  it('has aspect ratios matching their names', () => {
    const square = SOCIAL_DIMENSIONS[SocialFormat.SQUARE_1_1];
    expect(square.width / square.height).toBeCloseTo(1);

    const portrait = SOCIAL_DIMENSIONS[SocialFormat.PORTRAIT_4_5];
    expect(portrait.width / portrait.height).toBeCloseTo(4 / 5, 2);

    const story = SOCIAL_DIMENSIONS[SocialFormat.STORY_9_16];
    expect(story.width / story.height).toBeCloseTo(9 / 16, 2);
  });
});

// ---------------------------------------------------------------------------
// drawWithTemplate – verifies drawQRInternal is called with correct bounding box
// ---------------------------------------------------------------------------

interface MockCtx extends CanvasRenderingContext2D {
  _calls: Array<{ method: string; args: number[] }>;
  _fillStyleHistory: string[];
  _strokeStyleHistory: string[];
  _filledCalls: Array<{ text: string; font: string }>;
}

function getFilledTexts(ctx: CanvasRenderingContext2D): string[] {
  return vi.mocked(ctx.fillText).mock.calls.map((call) => String(call[0]));
}

/**
 * Builds a minimal mock 2D context that records translate/scale calls and
 * satisfies the subset used by drawWithTemplate.
 */
function makeMockCtx(): MockCtx {
  const calls: Array<{ method: string; args: number[] }> = [];
  const fillStyleHistory: string[] = [];
  const strokeStyleHistory: string[] = [];
  const filledCalls: Array<{ text: string; font: string }> = [];

  let _fillStyle = '';
  let _strokeStyle = '';
  let _font = '10px sans-serif';

  const ctx = {
    _calls: calls,
    _filledCalls: filledCalls,
    get _fillStyleHistory() { return fillStyleHistory; },
    get _strokeStyleHistory() { return strokeStyleHistory; },
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    createRadialGradient: vi.fn().mockReturnValue({
      addColorStop: vi.fn(),
    }),
    save: vi.fn(() => calls.push({ method: 'save', args: [] })),
    restore: vi.fn(() => calls.push({ method: 'restore', args: [] })),
    translate: vi.fn((x: number, y: number) => calls.push({ method: 'translate', args: [x, y] })),
    scale: vi.fn((sx: number, sy: number) => calls.push({ method: 'scale', args: [sx, sy] })),
    fillText: vi.fn((text: string) => {
      filledCalls.push({ text: String(text), font: _font });
    }),
    strokeText: vi.fn(),
    measureText: vi.fn().mockImplementation((text: string) => {
      const match = _font.match(/(\d+(?:\.\d+)?)px/);
      const fontSize = match ? parseFloat(match[1]) : 16;
      return { width: String(text).length * fontSize * 0.55 } as TextMetrics;
    }),
    // Path methods required by the safe-zone rounded rect
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    roundRect: vi.fn(),
    get fillStyle() { return _fillStyle; },
    set fillStyle(v: string) { _fillStyle = v; fillStyleHistory.push(v); },
    get strokeStyle() { return _strokeStyle; },
    set strokeStyle(v: string) { _strokeStyle = v; strokeStyleHistory.push(v); },
    lineWidth: 1,
    get font() { return _font; },
    set font(v: string) { _font = v; },
    textAlign: '',
    textBaseline: '',
  };

  return ctx as unknown as MockCtx;
}

/** Minimal QRModules stub */
function makeModules(size = 21) {
  return {
    size,
    get: (_r: number, _c: number) => false,
  };
}

describe('drawWithTemplate', () => {
  let drawQRInternalSpy: ReturnType<typeof vi.spyOn>;
  const baseConfig: QRConfig = {
    ...(DEFAULT_CONFIG as QRConfig),
    socialFormat: SocialFormat.SQUARE_1_1,
    templateStyle: TemplateStyle.NONE,
  };

  beforeEach(() => {
    drawQRInternalSpy = vi.spyOn(qrMatrix, 'drawQRInternal').mockImplementation(vi.fn());
  });

  it('calls drawQRInternal exactly once', () => {
    const ctx = makeMockCtx();
    const modules = makeModules();
    drawWithTemplate(ctx, modules, baseConfig, null, null, 1080, 1080, modules.size);
    expect(drawQRInternalSpy).toHaveBeenCalledTimes(1);
  });

  it('calls save() before and restore() after drawQRInternal', () => {
    const ctx = makeMockCtx();
    const modules = makeModules();
    drawWithTemplate(ctx, modules, baseConfig, null, null, 1080, 1080, modules.size);

    const saveIdx = (ctx as any)._calls.findIndex((c: any) => c.method === 'save');
    const restoreIdx = (ctx as any)._calls.findIndex((c: any) => c.method === 'restore');

    expect(saveIdx).toBeGreaterThanOrEqual(0);
    expect(restoreIdx).toBeGreaterThan(saveIdx);
  });

  it('translates to (0, 0) for NONE + SQUARE (fills entire canvas)', () => {
    const ctx = makeMockCtx();
    const modules = makeModules();
    drawWithTemplate(ctx, modules, baseConfig, null, null, 1080, 1080, modules.size);

    const translateCall = (ctx as any)._calls.find((c: any) => c.method === 'translate');
    expect(translateCall).toBeDefined();
    expect(translateCall.args[0]).toBeCloseTo(0);
    expect(translateCall.args[1]).toBeCloseTo(0);
  });

  it('centres the QR bounding box for a non-square canvas (STORY_9_16, MINIMALIST)', () => {
    const config: QRConfig = {
      ...baseConfig,
      socialFormat: SocialFormat.STORY_9_16,
      templateStyle: TemplateStyle.MINIMALIST,
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    const displayWidth = 1080;
    const displayHeight = 1920;
    drawWithTemplate(ctx, modules, config, null, null, displayWidth, displayHeight, modules.size);

    // Default scale=1.0 → qrSize = displayWidth * 0.5 * 1.0 = 540
    const qrSize = displayWidth * 0.5; // 540
    const expectedX = (displayWidth - qrSize) / 2; // 270
    const expectedY = (displayHeight - qrSize) / 2; // 690

    const translateCall = (ctx as any)._calls.find((c: any) => c.method === 'translate');
    expect(translateCall).toBeDefined();
    expect(translateCall.args[0]).toBeCloseTo(expectedX, 0);
    expect(translateCall.args[1]).toBeCloseTo(expectedY, 0);
  });

  it('passes the correct scale factor to ctx.scale()', () => {
    const config: QRConfig = {
      ...baseConfig,
      socialFormat: SocialFormat.STORY_9_16,
      templateStyle: TemplateStyle.MINIMALIST,
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    const displayWidth = 1080;
    const displayHeight = 1920;
    drawWithTemplate(ctx, modules, config, null, null, displayWidth, displayHeight, modules.size);

    // Default scale=1.0 → ctxScale = (displayWidth * 0.5 * 1.0) / displayWidth = 0.5
    const expectedCtxScale = (displayWidth * 0.5) / displayWidth; // 0.5

    const scaleCall = (ctx as any)._calls.find((c: any) => c.method === 'scale');
    expect(scaleCall).toBeDefined();
    expect(scaleCall.args[0]).toBeCloseTo(expectedCtxScale, 5);
    expect(scaleCall.args[1]).toBeCloseTo(expectedCtxScale, 5);
  });

  it('passes logo images through to drawQRInternal', () => {
    const logoImg = { src: 'data:image/png;base64,abc' } as unknown as HTMLImageElement;
    const borderLogoImg = { src: 'data:image/png;base64,def' } as unknown as HTMLImageElement;
    const ctx = makeMockCtx();
    const modules = makeModules();

    drawWithTemplate(ctx, modules, baseConfig, logoImg, borderLogoImg, 1080, 1080, modules.size);

    expect(drawQRInternalSpy).toHaveBeenCalledWith(
      expect.anything(),
      modules,
      baseConfig,
      logoImg,
      borderLogoImg,
      expect.any(Number),
      modules.size,
      false
    );
  });
});

// ---------------------------------------------------------------------------
// templateQrScale – bounding box scaling
// ---------------------------------------------------------------------------

describe('drawWithTemplate – templateQrScale', () => {
  const baseNonSquareConfig: QRConfig = {
    ...(DEFAULT_CONFIG as QRConfig),
    socialFormat: SocialFormat.STORY_9_16,
    templateStyle: TemplateStyle.MINIMALIST,
  };

  beforeEach(() => {
    vi.spyOn(qrMatrix, 'drawQRInternal').mockImplementation(vi.fn());
  });

  it('templateQrScale=0.5 halves the QR bounding box width', () => {
    const config: QRConfig = { ...baseNonSquareConfig, templateQrScale: 0.5 };
    const ctx = makeMockCtx();
    const modules = makeModules();

    const displayWidth = 1080;
    drawWithTemplate(ctx, modules, config, null, null, displayWidth, 1920, modules.size);

    // Expected: qrSize = displayWidth * 0.5 * 0.5 = 270
    const expectedQrSize = displayWidth * 0.5 * 0.5;
    const expectedCtxScale = expectedQrSize / displayWidth;

    const scaleCall = (ctx as any)._calls.find((c: any) => c.method === 'scale');
    expect(scaleCall).toBeDefined();
    expect(scaleCall.args[0]).toBeCloseTo(expectedCtxScale, 5);
    expect(scaleCall.args[1]).toBeCloseTo(expectedCtxScale, 5);
  });

  it('templateQrScale=0.5 re-centres the QR code on a STORY_9_16 canvas', () => {
    const config: QRConfig = { ...baseNonSquareConfig, templateQrScale: 0.5 };
    const ctx = makeMockCtx();
    const modules = makeModules();

    const displayWidth = 1080;
    const displayHeight = 1920;
    drawWithTemplate(ctx, modules, config, null, null, displayWidth, displayHeight, modules.size);

    // qrSize = 1080 * 0.5 * 0.5 = 270
    const qrSize = displayWidth * 0.5 * 0.5;
    const expectedX = (displayWidth - qrSize) / 2;
    const expectedY = (displayHeight - qrSize) / 2;

    const translateCall = (ctx as any)._calls.find((c: any) => c.method === 'translate');
    expect(translateCall).toBeDefined();
    expect(translateCall.args[0]).toBeCloseTo(expectedX, 0);
    expect(translateCall.args[1]).toBeCloseTo(expectedY, 0);
  });

  it('templateQrScale=1.5 enlarges the QR bounding box relative to default', () => {
    const defaultConfig: QRConfig = { ...baseNonSquareConfig, templateQrScale: 1.0 };
    const largeConfig: QRConfig = { ...baseNonSquareConfig, templateQrScale: 1.5 };

    const displayWidth = 1080;
    const ctxDefault = makeMockCtx();
    const ctxLarge = makeMockCtx();
    const modules = makeModules();

    drawWithTemplate(ctxDefault, modules, defaultConfig, null, null, displayWidth, 1920, modules.size);
    drawWithTemplate(ctxLarge, modules, largeConfig, null, null, displayWidth, 1920, modules.size);

    const scaleDefault = (ctxDefault as any)._calls.find((c: any) => c.method === 'scale');
    const scaleLarge = (ctxLarge as any)._calls.find((c: any) => c.method === 'scale');

    expect(scaleLarge.args[0]).toBeGreaterThan(scaleDefault.args[0]);
  });

  it('clamps templateQrScale below 0.5 to 0.5', () => {
    const config: QRConfig = { ...baseNonSquareConfig, templateQrScale: 0.1 };
    const ctx = makeMockCtx();
    const modules = makeModules();

    const displayWidth = 1080;
    drawWithTemplate(ctx, modules, config, null, null, displayWidth, 1920, modules.size);

    // Clamped to 0.5 → qrSize = displayWidth * 0.5 * 0.5 = 270
    const expectedCtxScale = (displayWidth * 0.5 * 0.5) / displayWidth;
    const scaleCall = (ctx as any)._calls.find((c: any) => c.method === 'scale');
    expect(scaleCall.args[0]).toBeCloseTo(expectedCtxScale, 5);
  });

  it('clamps templateQrScale above 1.5 to 1.5', () => {
    const config: QRConfig = { ...baseNonSquareConfig, templateQrScale: 3.0 };
    const ctx = makeMockCtx();
    const modules = makeModules();

    const displayWidth = 1080;
    drawWithTemplate(ctx, modules, config, null, null, displayWidth, 1920, modules.size);

    // Clamped to 1.5 → qrSize = displayWidth * 0.5 * 1.5 = 810
    const expectedCtxScale = (displayWidth * 0.5 * 1.5) / displayWidth;
    const scaleCall = (ctx as any)._calls.find((c: any) => c.method === 'scale');
    expect(scaleCall.args[0]).toBeCloseTo(expectedCtxScale, 5);
  });

  it('undefined templateQrScale defaults to 1.0 (no change in bounding box)', () => {
    const config: QRConfig = { ...baseNonSquareConfig };
    delete (config as Partial<QRConfig>).templateQrScale;
    const ctx = makeMockCtx();
    const modules = makeModules();

    const displayWidth = 1080;
    drawWithTemplate(ctx, modules, config, null, null, displayWidth, 1920, modules.size);

    // Default 1.0 → qrSize = displayWidth * 0.5 * 1.0 = 540
    const expectedCtxScale = (displayWidth * 0.5) / displayWidth; // 0.5
    const scaleCall = (ctx as any)._calls.find((c: any) => c.method === 'scale');
    expect(scaleCall.args[0]).toBeCloseTo(expectedCtxScale, 5);
  });
});

// ---------------------------------------------------------------------------
// Color resolution – templateBgColor / templateTextColor
// ---------------------------------------------------------------------------

describe('drawWithTemplate – color resolution', () => {
  beforeEach(() => {
    vi.spyOn(qrMatrix, 'drawQRInternal').mockImplementation(vi.fn());
  });

  it('uses templateBgColor as background when explicitly set', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      socialFormat: SocialFormat.STORY_9_16,
      templateStyle: TemplateStyle.MINIMALIST,
      bgColor: '#ffffff',
      templateBgColor: '#1a1a2e',
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    drawWithTemplate(ctx, modules, config, null, null, 1080, 1920, modules.size);

    // templateBgColor should appear in the fillStyle history for the background fill
    expect((ctx as any)._fillStyleHistory).toContain('#1a1a2e');
    // The QR's own bgColor is used for the safe-zone (not the template bg)
    expect((ctx as any)._fillStyleHistory).toContain('#ffffff');
  });

  it('falls back to bgColor when templateBgColor is undefined', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      socialFormat: SocialFormat.STORY_9_16,
      templateStyle: TemplateStyle.MINIMALIST,
      bgColor: '#f0f0f0',
      templateBgColor: undefined,
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    // Should not throw and fillRect should be called
    expect(() =>
      drawWithTemplate(ctx, modules, config, null, null, 1080, 1920, modules.size)
    ).not.toThrow();
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('falls back to fgColor when templateTextColor is undefined', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      socialFormat: SocialFormat.STORY_9_16,
      templateStyle: TemplateStyle.MINIMALIST,
      fgColor: '#333333',
      templateTextColor: undefined,
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    expect(() =>
      drawWithTemplate(ctx, modules, config, null, null, 1080, 1920, modules.size)
    ).not.toThrow();
  });

  it('uses templateTextColor as stroke/text color when explicitly set', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      socialFormat: SocialFormat.STORY_9_16,
      templateStyle: TemplateStyle.MINIMALIST,
      fgColor: '#000000',
      templateTextColor: '#ff6600',
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    drawWithTemplate(ctx, modules, config, null, null, 1080, 1920, modules.size);

    // strokeStyle should have been set to templateTextColor at some point (Minimalist frame)
    expect((ctx as any)._strokeStyleHistory).toContain('#ff6600');
  });
});

// ---------------------------------------------------------------------------
// SVG Export Precision Tests
// ---------------------------------------------------------------------------

describe('drawWithTemplate - Standard SVG Export Precision', () => {
  it('validates that standard SVG structures maintain aligned, non-overlapping cell coordinates when isVirtual is true', () => {
    const svgWidth = 1080;
    const svgHeight = 1080;
    const ctx = new SvgContext(svgWidth, svgHeight);

    const size = 21;
    const modules = {
      size,
      get: (_r: number, _c: number) => true,
    };

    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      style: QRStyle.STANDARD,
      templateStyle: TemplateStyle.NONE,
      socialFormat: SocialFormat.SQUARE_1_1,
    };

    drawWithTemplate(
      ctx as unknown as CanvasRenderingContext2D,
      modules,
      config,
      null,
      null,
      svgWidth,
      svgHeight,
      size,
      true // isVirtual
    );

    const svgString = ctx.serialize();
    expect(svgString).toContain('<svg');

    const rectCalls: Array<{ x: number; y: number; w: number; h: number }> = [];
    const testCtx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      rect: vi.fn((x, y, w, h) => {
        rectCalls.push({ x, y, w, h });
      }),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    drawWithTemplate(
      testCtx,
      modules,
      config,
      null,
      null,
      svgWidth,
      svgHeight,
      size,
      true // isVirtual
    );

    // Sort the rect calls by y and then by x
    rectCalls.sort((a, b) => a.y - b.y || a.x - b.x);

    // Group rects by row (same y)
    const rows: Record<number, Array<{ x: number; y: number; w: number; h: number }>> = {};
    for (const rect of rectCalls) {
      if (!rows[rect.y]) {
        rows[rect.y] = [];
      }
      rows[rect.y].push(rect);
    }

    // Verify that within each row, adjacent cells align perfectly without any overlapping width
    for (const yStr of Object.keys(rows)) {
      const rowRects = rows[Number(yStr)];
      rowRects.sort((a, b) => a.x - b.x);
      for (let i = 0; i < rowRects.length - 1; i++) {
        const current = rowRects[i];
        const next = rowRects[i + 1];
        // If they are adjacent modules, their boundaries must align exactly.
        expect(next.x).toBeGreaterThanOrEqual(current.x + current.w);
      }
    }
  });

  it('verifies that screen-based rendering (isVirtual = false) uses floor/ceil workarounds to avoid subpixel gaps on raster canvases', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      style: QRStyle.STANDARD,
      templateStyle: TemplateStyle.NONE,
      socialFormat: SocialFormat.SQUARE_1_1,
    };

    const size = 21;
    const modules = {
      size,
      get: (_r: number, _c: number) => true,
    };

    const rectCalls: Array<{ x: number; y: number; w: number; h: number }> = [];
    const testCtx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      rect: vi.fn((x, y, w, h) => {
        rectCalls.push({ x, y, w, h });
      }),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    drawWithTemplate(
      testCtx,
      modules,
      config,
      null,
      null,
      1080,
      1080,
      size,
      false // isVirtual = false
    );

    const { cellSize } = calculateLayout(config, 1080, size);
    const ceilCellSize = Math.ceil(cellSize);
    for (const rect of rectCalls) {
      expect(rect.w).toBe(ceilCellSize);
      expect(rect.h).toBe(ceilCellSize);
    }
  });
});

describe('drawWithTemplate – transparent background', () => {
  beforeEach(() => {
    vi.spyOn(qrMatrix, 'drawQRInternal').mockImplementation(vi.fn());
  });

  it('skips background fillRect when bgColor is transparent for TemplateStyle.NONE', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      bgColor: 'transparent',
      templateStyle: TemplateStyle.NONE,
      socialFormat: SocialFormat.SQUARE_1_1,
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    drawWithTemplate(ctx, modules, config, null, null, 1080, 1080, modules.size);

    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('preserves safe white backing rectangle on non-NONE templates when bgColor is transparent', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      bgColor: 'transparent',
      templateStyle: TemplateStyle.MINIMALIST,
      socialFormat: SocialFormat.STORY_9_16,
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    drawWithTemplate(ctx, modules, config, null, null, 1080, 1920, modules.size);

    // Safe zone rounded rect should be filled with #ffffff
    expect(ctx._fillStyleHistory).toContain('#ffffff');
  });
});

describe('drawWithTemplate – TemplateStyle.WIFI_CARD', () => {
  beforeEach(() => {
    vi.spyOn(qrMatrix, 'drawQRInternal').mockImplementation(vi.fn());
  });

  it('renders Wi-Fi card with hydrated SSID and password', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      type: QRType.WIFI,
      value: 'WIFI:S:CafeGuest;P:secret123;T:WPA;;',
      templateStyle: TemplateStyle.WIFI_CARD,
      socialFormat: SocialFormat.PORTRAIT_4_5,
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    drawWithTemplate(ctx, modules, config, null, null, 1080, 1350, modules.size);

    const filledTexts = getFilledTexts(ctx);
    expect(filledTexts).toContain('Connect to Wi-Fi');
    expect(filledTexts).toContain('NETWORK');
    expect(filledTexts).toContain('CafeGuest');
    expect(filledTexts).toContain('PASSWORD');
    expect(filledTexts).toContain('secret123');
  });

  it('displays "No password needed" for open NOPASS Wi-Fi networks', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      type: QRType.WIFI,
      value: 'WIFI:S:FreeCafe;P:;T:nopass;;',
      templateStyle: TemplateStyle.WIFI_CARD,
      socialFormat: SocialFormat.SQUARE_1_1,
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    drawWithTemplate(ctx, modules, config, null, null, 1080, 1080, modules.size);

    const filledTexts = getFilledTexts(ctx);
    expect(filledTexts).toContain('FreeCafe');
    expect(filledTexts).toContain('No password needed');
  });

  it('draws no "Connect to Wi-Fi" text and draws headline exactly once for URL-type config with WIFI_CARD', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      type: QRType.URL,
      value: 'https://qrcraftly.com',
      templateStyle: TemplateStyle.WIFI_CARD,
      templateHeadline: 'Welcome to Our Cafe',
      templateSubtext: 'Table 5 Menu',
      socialFormat: SocialFormat.SQUARE_1_1,
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    drawWithTemplate(ctx, modules, config, null, null, 1080, 1080, modules.size);

    const filledTexts = getFilledTexts(ctx);
    expect(filledTexts).not.toContain('Connect to Wi-Fi');
    expect(filledTexts).not.toContain('NETWORK');
    expect(filledTexts.filter((text) => text === 'Welcome to Our Cafe')).toHaveLength(1);
    expect(filledTexts).toContain('Table 5 Menu');
  });

  it('does not say "No password needed" for WPA2_EAP enterprise networks with no password', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      type: QRType.WIFI,
      value: 'WIFI:S:CorpNet;T:WPA2-EAP;E:PEAP;I:user@corp;;',
      templateStyle: TemplateStyle.WIFI_CARD,
      socialFormat: SocialFormat.SQUARE_1_1,
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    drawWithTemplate(ctx, modules, config, null, null, 1080, 1080, modules.size);

    const filledTexts = getFilledTexts(ctx);
    expect(filledTexts).not.toContain('No password needed');
    expect(filledTexts).toContain('SIGN-IN');
    expect(filledTexts).toContain('Sign in with your network account');
  });

  it('draws a 63-character password at a smaller font size than an 8-character one', () => {
    const shortConfig: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      type: QRType.WIFI,
      value: 'WIFI:S:MyNet;P:12345678;T:WPA;;',
      templateStyle: TemplateStyle.WIFI_CARD,
      socialFormat: SocialFormat.SQUARE_1_1,
    };
    const longConfig: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      type: QRType.WIFI,
      value: 'WIFI:S:MyNet;P:123456789012345678901234567890123456789012345678901234567890123;T:WPA;;',
      templateStyle: TemplateStyle.WIFI_CARD,
      socialFormat: SocialFormat.SQUARE_1_1,
    };

    const shortCtx = makeMockCtx();
    const longCtx = makeMockCtx();
    const modules = makeModules();

    drawWithTemplate(shortCtx, modules, shortConfig, null, null, 1080, 1080, modules.size);
    drawWithTemplate(longCtx, modules, longConfig, null, null, 1080, 1080, modules.size);

    const shortCall = shortCtx._filledCalls.find((c) => c.text === '12345678');
    const longCall = longCtx._filledCalls.find((c) => c.text.startsWith('1234567890'));

    expect(shortCall).toBeDefined();
    expect(longCall).toBeDefined();

    const shortFontSize = parseFloat(shortCall!.font.match(/(\d+(?:\.\d+)?)px/)![1]);
    const longFontSize = parseFloat(longCall!.font.match(/(\d+(?:\.\d+)?)px/)![1]);

    expect(longFontSize).toBeLessThan(shortFontSize);
  });

  it('displays an escaped SSID unescaped on the card', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      type: QRType.WIFI,
      value: 'WIFI:S:Cafe\\;Guest;P:pass123;T:WPA;;',
      templateStyle: TemplateStyle.WIFI_CARD,
      socialFormat: SocialFormat.SQUARE_1_1,
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    drawWithTemplate(ctx, modules, config, null, null, 1080, 1080, modules.size);

    const filledTexts = getFilledTexts(ctx);
    expect(filledTexts).toContain('Cafe;Guest');
    expect(filledTexts).not.toContain('Cafe\\;Guest');
  });

  it('correctly serializes Wi-Fi card elements via SvgContext for vector SVG export', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      type: QRType.WIFI,
      value: 'WIFI:S:HotelGuest;P:stay1234;T:WPA;;',
      templateStyle: TemplateStyle.WIFI_CARD,
      socialFormat: SocialFormat.SQUARE_1_1,
    };
    const svgCtx = new SvgContext(1080, 1080);
    const modules = makeModules();

    drawWithTemplate(svgCtx as unknown as CanvasRenderingContext2D, modules, config, null, null, 1080, 1080, modules.size);

    const svgXml = svgCtx.serialize();
    expect(svgXml).toContain('Connect to Wi-Fi');
    expect(svgXml).toContain('NETWORK');
    expect(svgXml).toContain('HotelGuest');
    expect(svgXml).toContain('PASSWORD');
    expect(svgXml).toContain('stay1234');
  });

  it('keeps bottom of second badge at or below displayHeight - displayWidth * 0.025 on SQUARE_1_1 with templateQrScale 1.5', () => {
    const drawRoundRectSpy = vi.spyOn(qrMatrixCanvas, 'drawRoundRect');

    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      type: QRType.WIFI,
      value: 'WIFI:S:MyNet;P:secret123;T:WPA;;',
      templateStyle: TemplateStyle.WIFI_CARD,
      socialFormat: SocialFormat.SQUARE_1_1,
      templateQrScale: 1.5,
    };
    const ctx = makeMockCtx();
    const modules = makeModules();

    drawWithTemplate(ctx, modules, config, null, null, 1080, 1080, modules.size);

    // The last drawRoundRect call in drawWifiCardChrome is for badge2
    expect(drawRoundRectSpy).toHaveBeenCalled();
    const roundRectCalls = drawRoundRectSpy.mock.calls;
    // Badge 2 is the last drawRoundRect call
    const badge2Call = roundRectCalls[roundRectCalls.length - 1];
    const badge2Y = badge2Call[2];
    const badge2H = badge2Call[4];
    const badge2Bottom = badge2Y + badge2H;

    const maxAllowedBottom = 1080 - 1080 * 0.025; // 1053px
    expect(badge2Bottom).toBeLessThanOrEqual(maxAllowedBottom);

    drawRoundRectSpy.mockRestore();
  });
});

