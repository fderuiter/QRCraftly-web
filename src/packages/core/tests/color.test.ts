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
import { getContrastRatio, normalizeHex, hexToRgba, srgbToLinear, linearToSrgb, getLuminanceFromLinearRgb, getLuminanceFromRgb, rgbToCmyk } from '../encoding';

describe('colorUtils', () => {
  describe('getContrastRatio', () => {
    it('returns maximum contrast for black on white', () => {
      const contrast = getContrastRatio('#000000', '#ffffff');
      expect(contrast).toBeCloseTo(21, 1);
    });

    it('returns maximum contrast for white on black', () => {
      const contrast = getContrastRatio('#ffffff', '#000000');
      expect(contrast).toBeCloseTo(21, 1);
    });

    it('supports 3-digit hex codes', () => {
      expect(getContrastRatio('#fff', '#000')).toBeCloseTo(21, 1);
      expect(getContrastRatio('#000', '#fff')).toBeCloseTo(21, 1);
      expect(getContrastRatio('#fff', '#000000')).toBeCloseTo(21, 1);
      // Mixed length
      expect(getContrastRatio('#F00', '#000000')).toBeCloseTo(5.25, 2); // Red on Black
    });

    it('returns 1 for same colors', () => {
      expect(getContrastRatio('#ffffff', '#ffffff')).toBe(1);
      expect(getContrastRatio('#000000', '#000000')).toBe(1);
      expect(getContrastRatio('#123456', '#123456')).toBe(1);
      expect(getContrastRatio('#123', '#123')).toBe(1);
    });

    it('returns 0 for invalid inputs', () => {
      // Test length checks
      expect(getContrastRatio('', '#000000')).toBe(0);

      // We can't easily test null/undefined types in TS without casting,
      // but the runtime check handles it if passed from JS.
      expect(getContrastRatio(null as any, '#000000')).toBe(0);
      expect(getContrastRatio('#000000', undefined as any)).toBe(0);
    });

    it('returns 0 for non-hex characters', () => {
      // #GGGGGG is invalid but has length 7.
      expect(getContrastRatio('#GGGGGG', '#FFFFFF')).toBe(0);
      expect(getContrastRatio('#FFFFFF', '#GGGGGG')).toBe(0);
      expect(getContrastRatio('#12345Z', '#FFFFFF')).toBe(0);
      // Invalid 3-digit-like
      expect(getContrastRatio('#GGG', '#FFFFFF')).toBe(0);
    });

    it('calculates WCAG 2.0 contrast ratio correctly', () => {
      // #205081 (Blue) on #FFFFFF (White) -> Approx 8.31
      // L_blue ≈ 0.076, L_white = 1.0
      // (1 + 0.05) / (0.076 + 0.05) ≈ 1.05 / 0.126 = 8.33
      expect(getContrastRatio('#205081', '#FFFFFF')).toBeCloseTo(8.31, 1);

      // #205081 (Blue) on #000000 (Black) -> Approx 2.52
      // L_blue ≈ 0.076, L_black = 0
      // (0.076 + 0.05) / (0 + 0.05) ≈ 0.126 / 0.05 = 2.52
      expect(getContrastRatio('#205081', '#000000')).toBeCloseTo(2.52, 1);
    });

    it('returns 0 if lengths are invalid', () => {
      expect(getContrastRatio('#12345', '#ffffff')).toBe(0);
      expect(getContrastRatio('#ffffff', '#12345')).toBe(0);
      expect(getContrastRatio('#12345678', '#ffffff')).toBe(0);
    });
  });

  describe('normalizeHex', () => {
    it('normalizes 3-digit and 6-digit hex codes with and without #', () => {
      expect(normalizeHex('#123')).toBe('#112233');
      expect(normalizeHex('123')).toBe('#112233');
      expect(normalizeHex('#123456')).toBe('#123456');
      expect(normalizeHex('123456')).toBe('#123456');
    });

    it('converts letters to lowercase', () => {
      expect(normalizeHex('#ABC')).toBe('#aabbcc');
      expect(normalizeHex('DEF')).toBe('#ddeeff');
    });

    it('returns null for invalid hex length or characters', () => {
      expect(normalizeHex('#12')).toBeNull();
      expect(normalizeHex('12345')).toBeNull();
      expect(normalizeHex('#GGGGGG')).toBeNull();
    });
  });
});

describe('hexToRgba', () => {
  it('converts full and shorthand hex to rgba', () => {
    expect(hexToRgba('#1a2b3c', 0.5)).toBe('rgba(26,43,60,0.5)');
    expect(hexToRgba('#fff', 0)).toBe('rgba(255,255,255,0)');
    expect(hexToRgba('0f766e', 1)).toBe('rgba(15,118,110,1)');
  });

  it('falls back to black for invalid input', () => {
    expect(hexToRgba('not-a-colour', 0.18)).toBe('rgba(0,0,0,0.18)');
  });
});

describe('linear-light helpers', () => {
  it('round-trips sRGB channels through linear light', () => {
    for (let v = 0; v <= 255; v += 17) {
      const c = v / 255;
      expect(linearToSrgb(srgbToLinear(c))).toBeCloseTo(c, 9);
    }
  });

  it('computes the same luminance from linear channels as from sRGB channels', () => {
    const [r, g, b] = [0.2, 0.6, 0.9];
    expect(getLuminanceFromLinearRgb(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b))).toBeCloseTo(getLuminanceFromRgb(r, g, b), 12);
    expect(getLuminanceFromLinearRgb(1, 1, 1)).toBeCloseTo(1, 12);
  });
});

describe('rgbToCmyk', () => {
  it('converts black (0,0,0) to CMYK (0,0,0,1)', () => {
    const cmyk = rgbToCmyk(0, 0, 0);
    expect(cmyk).toEqual({ c: 0, m: 0, y: 0, k: 1 });
  });

  it('converts white (1,1,1) to CMYK (0,0,0,0)', () => {
    const cmyk = rgbToCmyk(1, 1, 1);
    expect(cmyk).toEqual({ c: 0, m: 0, y: 0, k: 0 });
  });

  it('converts red, green, blue primary colors', () => {
    expect(rgbToCmyk(1, 0, 0)).toEqual({ c: 0, m: 1, y: 1, k: 0 });
    expect(rgbToCmyk(0, 1, 0)).toEqual({ c: 1, m: 0, y: 1, k: 0 });
    expect(rgbToCmyk(0, 0, 1)).toEqual({ c: 1, m: 1, y: 0, k: 0 });
  });

  it('converts secondary colors cyan, magenta, yellow', () => {
    expect(rgbToCmyk(0, 1, 1)).toEqual({ c: 1, m: 0, y: 0, k: 0 });
    expect(rgbToCmyk(1, 0, 1)).toEqual({ c: 0, m: 1, y: 0, k: 0 });
    expect(rgbToCmyk(1, 1, 0)).toEqual({ c: 0, m: 0, y: 1, k: 0 });
  });

  it('supports object argument { r, g, b }', () => {
    const cmyk = rgbToCmyk({ r: 0.5, g: 0.5, b: 0.5 });
    expect(cmyk).toEqual({ c: 0, m: 0, y: 0, k: 0.5 });
  });
});

