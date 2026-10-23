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
  const match = val.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].replace(/./g, '$&$&') : match[1];
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
  const norm = hex.length === 4 ? '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3] : hex;
  const rgb = parseInt(norm.slice(1), 16);
  return getLuminanceFromRgb(((rgb >> 16) & 0xff) / 255, ((rgb >> 8) & 0xff) / 255, (rgb & 0xff) / 255);
};

/**
 * Calculates the contrast ratio between two colors.
 * @param fg - Foreground color hex.
 * @param bg - Background color hex.
 * @returns The contrast ratio (1 to 21).
 */
export const getContrastRatio = (fg: string, bg: string) => {
  if (!fg || !bg) return 0;
  const hexRegex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  if (!hexRegex.test(fg) || !hexRegex.test(bg)) return 0;

  const l1 = getLuminance(fg);
  const l2 = getLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/**
 * Converts sRGB channels (0..255) to HSL color space.
 * @returns Object with h (0..360), s (0..1), and l (0..1).
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
  const hN = ((h % 360) + 360) % 360, c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((hN / 60) % 2) - 1)), m = l - c / 2;
  const i = Math.floor(hN / 60);
  const [r, g, b] = i === 0 ? [c, x, 0] : i === 1 ? [x, c, 0] : i === 2 ? [0, c, x] : i === 3 ? [0, x, c] : i === 4 ? [x, 0, c] : [c, 0, x];
  const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
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
    let best = { hex: '', l: targetL }, l = low, r = high;
    for (let i = 0; i < 15; i++) {
      const mid = (l + r) / 2, hexMid = hslToHex(h, s, mid);
      if (getContrastRatio(hexMid, normBg) >= targetContrast) {
        best = { hex: hexMid, l: mid };
        if (targetL === 0) l = mid; else r = mid;
      } else {
        if (targetL === 0) r = mid; else l = mid;
      }
    }
    return best.hex ? best : null;
  };

  const d = search(0, initL, 0), g = search(initL, 1, 1);
  if (d && g) return Math.abs(initL - d.l) <= Math.abs(g.l - initL) ? d.hex : g.hex;
  if (d || g) return (d || g)!.hex;
  return getContrastRatio('#000000', normBg) >= getContrastRatio('#ffffff', normBg) ? '#000000' : '#ffffff';
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
    const stops = config.gradientColorStops.map((stop) => ({ ...stop, color: adjustColorForContrast(stop.color, bg, 4.5) }));
    patch.gradientColorStops = stops;
    patch.fgColor = stops[0]?.color ?? config.fgColor;
  } else {
    patch.fgColor = adjustColorForContrast(config.fgColor || '#000000', bg, 4.5);
  }

  const fix = (c?: string) => c ? adjustColorForContrast(c, bg, 4.5) : undefined;
  if (config.eyeFrameColor) patch.eyeFrameColor = fix(config.eyeFrameColor);
  else if (config.eyeColor) patch.eyeColor = fix(config.eyeColor);

  if (config.eyeBallColor) patch.eyeBallColor = fix(config.eyeBallColor);
  else if (config.eyeColor && !patch.eyeColor) patch.eyeColor = fix(config.eyeColor);

  return patch;
};

