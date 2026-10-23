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

import type { QRConfig } from '../types';

/**
 * Normalizes a hex color string, validating and formatting it consistently.
 * Converts shorthand (#123) to full (#112233), ensures # prefix, and lowercases.
 * @param val - The input hex string.
 * @returns The normalized hex string, or null if invalid.
 */
export const normalizeHex = (val: string): string | null => {
  const match = val.match(/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  return '#' + hex.toLowerCase();
};

/**
 * Converts a hex colour (`#rgb` or `#rrggbb`, `#` optional) to a CSS `rgba()` string.
 * Invalid input falls back to black at the requested alpha.
 * @param hex - The input hex string.
 * @param alpha - Alpha channel (0..1).
 * @returns The `rgba(r,g,b,a)` string.
 */
export const hexToRgba = (hex: string, alpha: number): string => {
  const normalized = normalizeHex(hex);
  if (!normalized) return `rgba(0,0,0,${alpha})`;
  const value = parseInt(normalized.slice(1), 16);
  return `rgba(${(value >> 16) & 0xff},${(value >> 8) & 0xff},${value & 0xff},${alpha})`;
};

/**
 * Calculates WCAG relative luminance from raw sRGB channels (0..1).
 *
 * @param r - Red channel normalized (0..1).
 * @param g - Green channel normalized (0..1).
 * @param b - Blue channel normalized (0..1).
 * @returns Relative luminance value (0..1).
 */
export const getLuminanceFromRgb = (r: number, g: number, b: number): number => {
  return getLuminanceFromLinearRgb(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
};

/**
 * Converts one gamma-encoded sRGB channel (0..1) to linear light (0..1).
 *
 * @param c - Gamma-encoded channel value (0..1).
 * @returns Linear-light channel value (0..1).
 */
export const srgbToLinear = (c: number): number =>
  c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/**
 * Converts one linear-light channel (0..1) back to gamma-encoded sRGB (0..1).
 * Inverse of {@link srgbToLinear}.
 *
 * @param c - Linear-light channel value (0..1).
 * @returns Gamma-encoded channel value (0..1).
 */
export const linearToSrgb = (c: number): number =>
  c <= 0.03928 / 12.92 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/**
 * Calculates WCAG relative luminance from linear-light channels (0..1).
 * Relative luminance is linear in these channels, so scaling all three by `k` scales it by `k`.
 *
 * @param r - Red channel in linear light (0..1).
 * @param g - Green channel in linear light (0..1).
 * @param b - Blue channel in linear light (0..1).
 * @returns Relative luminance value (0..1).
 */
export const getLuminanceFromLinearRgb = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Utility to calculate relative luminance of a color based on the WCAG 2.0 formula.
 * Used for contrast ratio calculation.
 *
 * The magic numbers in this formula are defined by the sRGB color space specification:
 * - 0.03928: The threshold where the sRGB gamma correction curve changes from linear to exponential.
 * - 12.92: The linear scaling factor for low luminance values.
 * - 2.4: The gamma exponent for sRGB conversion.
 * - 0.2126, 0.7152, 0.0722: The relative weights (luminance contributions) of Red, Green, and Blue,
 *   based on human eye sensitivity (green appears much brighter than blue).
 *
 * @see https://www.w3.org/TR/WCAG20/#relativeluminancedef
 * @param hex - The hex color code (e.g. #RRGGBB or #RGB).
 * @returns The relative luminance value.
 */
export const getLuminance = (hex: string): number => {
  let normalizedHex = hex;
  if (hex.length === 4) {
    normalizedHex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }

  const rgb = parseInt(normalizedHex.slice(1), 16);
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;

  return getLuminanceFromRgb(r, g, b);
};

/**
 * Calculates the contrast ratio between two colors.
 * @param fg - Foreground color hex.
 * @param bg - Background color hex.
 * @returns The contrast ratio (1 to 21).
 */
export const getContrastRatio = (fg: string, bg: string) => {
  if (!fg || !bg) return 0;
  if ((fg.length !== 7 && fg.length !== 4) || (bg.length !== 7 && bg.length !== 4)) return 0;

  const hexRegex = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
  if (!hexRegex.test(fg) || !hexRegex.test(bg)) return 0;

  const l1 = getLuminance(fg);
  const l2 = getLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Converts sRGB channels (0..255) to HSL color space.
 * @returns Object with h (0..360), s (0..1), and l (0..1).
 */
export const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
        break;
      case gNorm:
        h = (bNorm - rNorm) / d + 2;
        break;
      case bNorm:
        h = (rNorm - gNorm) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: h * 360, s, l };
};

/**
 * Converts HSL values (h: 0..360, s: 0..1, l: 0..1) to a CSS hex string (#rrggbb).
 */
export const hslToHex = (h: number, s: number, l: number): string => {
  const hNorm = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hNorm / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (0 <= hNorm && hNorm < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= hNorm && hNorm < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= hNorm && hNorm < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= hNorm && hNorm < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= hNorm && hNorm < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= hNorm && hNorm < 360) {
    r = c; g = 0; b = x;
  }

  const rByte = Math.round((r + m) * 255);
  const gByte = Math.round((g + m) * 255);
  const bByte = Math.round((b + m) * 255);

  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${toHex(rByte)}${toHex(gByte)}${toHex(bByte)}`;
};

/**
 * Adjusts a foreground hex color's lightness L using binary search to achieve target contrast (>= 4.5 by default)
 * against a background hex color while keeping hue and saturation constant.
 */
export const adjustColorForContrast = (
  fgHex: string,
  bgHex: string,
  targetContrast = 4.5
): string => {
  const normBg = (bgHex === 'transparent' || !bgHex ? '#ffffff' : normalizeHex(bgHex)) || '#ffffff';
  const normFg = (fgHex ? normalizeHex(fgHex) : null) || '#000000';

  if (getContrastRatio(normFg, normBg) >= targetContrast) {
    return normFg;
  }

  const rgb = parseInt(normFg.slice(1), 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  const { h, s, l: initialL } = rgbToHsl(r, g, b);

  // Binary search towards darker lightness L in [0, initialL]
  let bestDark: string | null = null;
  let bestDarkL = 0;
  if (getContrastRatio(hslToHex(h, s, 0), normBg) >= targetContrast) {
    let low = 0;
    let high = initialL;
    for (let i = 0; i < 15; i++) {
      const mid = (low + high) / 2;
      const hexMid = hslToHex(h, s, mid);
      if (getContrastRatio(hexMid, normBg) >= targetContrast) {
        bestDark = hexMid;
        bestDarkL = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
  }

  // Binary search towards lighter lightness L in [initialL, 1]
  let bestLight: string | null = null;
  let bestLightL = 1;
  if (getContrastRatio(hslToHex(h, s, 1), normBg) >= targetContrast) {
    let low = initialL;
    let high = 1;
    for (let i = 0; i < 15; i++) {
      const mid = (low + high) / 2;
      const hexMid = hslToHex(h, s, mid);
      if (getContrastRatio(hexMid, normBg) >= targetContrast) {
        bestLight = hexMid;
        bestLightL = mid;
        high = mid;
      } else {
        low = mid;
      }
    }
  }

  if (bestDark !== null && bestLight !== null) {
    const deltaDark = Math.abs(initialL - bestDarkL);
    const deltaLight = Math.abs(bestLightL - initialL);
    return deltaDark <= deltaLight ? bestDark : bestLight;
  }
  if (bestDark !== null) return bestDark;
  if (bestLight !== null) return bestLight;

  // Fallback if maintaining saturation fails to hit contrast ratio: pick black or white based on highest contrast
  const blackContrast = getContrastRatio('#000000', normBg);
  const whiteContrast = getContrastRatio('#ffffff', normBg);
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff';
};

/**
 * Computes a minimal partial QRConfig patch that adjusts foreground colors, gradient stops,
 * eye frame colors, and eye ball colors to satisfy WCAG contrast targets (>= 4.5:1).
 */
export const calculateAutoFixColorPatch = (config?: Partial<QRConfig> | null): Partial<QRConfig> => {
  if (!config) return {};
  const bg = config.bgColor === 'transparent' || !config.bgColor ? '#ffffff' : config.bgColor;
  const patch: Partial<QRConfig> = {};

  if (
    config.gradientType &&
    config.gradientType !== 'none' &&
    config.gradientColorStops &&
    config.gradientColorStops.length > 0
  ) {
    const newStops = config.gradientColorStops.map((stop) => ({
      ...stop,
      color: adjustColorForContrast(stop.color, bg, 4.5),
    }));
    patch.gradientColorStops = newStops;
    patch.fgColor = newStops[0]?.color ?? config.fgColor;
  } else {
    const fg = config.fgColor || '#000000';
    patch.fgColor = adjustColorForContrast(fg, bg, 4.5);
  }

  const effectiveEyeFrame = config.eyeFrameColor || config.eyeColor;
  if (effectiveEyeFrame) {
    if (config.eyeFrameColor) {
      patch.eyeFrameColor = adjustColorForContrast(config.eyeFrameColor, bg, 4.5);
    } else if (config.eyeColor) {
      patch.eyeColor = adjustColorForContrast(config.eyeColor, bg, 4.5);
    }
  }

  const effectiveEyeBall = config.eyeBallColor || config.eyeColor;
  if (effectiveEyeBall) {
    if (config.eyeBallColor) {
      patch.eyeBallColor = adjustColorForContrast(config.eyeBallColor, bg, 4.5);
    } else if (config.eyeColor && !patch.eyeColor) {
      patch.eyeColor = adjustColorForContrast(config.eyeColor, bg, 4.5);
    }
  }

  return patch;
};

