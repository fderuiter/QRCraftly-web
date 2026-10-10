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


/**
 * Real pixel round-trips for the frame, border and transparent-background paths of the
 * renderer (#1249, #1360, #1361): each case is drawn into a software canvas and decoded with our
 * own decoder, and the frame or badge must still be visible on top of the background.
 */

import { describe, it, expect } from 'vitest';
import { qrEncoder as QRCode } from '../../../../tests/fixtures/qrEncoder';
import { qrReader } from '../../../../tests/fixtures/qrReader';
import { DEFAULT_CONFIG } from '@/constants';
import { type QRConfig, QRStyle, QRErrorCorrectionLevel } from '@/types';
import { drawQRInternal, calculateLayout, clearFluidCache } from '../index';
import { RasterContext, toContext } from './rasterContext';

const VALUE = 'https://example.com';
const SIZE = 480;
const FRAME_GREEN: [number, number, number] = [0x10, 0xb9, 0x81];

const baseConfig: QRConfig = {
  ...(DEFAULT_CONFIG as QRConfig),
  value: VALUE,
  fgColor: '#000000',
  bgColor: '#ffffff',
  eyeColor: '#000000',
  errorCorrectionLevel: QRErrorCorrectionLevel.M,
  style: QRStyle.STANDARD,
  gradientType: 'none',
  logoUrl: null,
  isBorderEnabled: false,
  frameStyle: 'none',
};

const render = (overrides: Partial<QRConfig>) => {
  const config: QRConfig = { ...baseConfig, ...overrides };
  const qr = QRCode.create(VALUE, { errorCorrectionLevel: config.errorCorrectionLevel });
  const modules = qr.modules as unknown as { size: number };
  const raster = new RasterContext(SIZE, SIZE);
  clearFluidCache();
  drawQRInternal(toContext(raster), modules as never, config, null, null, SIZE, modules.size);
  const layout = calculateLayout(config, SIZE, modules.size);
  return { raster, layout, decoded: qrReader.read(raster.data, SIZE, SIZE)[0]?.text };
};

describe('frame and CTA badge stay visible over the background (#1361)', () => {
  for (const position of ['bottom', 'top', 'left', 'right'] as const) {
    it(`draws a ${position} banner on top of the background and still decodes`, () => {
      const { raster, decoded } = render({
        frameStyle: 'banner',
        framePosition: position,
        frameText: 'SCAN ME',
        frameBgColor: '#10b981',
        frameTextColor: '#ffffff',
      });
      const edge = SIZE * 0.05;
      const point = {
        bottom: [SIZE / 2, SIZE - edge],
        top: [SIZE / 2, edge],
        left: [edge, SIZE / 2],
        right: [SIZE - edge, SIZE / 2],
      }[position];
      expect(raster.colorAt(point[0], point[1])).toEqual(FRAME_GREEN);
      expect(decoded).toBe(VALUE);
    });
  }

  it('keeps the card colour around the QR box and still decodes', () => {
    const { raster, decoded } = render({ frameStyle: 'card', frameBgColor: '#10b981', frameText: 'SCAN ME' });
    expect(raster.colorAt(SIZE / 2, SIZE * 0.95)).toEqual(FRAME_GREEN);
    expect(decoded).toBe(VALUE);
  });

  it('draws the border around the QR box only, leaving the banner visible', () => {
    const { raster, layout, decoded } = render({
      frameStyle: 'banner',
      framePosition: 'bottom',
      frameBgColor: '#10b981',
      isBorderEnabled: true,
      borderSize: 0.05,
      borderColor: '#1d4ed8',
    });
    expect(raster.colorAt(SIZE / 2, SIZE - SIZE * 0.05)).toEqual(FRAME_GREEN);
    expect(raster.colorAt(SIZE / 2, layout.drawY - layout.quietPx - layout.borderPx / 2)).toEqual([0x1d, 0x4e, 0xd8]);
    expect(decoded).toBe(VALUE);
  });
});

describe('transparent background keeps the code scannable (#1360)', () => {
  for (const style of [QRStyle.STANDARD, QRStyle.MODERN, QRStyle.SWISS, QRStyle.CIRCUIT, QRStyle.GRUNGE]) {
    it(`draws dark modules and see-through finder holes for ${style}`, () => {
      const { raster, layout, decoded } = render({ bgColor: 'transparent', style });
      const { drawX, drawY, cellSize } = layout;
      // Module (1, 1) lies in the light ring of the top-left finder: nothing may be painted there.
      expect(raster.colorAt(drawX + 1.5 * cellSize, drawY + 1.5 * cellSize)).toEqual([255, 255, 255]);
      expect(decoded).toBe(VALUE);
    });
  }

  it('keeps the card inner box light so the code does not sit on the card colour', () => {
    const { decoded } = render({ bgColor: 'transparent', frameStyle: 'card', frameBgColor: '#000000' });
    expect(decoded).toBe(VALUE);
  });
});

describe('the border never replaces the quiet zone (#1249)', () => {
  for (const borderStyle of ['solid', 'dashed', 'dotted', 'double'] as const) {
    for (const borderSize of [0.01, 0.05, 0.1, 0.15]) {
      it(`decodes the default design with a black ${borderStyle} border at ${borderSize}`, () => {
        const { raster, layout, decoded } = render({ isBorderEnabled: true, borderStyle, borderSize, borderColor: '#000000' });
        const { drawX, drawY, drawSize, quietPx, cellSize } = layout;
        expect(quietPx).toBeCloseTo(4 * cellSize, 9);
        // The middle of each side of the quiet zone is plain background.
        const mid = drawX + drawSize / 2;
        expect(raster.colorAt(mid, drawY - quietPx / 2)).toEqual([255, 255, 255]);
        expect(raster.colorAt(drawX - quietPx / 2, drawY + drawSize / 2)).toEqual([255, 255, 255]);
        expect(raster.colorAt(mid, drawY + drawSize + quietPx / 2)).toEqual([255, 255, 255]);
        expect(raster.colorAt(drawX + drawSize + quietPx / 2, drawY + drawSize / 2)).toEqual([255, 255, 255]);
        expect(decoded).toBe(VALUE);
      });
    }
  }
});

describe('a logo that failed to load leaves no hole (#1257)', () => {
  it('draws every module when logoUrl is set but there is no image', () => {
    const plain = render({});
    const withMissingLogo = render({ logoUrl: 'data:image/svg+xml;base64,AAAA', logoSize: 0.25 });
    const differing = withMissingLogo.raster.data.filter((value, i) => value !== plain.raster.data[i]).length;
    expect(differing).toBe(0);
    expect(withMissingLogo.decoded).toBe(VALUE);
  });
});

describe('every pattern reads with the default settings (#1278)', () => {
  for (const style of Object.values(QRStyle)) {
    it(`decodes ${style} at the default error correction`, () => {
      const { decoded } = render({ style, errorCorrectionLevel: DEFAULT_CONFIG.errorCorrectionLevel });
      expect(decoded).toBe(VALUE);
    });
  }
});

describe('Grunge draws the same picture every time (#1397)', () => {
  it('gives identical pixels for two renders of the same settings', () => {
    const first = render({ style: QRStyle.GRUNGE });
    const second = render({ style: QRStyle.GRUNGE });
    expect(Buffer.from(second.raster.data).equals(Buffer.from(first.raster.data))).toBe(true);
    expect(first.decoded).toBe(VALUE);
  });
});
