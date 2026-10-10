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

import { describe, it, expect } from 'vitest';
import {
  calculateLayout,
  getLogoMetrics,
  MIN_LOGO_BACKING_PADDING,
  getIsCoveredByLogo,
  getAlignmentPatternCenters,
  isAlignmentPatternZone,
  ALIGNMENT_PATTERN_COORDINATES,
} from '../index';
import { DEFAULT_CONFIG } from '@/constants';
import { type QRConfig, QRErrorCorrectionLevel } from '@/types';

describe('QR Renderer Utils', () => {
  describe('calculateLayout', () => {
    const expectLayout = (actual: ReturnType<typeof calculateLayout>, expected: ReturnType<typeof calculateLayout>) => {
      for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
        expect(actual[key], key).toBeCloseTo(expected[key], 9);
      }
    };

    it('calculates layout without border: a 4-module quiet zone on each side', () => {
      const config = { ...DEFAULT_CONFIG, isBorderEnabled: false };
      expectLayout(calculateLayout(config, 100, 25), {
        drawX: 400 / 33,
        drawY: 400 / 33,
        drawSize: 2500 / 33,
        cellSize: 100 / 33,
        borderPx: 0,
        quietPx: 400 / 33,
      });
    });

    it('puts the border band outside the quiet zone (#1249)', () => {
      const config = { ...DEFAULT_CONFIG, isBorderEnabled: true, borderSize: 0.1 };
      // 100 px = 2 x 10 px border + (20 + 8) modules of 80/28 px
      const cell = 80 / 28;
      expectLayout(calculateLayout(config, 100, 20), {
        drawX: 10 + 4 * cell,
        drawY: 10 + 4 * cell,
        drawSize: 20 * cell,
        cellSize: cell,
        borderPx: 10,
        quietPx: 4 * cell,
      });
    });

    it('keeps a full quiet zone however thick the border is', () => {
      const config = { ...DEFAULT_CONFIG, isBorderEnabled: true, borderSize: 0.3 };
      const result = calculateLayout(config, 100, 20);
      expect(result.borderPx).toBeCloseTo(30, 9);
      expect(result.quietPx).toBeCloseTo(4 * result.cellSize, 9);
      expect(result.drawX).toBeCloseTo(30 + 4 * result.cellSize, 9);
      expect(result.drawSize + 2 * (result.quietPx + result.borderPx)).toBeCloseTo(100, 9);
    });
  });

  describe('getLogoMetrics', () => {
    const cellSize = 10;
    const moduleCount = 21;

    it('calculates metrics for logo within safe limits', () => {
      const config: QRConfig = {
        ...DEFAULT_CONFIG,
        logoSize: 0.2,
        logoPadding: 0,
        logoPaddingStyle: 'none',
        errorCorrectionLevel: QRErrorCorrectionLevel.H
      };

      const metrics = getLogoMetrics(config, moduleCount, cellSize);

      expect(metrics.effectiveLogoSizeModules).toBeCloseTo(4.2);
      expect(metrics.logoSizePx).toBeCloseTo(42);
      expect(metrics.effectivePaddingModules).toBe(0);
    });

    it('scales down logo if it exceeds safe limit for Low error correction', () => {
      const config: QRConfig = {
        ...DEFAULT_CONFIG,
        logoSize: 0.3,
        logoPadding: 0,
        logoPaddingStyle: 'none',
        errorCorrectionLevel: QRErrorCorrectionLevel.L
      };

      const metrics = getLogoMetrics(config, moduleCount, cellSize);
      expect(metrics.effectiveLogoSizeModules).toBeCloseTo(4.62);
      expect(metrics.cutoutModuleSize).toBeCloseTo(4.62);
    });

    it('scales down logo considering padding', () => {
      const config: QRConfig = {
        ...DEFAULT_CONFIG,
        logoSize: 0.3,
        logoPadding: 1,
        logoPaddingStyle: 'square',
        errorCorrectionLevel: QRErrorCorrectionLevel.M
      };

      const metrics = getLogoMetrics(config, moduleCount, cellSize);
      expect(metrics.cutoutModuleSize).toBeCloseTo(7.35);
      expect(metrics.effectivePaddingModules).toBeLessThan(1);
    });

    it('keeps a visible gap for Square and Circle backings with a padding of 0 (#1355)', () => {
      for (const logoPaddingStyle of ['square', 'circle'] as const) {
        const zero = getLogoMetrics({ ...DEFAULT_CONFIG, logoUrl: 'logo', logoPadding: 0, logoPaddingStyle }, moduleCount, cellSize);
        const half = getLogoMetrics({ ...DEFAULT_CONFIG, logoUrl: 'logo', logoPadding: MIN_LOGO_BACKING_PADDING, logoPaddingStyle }, moduleCount, cellSize);
        expect(zero.effectivePaddingModules).toBeGreaterThan(0);
        expect(zero).toEqual(half);
        const two = getLogoMetrics({ ...DEFAULT_CONFIG, logoUrl: 'logo', logoPadding: 2, logoPaddingStyle }, moduleCount, cellSize);
        expect(two.effectivePaddingModules).toBeGreaterThan(half.effectivePaddingModules);
      }
      const none = getLogoMetrics({ ...DEFAULT_CONFIG, logoUrl: 'logo', logoPadding: 2, logoPaddingStyle: 'none' }, moduleCount, cellSize);
      expect(none.effectivePaddingModules).toBe(0);
    });

    it('defaults to 0.50 safe area ratio for invalid error correction levels', () => {
      const config: any = {
        ...DEFAULT_CONFIG,
        logoSize: 0.4,
        logoPadding: 0,
        logoPaddingStyle: 'none',
        errorCorrectionLevel: 'INVALID'
      };

      const metrics = getLogoMetrics(config, moduleCount, cellSize);
      expect(metrics.effectiveLogoSizeModules).toBeCloseTo(8.4);
    });
  });

  describe('getIsCoveredByLogo', () => {
    const moduleCount = 21;
    const cellSize = 10;

    it('returns false for everything if no logoUrl', () => {
      const config = { ...DEFAULT_CONFIG, logoUrl: null };
      const metrics = getLogoMetrics(config, moduleCount, cellSize);
      const isCovered = getIsCoveredByLogo(config, moduleCount, metrics);

      expect(isCovered(10, 10)).toBe(false);
    });

    it('covers square area correctly', () => {
      const config: QRConfig = {
        ...DEFAULT_CONFIG,
        logoUrl: 'test.png',
        logoPaddingStyle: 'square',
        logoSize: 0.2,
        logoPadding: 0
      };

      const metrics = getLogoMetrics(config, moduleCount, cellSize);
      const isCovered = getIsCoveredByLogo(config, moduleCount, metrics);

      expect(isCovered(10, 10)).toBe(true);
      expect(isCovered(0, 0)).toBe(false);
      expect(isCovered(10, 8)).toBe(true);
      expect(isCovered(10, 12)).toBe(true);
      expect(isCovered(10, 7)).toBe(false);
      expect(isCovered(10, 13)).toBe(false);
    });

    it('covers circular area correctly', () => {
      const config: QRConfig = {
        ...DEFAULT_CONFIG,
        logoUrl: 'test.png',
        logoPaddingStyle: 'circle',
        logoSize: 0.2,
        logoPadding: 0
      };

      const metrics = getLogoMetrics(config, moduleCount, cellSize);
      const isCovered = getIsCoveredByLogo(config, moduleCount, metrics);

      expect(isCovered(10, 10)).toBe(true);
      expect(isCovered(12, 12)).toBe(false);
      expect(isCovered(10, 12)).toBe(true);
    });
  });

  describe('Alignment Pattern Protection', () => {
    it('verifies alignment coordinate lists match the official QR specification across all standard versions', () => {
      const centersV2 = getAlignmentPatternCenters(2);
      expect(centersV2).toEqual([{ r: 18, c: 18 }]);

      const centersV7 = getAlignmentPatternCenters(7);
      expect(centersV7).toHaveLength(6);
      expect(centersV7).toContainEqual({ r: 6, c: 22 });
      expect(centersV7).toContainEqual({ r: 22, c: 6 });
      expect(centersV7).toContainEqual({ r: 22, c: 22 });
      expect(centersV7).toContainEqual({ r: 22, c: 38 });
      expect(centersV7).toContainEqual({ r: 38, c: 22 });
      expect(centersV7).toContainEqual({ r: 38, c: 38 });

      for (let v = 1; v <= 40; v++) {
        const centers = getAlignmentPatternCenters(v);
        if (v === 1) {
          expect(centers).toHaveLength(0);
        } else {
          expect(centers.length).toBeGreaterThan(0);
          const L = ALIGNMENT_PATTERN_COORDINATES[v];
          const first = L[0];
          const last = L[L.length - 1];
          expect(centers).not.toContainEqual({ r: first, c: first });
          expect(centers).not.toContainEqual({ r: first, c: last });
          expect(centers).not.toContainEqual({ r: last, c: first });
        }
      }
    });

    it('identifies 7x7 alignment pattern zone protection area correctly', () => {
      const size = 25;
      expect(isAlignmentPatternZone(18, 18, size)).toBe(true);
      expect(isAlignmentPatternZone(15, 15, size)).toBe(true);
      expect(isAlignmentPatternZone(21, 21, size)).toBe(true);
      expect(isAlignmentPatternZone(14, 18, size)).toBe(false);
      expect(isAlignmentPatternZone(18, 22, size)).toBe(false);
      expect(isAlignmentPatternZone(6, 18, size)).toBe(false);
    });
  });
});

