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
export const normalizeHex = (val?: string | null): string | null => {
  if (!val) return null;
  const match = val.match(/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
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
 */
export const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === rN ? (gN - bN) / d + (gN < bN ? 6 : 0) : max === gN ? (bN - rN) / d + 2 : (rN - gN) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s, l };
};

/**
 * Converts HSL values (h: 0..360, s: 0..1, l: 0..1) to a CSS hex string (#rrggbb).
 */
export const hslToHex = (h: number, s: number, l: number): string => {
  const normH = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + normH / 30) % 12;
    return (Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))) | 256).toString(16).slice(1);
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

/**
 * Adjusts a foreground hex color's lightness L using binary search to achieve target contrast (>= 4.5 by default)
 * against a background hex color while keeping hue and saturation constant.
 * Keeps the foreground darker than the background. If no lightness on the dark side reaches target contrast,
 * falls back to black (#000000) or white (#ffffff).
 */
export const adjustColorForContrast = (fgHex: string, bgHex: string, targetContrast = 4.5): string => {
  const normBg = normalizeHex(bgHex) || '#ffffff';
  const normFg = normalizeHex(fgHex) || '#000000';
  if (getContrastRatio(normFg, normBg) >= targetContrast) return normFg;

  const rgb = parseInt(normFg.slice(1), 16);
  const { h, s, l: initL } = rgbToHsl((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
  const bgLuminance = getLuminance(normBg);

  // Keep the foreground darker than the background
  let bestL: number | null = null;
  if (getContrastRatio(hslToHex(h, s, 0), normBg) >= targetContrast && getLuminance(hslToHex(h, s, 0)) < bgLuminance) {
    let l = 0;
    let r = initL;
    bestL = 0;
    for (let i = 0; i < 10; i++) {
      const mid = (l + r) / 2;
      const candidateHex = hslToHex(h, s, mid);
      if (getContrastRatio(candidateHex, normBg) >= targetContrast && getLuminance(candidateHex) < bgLuminance) {
        bestL = mid;
        l = mid;
      } else {
        r = mid;
      }
    }
  }

  if (bestL !== null) {
    return hslToHex(h, s, bestL);
  }

  // When no lightness on the dark side works, fall back to black or white
  return getContrastRatio('#000000', normBg) >= targetContrast ? '#000000' : '#ffffff';
};

/**
 * Computes a minimal partial QRConfig patch that adjusts foreground colors, gradient stops,
 * eye frame colors, and eye ball colors to satisfy WCAG contrast targets (>= 4.5:1).
 */
export const calculateAutoFixColorPatch = (config?: Partial<QRConfig> | null): Partial<QRConfig> => {
  if (!config) return {};
  const bg = normalizeHex(config.bgColor) || '#ffffff';
  const patch: Partial<QRConfig> = {};

  if (config.gradientType && config.gradientType !== 'none' && config.gradientColorStops?.length) {
    const stops = config.gradientColorStops.map((stop) => ({ ...stop, color: adjustColorForContrast(stop.color, bg) }));
    patch.gradientColorStops = stops;
    patch.fgColor = stops[0]?.color ?? config.fgColor;
  } else {
    patch.fgColor = adjustColorForContrast(config.fgColor ?? '#000000', bg);
  }

  if (config.eyeFrameColor) patch.eyeFrameColor = adjustColorForContrast(config.eyeFrameColor, bg);
  if (config.eyeBallColor) patch.eyeBallColor = adjustColorForContrast(config.eyeBallColor, bg);
  if (config.eyeColor && (!config.eyeFrameColor || !config.eyeBallColor)) patch.eyeColor = adjustColorForContrast(config.eyeColor, bg);

  return patch;
};

export interface CmykColor {
  c: number;
  m: number;
  y: number;
  k: number;
}

/**
 * Converts sRGB color channels (0..1) to CMYK (0..1).
 * Supports calling with individual r, g, b arguments or an { r, g, b } object.
 *
 * @param r - Red channel (0..1) or { r, g, b } object.
 * @param g - Green channel (0..1) if first arg is number.
 * @param b - Blue channel (0..1) if first arg is number.
 * @returns CMYK components scaled 0..1.
 */
export function rgbToCmyk(r: number, g: number, b: number): CmykColor;
export function rgbToCmyk(color: { r: number; g: number; b: number }): CmykColor;
export function rgbToCmyk(
  rOrColor: number | { r: number; g: number; b: number },
  gParam?: number,
  bParam?: number
): CmykColor {
  let r: number;
  let g: number;
  let b: number;

  if (typeof rOrColor === 'object' && rOrColor !== null) {
    r = rOrColor.r;
    g = rOrColor.g;
    b = rOrColor.b;
  } else {
    r = rOrColor;
    g = gParam ?? 0;
    b = bParam ?? 0;
  }

  r = Math.min(1, Math.max(0, r));
  g = Math.min(1, Math.max(0, g));
  b = Math.min(1, Math.max(0, b));

  const k = 1 - Math.max(r, g, b);
  if (k >= 1) {
    return { c: 0, m: 0, y: 0, k: 1 };
  }

  const c = (1 - r - k) / (1 - k);
  const m = (1 - g - k) / (1 - k);
  const y = (1 - b - k) / (1 - k);

  return {
    c: Math.min(1, Math.max(0, c)),
    m: Math.min(1, Math.max(0, m)),
    y: Math.min(1, Math.max(0, y)),
    k: Math.min(1, Math.max(0, k)),
  };
}
