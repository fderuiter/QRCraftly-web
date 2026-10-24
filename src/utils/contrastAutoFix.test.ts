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
  rgbToHsl,
  hslToHex,
  adjustColorForContrast,
  calculateAutoFixColorPatch,
} from './contrastAutoFix';
import { getContrastRatio } from '@/packages/core/encoding';

describe('contrastAutoFix', () => {
  describe('rgbToHsl', () => {
    it('converts red (255, 0, 0) to HSL (0, 1, 0.5)', () => {
      const hsl = rgbToHsl(255, 0, 0);
      expect(hsl.h).toBeCloseTo(0, 1);
      expect(hsl.s).toBeCloseTo(1, 2);
      expect(hsl.l).toBeCloseTo(0.5, 2);
    });

    it('converts green (0, 255, 0) to HSL (120, 1, 0.5)', () => {
      const hsl = rgbToHsl(0, 255, 0);
      expect(hsl.h).toBeCloseTo(120, 1);
      expect(hsl.s).toBeCloseTo(1, 2);
      expect(hsl.l).toBeCloseTo(0.5, 2);
    });

    it('converts blue (0, 0, 255) to HSL (240, 1, 0.5)', () => {
      const hsl = rgbToHsl(0, 0, 255);
      expect(hsl.h).toBeCloseTo(240, 1);
      expect(hsl.s).toBeCloseTo(1, 2);
      expect(hsl.l).toBeCloseTo(0.5, 2);
    });

    it('converts white (255, 255, 255) to HSL (0, 0, 1)', () => {
      const hsl = rgbToHsl(255, 255, 255);
      expect(hsl.s).toBe(0);
      expect(hsl.l).toBe(1);
    });
  });

  describe('hslToHex', () => {
    it('converts HSL red (0, 1, 0.5) to #ff0000', () => {
      expect(hslToHex(0, 1, 0.5)).toBe('#ff0000');
    });

    it('converts HSL green (120, 1, 0.5) to #00ff00', () => {
      expect(hslToHex(120, 1, 0.5)).toBe('#00ff00');
    });

    it('converts HSL blue (240, 1, 0.5) to #0000ff', () => {
      expect(hslToHex(240, 1, 0.5)).toBe('#0000ff');
    });

    it('converts HSL white (0, 0, 1) to #ffffff', () => {
      expect(hslToHex(0, 0, 1)).toBe('#ffffff');
    });
  });

  describe('adjustColorForContrast', () => {
    it('returns original foreground color if contrast is already sufficient', () => {
      const result = adjustColorForContrast('#000000', '#ffffff');
      expect(result).toBe('#000000');
    });

    it('darkens low-contrast color to reach WCAG contrast >= 4.5:1 against white background', () => {
      const result = adjustColorForContrast('#cccccc', '#ffffff');
      expect(getContrastRatio(result, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });

    it('falls back to black when dark lightness adjustment cannot meet contrast target', () => {
      const result = adjustColorForContrast('#eeeeee', '#ffffff');
      expect(getContrastRatio(result, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('calculateAutoFixColorPatch', () => {
    it('returns empty patch for null/undefined config', () => {
      expect(calculateAutoFixColorPatch(null)).toEqual({});
      expect(calculateAutoFixColorPatch(undefined)).toEqual({});
    });

    it('adjusts fgColor to meet contrast requirements against bgColor', () => {
      const patch = calculateAutoFixColorPatch({
        fgColor: '#e0e0e0',
        bgColor: '#ffffff',
      });
      expect(patch.fgColor).toBeDefined();
      expect(getContrastRatio(patch.fgColor!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });

    it('adjusts eyeFrameColor, eyeBallColor, and gradientColorStops if present', () => {
      const patch = calculateAutoFixColorPatch({
        bgColor: '#ffffff',
        fgColor: '#dddddd',
        gradientType: 'linear',
        gradientColorStops: [
          { offset: 0, color: '#e0e0e0' },
          { offset: 1, color: '#cccccc' },
        ],
        eyeFrameColor: '#d0d0d0',
        eyeBallColor: '#b0b0b0',
      });
      expect(getContrastRatio(patch.gradientColorStops![0].color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(patch.gradientColorStops![1].color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(patch.eyeFrameColor!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(patch.eyeBallColor!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });
  });
});
