import {
  type BorderLogoPosition,
  type BorderStyle,
  type BorderTextPosition,
  type FrameIcon,
  type FramePosition,
  type FrameStyle,
  type ColorStop,
  type GradientType,
  type LogoPaddingStyle,
  type MosaicMode,
  type QRConfig,
  QRErrorCorrectionLevel,
  QRStyle,
  SocialFormat,
  TemplateStyle,
} from '../types';
import { normalizeHex } from './colorUtils';

type FieldRule =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'color'; allowTransparent?: boolean }
  | { kind: 'number'; min: number; max: number }
  | { kind: 'boolean' }
  | { kind: 'colorStops' };

const enumOf = (values: readonly string[]): FieldRule => ({ kind: 'enum', values });

/**
 * Every setting a style file or brand template may carry, with the values each accepts. Anything else in a file
 * is ignored, and so are values outside these rules. Content (the QR value, type and text) and
 * uploaded images are not style: they are never written to a style file or read from one.
 */
const STYLE_FIELDS: Partial<Record<keyof QRConfig, FieldRule>> = {
  style: enumOf(Object.values(QRStyle)),
  fgColor: { kind: 'color' },
  // The background may be transparent (the Transparent Background switch).
  bgColor: { kind: 'color', allowTransparent: true },
  eyeColor: { kind: 'color' },
  gradientType: enumOf(['none', 'linear', 'radial'] satisfies GradientType[]),
  gradientColorStops: { kind: 'colorStops' },
  gradientAngle: { kind: 'number', min: 0, max: 360 },
  errorCorrectionLevel: enumOf(Object.values(QRErrorCorrectionLevel)),
  logoSize: { kind: 'number', min: 0.1, max: 0.3 },
  logoPaddingStyle: enumOf(['square', 'circle', 'none'] satisfies LogoPaddingStyle[]),
  logoPadding: { kind: 'number', min: 0, max: 4 },
  logoBackgroundColor: { kind: 'color' },
  isBorderEnabled: { kind: 'boolean' },
  borderSize: { kind: 'number', min: 0.01, max: 0.15 },
  borderColor: { kind: 'color' },
  borderStyle: enumOf(['solid', 'dashed', 'dotted', 'double'] satisfies BorderStyle[]),
  borderTextPosition: enumOf(['top-center', 'bottom-center'] satisfies BorderTextPosition[]),
  borderTextColor: { kind: 'color' },
  borderLogoPosition: enumOf(['bottom-center', 'bottom-right'] satisfies BorderLogoPosition[]),
  socialFormat: enumOf(Object.values(SocialFormat)),
  templateStyle: enumOf(Object.values(TemplateStyle)),
  templateBgColor: { kind: 'color' },
  templateTextColor: { kind: 'color' },
  templateQrScale: { kind: 'number', min: 0.5, max: 1.5 },
  isMazeEnabled: { kind: 'boolean' },
  isMazeBridgesEnabled: { kind: 'boolean' },
  mazeColor: { kind: 'color' },
  showMazeSolution: { kind: 'boolean' },
  frameStyle: enumOf(['none', 'pill', 'banner', 'speech-bubble', 'card'] satisfies FrameStyle[]),
  frameTextColor: { kind: 'color' },
  frameBgColor: { kind: 'color' },
  framePosition: enumOf(['bottom', 'top', 'left', 'right'] satisfies FramePosition[]),
  frameIcon: enumOf(['none', 'scan', 'camera', 'star', 'heart', 'info', 'phone'] satisfies FrameIcon[]),
  eyeFrameColor: { kind: 'color' },
  eyeBallColor: { kind: 'color' },
  mazePathWidth: { kind: 'number', min: 0.1, max: 0.5 },
  mosaicMode: enumOf(['tiles', 'halftone'] satisfies MosaicMode[]),
  mosaicContrast: { kind: 'number', min: 0, max: 1 },
};

/**
 * Reports whether a config key is a style setting that style files and templates may carry.
 * @param key - Config key.
 * @returns True when the key has a rule.
 */
export function isStyleField(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(STYLE_FIELDS, key);
}

/**
 * Checks one value against its rule.
 * @param rule - The accepted values.
 * @param value - The value from the file.
 * @returns The cleaned value, or undefined when it is not accepted.
 */
function cleanValue(rule: FieldRule, value: unknown): string | number | boolean | ColorStop[] | undefined {
  switch (rule.kind) {
    case 'enum':
      return typeof value === 'string' && rule.values.includes(value) ? value : undefined;
    case 'color':
      if (rule.allowTransparent && value === 'transparent') return value;
      return typeof value === 'string' ? (normalizeHex(value) ?? undefined) : undefined;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value >= rule.min && value <= rule.max ? value : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'colorStops': {
      if (!Array.isArray(value)) return undefined;
      const stops: ColorStop[] = [];
      for (const item of value) {
        if (typeof item === 'object' && item !== null && typeof (item as { offset?: unknown }).offset === 'number' && typeof (item as { color?: unknown }).color === 'string') {
          const color = normalizeHex((item as { color: string }).color);
          if (color) {
            stops.push({ offset: Math.max(0, Math.min(1, (item as { offset: number }).offset)), color });
          }
        }
      }
      return stops.length > 0 ? stops : undefined;
    }
  }
}

/**
 * Picks the style fields out of a config and checks them against the rules.
 * @param source - Candidate values.
 * @returns The accepted fields and how many were rejected.
 */
export function pickStyle(source: Record<string, unknown>): { style: Partial<QRConfig>; skipped: number } {
  const style: Record<string, unknown> = {};
  let skipped = 0;
  for (const key of Object.keys(STYLE_FIELDS) as (keyof QRConfig)[]) {
    const rule = STYLE_FIELDS[key];
    if (!rule || !(key in source)) continue;
    const value = cleanValue(rule, source[key]);
    if (value === undefined) skipped += 1;
    else style[key] = value;
  }
  return { style: style as Partial<QRConfig>, skipped };
}

