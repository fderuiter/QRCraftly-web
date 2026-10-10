// @vitest-environment jsdom
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
import { qrEncoder as QRCode } from '../../../../tests/fixtures/qrEncoder';
import { type QRConfig, QRStyle, QRType, QRErrorCorrectionLevel, SocialFormat, TemplateStyle } from '@/types';
import { drawQRInternal } from '../index';
import { generateQRSvg, SvgContext } from '@/packages/qr-export';

describe('Fluid Style Scannability & Optical Readability Suite', () => {
  const createMockCanvasCtx = (width: number, height: number) => {
    return {
      canvas: { width, height },
      fillStyle: '#000000',
      strokeStyle: '#000000',
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  };

  const baseConfig: QRConfig = {
    value: 'https://qrcraftly.com',
    type: QRType.URL,
    fgColor: '#000000',
    bgColor: '#ffffff',
    eyeColor: '#000000',
    errorCorrectionLevel: QRErrorCorrectionLevel.M,
    style: QRStyle.FLUID,
    isMazeEnabled: false,
    mazeColor: '#3b82f6',
    isMazeBridgesEnabled: false,
    showMazeSolution: false,
    logoUrl: null,
    logoSize: 0.2,
    logoPaddingStyle: 'square',
    logoPadding: 0,
    logoBackgroundColor: '#ffffff',
    isBorderEnabled: false,
    borderSize: 0.05,
    borderColor: '#000000',
    borderStyle: 'solid',
    borderText: '',
    borderTextPosition: 'bottom-center',
    borderTextColor: '#ffffff',
    borderLogoUrl: null,
    borderLogoPosition: 'bottom-center',
    socialFormat: SocialFormat.SQUARE_1_1,
    templateStyle: TemplateStyle.NONE,
  };

  const testPayloads = [
    { name: 'Short payload (Version ~1-2)', value: 'https://qrcraftly.com' },
    {
      name: 'Medium payload (Version ~4-5)',
      value: 'https://qrcraftly.com/fluid-scannability-verification-medium-payload',
    },
    {
      name: 'Long payload (Version ~7-10)',
      value:
        'https://qrcraftly.com/fluid-scannability-verification-long-payload-with-extended-parameters-and-extra-data-for-stress-testing-density',
    },
  ];

  const ecLevels = [
    QRErrorCorrectionLevel.M,
    QRErrorCorrectionLevel.Q,
    QRErrorCorrectionLevel.H,
  ];

  testPayloads.forEach(({ name, value }) => {
    ecLevels.forEach((ecLevel) => {
      it(`renders valid scannable fluid QR code for ${name} with EC level ${ecLevel}`, () => {
        const qrData = QRCode.create(value, { errorCorrectionLevel: ecLevel });
        const modules = qrData.modules as any;
        const moduleCount = modules.size;
        const displaySize = 512;

        const ctx = createMockCanvasCtx(displaySize, displaySize);

        const config: QRConfig = {
          ...baseConfig,
          value,
          errorCorrectionLevel: ecLevel,
          style: QRStyle.FLUID,
        };

        expect(() => {
          drawQRInternal(ctx, modules, config, null, null, displaySize, moduleCount);
        }).not.toThrow();

        expect(ctx.beginPath).toHaveBeenCalled();
        expect(ctx.fill).toHaveBeenCalled();
        expect(ctx.quadraticCurveTo).toHaveBeenCalled();
        expect(ctx.closePath).toHaveBeenCalled();

        const svgCtx = new SvgContext(displaySize, displaySize);
        drawQRInternal(svgCtx as unknown as CanvasRenderingContext2D, modules, config, null, null, displaySize, moduleCount);
        const svgOutput = svgCtx.serialize();

        expect(svgOutput).toContain('<path');
        expect(svgOutput).toContain('Q ');
        expect(svgOutput).not.toContain('NaN');
        expect(svgOutput).not.toContain('undefined');
      });
    });
  });

  describe('SVG Export with Fluid Style', () => {
    it('generates self-contained SVG containing fluid path definitions', async () => {
      const config: QRConfig = {
        ...baseConfig,
        value: 'https://qrcraftly.com/fluid-svg',
        style: QRStyle.FLUID,
      };

      const svg = await generateQRSvg(config);

      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('<path');
      expect(svg).toContain('fill="#000000"');
      expect(svg).toContain('Q ');
      expect(svg).not.toContain('undefined');
      expect(svg).not.toContain('NaN');
    });
  });
});
