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
 * Eye shapes chosen apart from the pattern (#1465). Every frame and ball shape is drawn into a
 * software canvas and decoded with our own decoder, at small and large sizes, on top of patterns
 * whose own eyes differ, and with a transparent background.
 */

import { describe, it, expect } from 'vitest';
import { qrEncoder as QRCode } from '../../../../tests/fixtures/qrEncoder';
import { qrReader } from '../../../../tests/fixtures/qrReader';
import { DEFAULT_CONFIG } from '@/constants';
import { EyeShape, type QRConfig, QRErrorCorrectionLevel, QRStyle } from '@/types';
import { calculateScannabilityHealth } from '@/packages/scannability';
import { performScannabilityCheck } from '@/packages/scannability/checker';
import { drawQRInternal, clearFluidCache } from '../index';
import { RasterContext, toContext } from './rasterContext';

const SHORT = 'https://example.com';
const LONG = 'https://qrcraftly.com/a/much/longer/path?with=query&and=more-0123456789abcdef';

const baseConfig: QRConfig = {
  ...DEFAULT_CONFIG,
  value: SHORT,
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

const render = (overrides: Partial<QRConfig>, size = 480) => {
  const config: QRConfig = { ...baseConfig, ...overrides };
  const qr = QRCode.create(config.value, { errorCorrectionLevel: config.errorCorrectionLevel });
  const raster = new RasterContext(size, size);
  clearFluidCache();
  drawQRInternal(toContext(raster), qr.modules, config, null, null, size, qr.modules.size);
  return { raster, decoded: qrReader.read(raster.data, size, size)[0]?.text };
};

const SHAPES = Object.values(EyeShape);

describe('every eye shape decodes (#1465)', () => {
  for (const frame of SHAPES) {
    for (const ball of SHAPES) {
      it(`decodes a ${frame} frame with a ${ball} ball`, () => {
        expect(render({ eyeFrameShape: frame, eyeBallShape: ball }).decoded).toBe(SHORT);
      });
    }
  }

  for (const shape of SHAPES) {
    for (const { value, size } of [
      { value: SHORT, size: 160 },
      { value: LONG, size: 240 },
      { value: LONG, size: 1000 },
    ]) {
      it(`decodes ${shape} eyes for ${value.length} characters at ${size} px`, () => {
        expect(render({ value, eyeFrameShape: shape, eyeBallShape: shape }, size).decoded).toBe(value);
      });
    }

    it(`decodes ${shape} eyes on a transparent background`, () => {
      expect(render({ bgColor: 'transparent', eyeFrameShape: shape, eyeBallShape: shape }).decoded).toBe(SHORT);
    });

    for (const style of [QRStyle.SWISS, QRStyle.FLUID, QRStyle.HIVE]) {
      it(`decodes ${shape} eyes over the ${style} pattern`, () => {
        expect(render({ style, eyeFrameShape: shape, eyeBallShape: shape }).decoded).toBe(SHORT);
      });
    }
  }
});

describe('the scannability check covers every eye shape (#1465)', () => {
  for (const shape of SHAPES) {
    for (const size of [300, 480]) {
      it(`passes the print simulation with ${shape} eyes at ${size} px`, () => {
        const { raster } = render({ value: LONG, eyeFrameShape: shape, eyeBallShape: shape }, size);
        const result = performScannabilityCheck(qrReader, { data: raster.data, width: size, height: size }, size, size);
        expect(result.success).toBe(true);
        expect(result.physicalReady).toBe(true);
      });
    }

    it(`scores ${shape} eyes like the pattern's own eyes`, () => {
      const shaped = calculateScannabilityHealth({ ...baseConfig, eyeFrameShape: shape, eyeBallShape: shape });
      expect(shaped).toEqual(calculateScannabilityHealth(baseConfig));
    });
  }
});

describe('a config without eye shapes draws its pattern eyes (#1465)', () => {
  for (const style of Object.values(QRStyle)) {
    it(`draws the same ${style} pixels whether the shape fields are absent or unset`, () => {
      const absent = render({ style });
      const unset = render({ style, eyeFrameShape: undefined, eyeBallShape: undefined });
      expect(Buffer.from(unset.raster.data).equals(Buffer.from(absent.raster.data))).toBe(true);
    });
  }

  it('changes the pixels when a shape is chosen', () => {
    const pattern = render({ style: QRStyle.STANDARD });
    const circle = render({ style: QRStyle.STANDARD, eyeFrameShape: EyeShape.CIRCLE });
    expect(Buffer.from(circle.raster.data).equals(Buffer.from(pattern.raster.data))).toBe(false);
  });

  it('shapes the frame and the ball separately', () => {
    const frameOnly = render({ eyeFrameShape: EyeShape.CIRCLE });
    const ballOnly = render({ eyeBallShape: EyeShape.CIRCLE });
    expect(Buffer.from(frameOnly.raster.data).equals(Buffer.from(ballOnly.raster.data))).toBe(false);
  });
});
