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
  const m = val.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  return m ? '#' + (m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]).toLowerCase() : null;
};

/**
 * Converts a hex colour (`#rgb` or `#rrggbb`, `#` optional) to a CSS `rgba()` string.
 * Invalid input falls back to black at the requested alpha.
 * @param hex - The input hex string.
 * @param alpha - Alpha channel (0..1).
 * @returns The `rgba(r,g,b,a)` string.
 */
export const hexToRgba = (hex: string, alpha: number): string => {
  const n = normalizeHex(hex);
  if (!n) return `rgba(0,0,0,${alpha})`;
  const v = parseInt(n.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
};

/**
 * Calculates WCAG relative luminance from raw sRGB channels (0..1).
 *
 * @param r - Red channel normalized (0..1).
 * @param g - Green channel normalized (0..1).
 * @param b - Blue channel normalized (0..1).
 * @returns Relative luminance value (0..1).
 */
export const getLuminanceFromRgb = (r: number, g: number, b: number): number =>
  getLuminanceFromLinearRgb(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));

/**
 * Converts one gamma-encoded sRGB channel (0..1) to linear light (0..1).
 */
export const srgbToLinear = (c: number): number =>
  c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/**
 * Converts one linear-light channel (0..1) back to gamma-encoded sRGB (0..1).
 */
export const linearToSrgb = (c: number): number =>
  c <= 0.03928 / 12.92 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/**
 * Calculates WCAG relative luminance from linear-light channels (0..1).
 */
export const getLuminanceFromLinearRgb = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Utility to calculate relative luminance of a color based on the WCAG 2.0 formula.
 */
export const getLuminance = (hex: string): number => {
  const v = parseInt(hex.slice(1), 16);
  return hex.length === 4
    ? getLuminanceFromRgb(((v >> 8) & 15) / 15, ((v >> 4) & 15) / 15, (v & 15) / 15)
    : getLuminanceFromRgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
};

/**
 * Calculates the contrast ratio between two colors.
 */
export const getContrastRatio = (fg: string, bg: string) => {
  const hexRegex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  if (!fg || !bg || !hexRegex.test(fg) || !hexRegex.test(bg)) return 0;
  const l1 = getLuminance(fg), l2 = getLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/**
 * Converts sRGB channels (0..255) to HSL color space.
 */
export const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  const rN = r / 255, gN = g / 255, bN = b / 255;
  const max = Math.max(rN, gN, bN), min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  let h = 0, s = 0;
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
  const normH = ((h % 360) + 360) % 360, a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + normH / 30) % 12;
    return (Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))) | 256).toString(16).slice(1);
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

/**
 * Adjusts a foreground hex color's lightness L using binary search to achieve target contrast (>= 4.5 by default)
 * against a background hex color while keeping hue and saturation constant.
 */
export const adjustColorForContrast = (fgHex: string, bgHex: string, targetContrast = 4.5): string => {
  const normBg = (bgHex === 'transparent' || !bgHex ? '#ffffff' : normalizeHex(bgHex)) || '#ffffff';
  const normFg = (fgHex ? normalizeHex(fgHex) : null) || '#000000';
  if (getContrastRatio(normFg, normBg) >= targetContrast) return normFg;

  const rgb = parseInt(normFg.slice(1), 16);
  const { h, s, l: initL } = rgbToHsl((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);

  const search = (low: number, high: number, targetL: number) => {
    if (getContrastRatio(hslToHex(h, s, targetL), normBg) < targetContrast) return null;
    let bestL = targetL, l = low, r = high;
    for (let i = 0; i < 10; i++) {
      const mid = (l + r) / 2;
      const ok = getContrastRatio(hslToHex(h, s, mid), normBg) >= targetContrast;
      if (ok) bestL = mid;
      if (ok === !targetL) l = mid; else r = mid;
    }
    return bestL;
  };

  const dL = search(0, initL, 0), gL = search(initL, 1, 1);
  const bestL = dL !== null && gL !== null ? (2 * initL <= dL + gL ? dL : gL) : (dL ?? gL);
  return bestL !== null ? hslToHex(h, s, bestL) : getLuminance(normBg) > 0.18 ? '#000000' : '#ffffff';
};

/**
 * Computes a minimal partial QRConfig patch that adjusts foreground colors, gradient stops,
 * eye frame colors, and eye ball colors to satisfy WCAG contrast targets (>= 4.5:1).
 */
export const calculateAutoFixColorPatch = (config?: Partial<QRConfig> | null): Partial<QRConfig> => {
  if (!config) return {};
  const bg = config.bgColor === 'transparent' || !config.bgColor ? '#ffffff' : config.bgColor;
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
  const o = typeof rOrColor === 'object' && rOrColor !== null;
  const r = Math.min(1, Math.max(0, o ? rOrColor.r : (typeof rOrColor === 'number' ? rOrColor : 0)));
  const g = Math.min(1, Math.max(0, o ? rOrColor.g : (gParam ?? 0)));
  const b = Math.min(1, Math.max(0, o ? rOrColor.b : (bParam ?? 0)));
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
  const d = 1 - k;
  return { c: (d - r) / d, m: (d - g) / d, y: (d - b) / d, k };
}

