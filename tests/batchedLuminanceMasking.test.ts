// @vitest-environment jsdom
/*
    QRCraftly - Module-Group Batched Luminance Masking Test Suite
*/

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderModules, sampleCellLuminances, type ModuleRenderOptions } from '@/packages/qr-matrix';
import { drawQRInternal } from '../src/utils/qrRenderer';
import { auditModuleContrast } from '@/packages/scannability';
import { generateQRSvg } from '@/packages/qr-export';
import { type QRConfig, QRStyle, QRType, QRErrorCorrectionLevel, SocialFormat, TemplateStyle } from '../src/types';

describe('Module-Group Batched Luminance Masking Suite', () => {
  const moduleCount = 21;

  const createMockCtx = () => {
    const fillStyles: string[] = [];
    return {
      beginPath: vi.fn(),
      rect: vi.fn(),
      fillRect: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn().mockImplementation(function (this: any) {
        fillStyles.push(this.fillStyle);
      }),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      fillStyle: '#000000',
      get fillStyleHistory() {
        return fillStyles;
      },
    } as unknown as CanvasRenderingContext2D & { fillStyleHistory: string[] };
  };

  const createMockModules = (size: number = 21) => {
    return {
      size,
      get: (r: number, c: number) => {
        // Activate a 10x10 block of modules in the center
        return r >= 5 && r < 15 && c >= 5 && c < 15;
      },
    };
  };

  const baseConfig: QRConfig = {
    value: 'https://qrcraftly.com',
    type: QRType.URL,
    fgColor: '#000000',
    bgColor: '#ffffff',
    style: QRStyle.STANDARD,
    logoUrl: null,
    logoSize: 0.2,
    logoPaddingStyle: 'square',
    logoPadding: 1,
    logoBackgroundColor: '#ffffff',
    eyeColor: '#000000',
    errorCorrectionLevel: QRErrorCorrectionLevel.M,
    isBorderEnabled: false,
    borderSize: 0,
    borderColor: '#000000',
    borderStyle: 'solid',
    borderText: '',
    borderTextPosition: 'bottom-center',
    borderTextColor: '#000000',
    borderLogoUrl: null,
    borderLogoPosition: 'bottom-center',
    socialFormat: SocialFormat.SQUARE_1_1,
    templateStyle: TemplateStyle.NONE,
  };

  const mockLogoMetrics = {
    logoSizePx: 0,
    logoPaddingPx: 0,
    cutoutModuleSize: 0,
    effectiveLogoSizeModules: 0,
    effectivePaddingModules: 0,
  };

  it('Requirement 1 & AC 1: samples matrix cell relative luminance and categorizes modules into light and dark contrast groups', () => {
    // Create a 210x210 image data split into dark left half (r, g, b = 10, 10, 10) and bright right half (r, g, b = 245, 245, 245)
    const imgWidth = 210;
    const imgHeight = 210;
    const data = new Uint8ClampedArray(imgWidth * imgHeight * 4);

    for (let y = 0; y < imgHeight; y++) {
      for (let x = 0; x < imgWidth; x++) {
        const idx = (y * imgWidth + x) * 4;
        const isLeft = x < imgWidth / 2;
        const val = isLeft ? 10 : 245;
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 255;
      }
    }

    const bgImageData = { data, width: imgWidth, height: imgHeight };
    const cellSize = imgWidth / moduleCount;

    const sampledLuminances = sampleCellLuminances(bgImageData, moduleCount, 0, 0, cellSize);
    expect(sampledLuminances.length).toBe(moduleCount * moduleCount);

    // Left cells (col < 10) should have low relative luminance (~0.003)
    const leftCellLum = sampledLuminances[5 * moduleCount + 2];
    expect(leftCellLum).toBeLessThan(0.1);

    // Right cells (col >= 11) should have high relative luminance (~0.91)
    const rightCellLum = sampledLuminances[5 * moduleCount + 18];
    expect(rightCellLum).toBeGreaterThan(0.8);
  });

  it('Requirement 3 & AC 2: canvas rendering executes exactly two combined module path fills per render frame', () => {
    const ctx = createMockCtx();
    const modules = createMockModules(21);

    // Supply cell luminances with a mix of dark and bright cells
    const cellLuminance = new Float64Array(21 * 21);
    for (let r = 0; r < 21; r++) {
      for (let c = 0; c < 21; c++) {
        cellLuminance[r * 21 + c] = c < 10 ? 0.05 : 0.95;
      }
    }

    const options: ModuleRenderOptions = {
      cellLuminance,
      fgColorDark: '#000000',
      fgColorLight: '#ffffff',
      luminanceThreshold: 0.25,
    };

    renderModules(ctx, modules as any, baseConfig, 0, 0, 10, 21, mockLogoMetrics, false, options);

    // Fill should be called exactly twice: once for Group 0 (dark fg) and once for Group 1 (light fg)
    expect(ctx.fill).toHaveBeenCalledTimes(2);
    expect((ctx as any).fillStyleHistory).toEqual(['#000000', '#ffffff']);
  });

  it('Requirement 2 & AC 3: QR codes over photo backgrounds pass automated contrast audit with min 3:1 ratio', () => {
    class CanvasPixelBufferCtx {
      public width: number;
      public height: number;
      public data: Uint8ClampedArray;
      public fillStyle: string = '#000000';
      private currentPath: Array<{ x: number; y: number; w: number; h: number }> = [];

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(width * height * 4);
      }

      getImageData() {
        return { data: this.data, width: this.width, height: this.height };
      }

      fillRect(x: number, y: number, w: number, h: number) {
        this.fillRectangle(x, y, w, h, this.fillStyle);
      }

      beginPath() {
        this.currentPath = [];
      }

      rect(x: number, y: number, w: number, h: number) {
        this.currentPath.push({ x, y, w, h });
      }

      fill() {
        for (const cmd of this.currentPath) {
          this.fillRectangle(cmd.x, cmd.y, cmd.w, cmd.h, this.fillStyle);
        }
      }

      private fillRectangle(x: number, y: number, w: number, h: number, colorHex: string) {
        let hex = colorHex;
        if (hex.length === 4) {
          hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }
        const rNorm = parseInt(hex.slice(1, 3), 16) || 0;
        const gNorm = parseInt(hex.slice(3, 5), 16) || 0;
        const bNorm = parseInt(hex.slice(5, 7), 16) || 0;

        const x0 = Math.max(0, Math.floor(x));
        const y0 = Math.max(0, Math.floor(y));
        const x1 = Math.min(this.width, Math.ceil(x + w));
        const y1 = Math.min(this.height, Math.ceil(y + h));

        for (let py = y0; py < y1; py++) {
          for (let px = x0; px < x1; px++) {
            const idx = (py * this.width + px) * 4;
            this.data[idx] = rNorm;
            this.data[idx + 1] = gNorm;
            this.data[idx + 2] = bNorm;
            this.data[idx + 3] = 255;
          }
        }
      }
    }

    const width = 210;
    const height = 210;
    const bgCtx = new CanvasPixelBufferCtx(width, height);

    // Draw photo background: left dark (#101010, cols 0-9), right bright (#f0f0f0, cols 10-20)
    bgCtx.fillStyle = '#101010';
    bgCtx.fillRect(0, 0, 100, height);
    bgCtx.fillStyle = '#f0f0f0';
    bgCtx.fillRect(100, 0, width - 100, height);

    const bgImageData = bgCtx.getImageData();
    const modules = createMockModules(21);

    drawQRInternal(
      bgCtx as unknown as CanvasRenderingContext2D,
      modules as any,
      { ...baseConfig, isLuminanceMaskingEnabled: true },
      null,
      null,
      width,
      21,
      false,
      null,
      { bgImageData, luminanceThreshold: 0.25 }
    );

    const audit = auditModuleContrast(bgCtx.getImageData(), 21, 4);

    expect(audit.violations).toBe(0);
    expect(audit.minContrast).toBeGreaterThanOrEqual(3.0);
  });

  it('Requirement 4 & AC 4: live canvas updates complete within 16.6ms during interactive configuration adjustments', () => {
    const ctx = createMockCtx();
    const modules = createMockModules(21);
    const cellLuminance = new Float64Array(21 * 21).map((_, i) => (i % 2 === 0 ? 0.1 : 0.9));

    const iterations = 50;
    const startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      drawQRInternal(
        ctx,
        modules as any,
        { ...baseConfig, fgColor: i % 2 === 0 ? '#111111' : '#222222', isLuminanceMaskingEnabled: true },
        null,
        null,
        512,
        21,
        false,
        null,
        { cellLuminance, luminanceThreshold: 0.25 }
      );
    }

    const totalDuration = performance.now() - startTime;
    const avgRenderTime = totalDuration / iterations;

    expect(avgRenderTime).toBeLessThan(16.6);
  });

  it('AC 5: exported SVG files preserve distinct module color paths without relying on pixel blend modes', async () => {
    const config: QRConfig = {
      ...baseConfig,
      isLuminanceMaskingEnabled: true,
      fgColorDark: '#010101',
      fgColorLight: '#fefefe',
    };

    const cellLuminance = new Float64Array(21 * 21);
    for (let i = 0; i < 21 * 21; i++) {
      cellLuminance[i] = i % 2 === 0 ? 0.05 : 0.95;
    }

    const svgString = await generateQRSvg(config, {
      renderOptions: {
        cellLuminance,
        fgColorDark: '#010101',
        fgColorLight: '#fefefe',
        luminanceThreshold: 0.25,
      },
    });

    // Verify SVG XML structure contains native path elements with contrast group fill attributes
    expect(svgString).toContain('fill="#010101"');
    expect(svgString).toContain('fill="#fefefe"');

    // Verify no pixel-level composite operations or CSS blend modes are used
    expect(svgString).not.toContain('mix-blend-mode');
    expect(svgString).not.toContain('feBlend');
  });
});
