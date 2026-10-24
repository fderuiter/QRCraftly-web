import type { QRConfig } from '../types';
import { normalizeHex, getContrastRatio, getLuminance } from '@/packages/core/encoding';

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
  const normBg = (bgHex && normalizeHex(bgHex)) || '#ffffff';
  const normFg = (fgHex && normalizeHex(fgHex)) || '#000000';
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
  const bg = (config.bgColor && normalizeHex(config.bgColor)) || '#ffffff';
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
