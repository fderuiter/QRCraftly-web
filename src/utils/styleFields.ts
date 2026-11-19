import { type BorderLogoPosition, type BorderStyle, type BorderTextPosition, type FrameIcon, FRAME_FONT_FAMILIES, type FramePosition, type FrameStyle, type ColorStop, EyeShape, type GradientType, type LogoPaddingStyle, type MosaicMode, type QRConfig, QRErrorCorrectionLevel, QRStyle, SocialFormat, TemplateStyle } from '@/packages/core/types';
import { normalizeHex } from '@/packages/core/encoding';

type FieldRule =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'color'; allowTransparent?: boolean; allowEmpty?: boolean }
  | { kind: 'number'; min: number; max: number }
  | { kind: 'boolean' }
  | { kind: 'colorStops' };

const enumOf = (values: readonly string[]): FieldRule => ({ kind: 'enum', values });

/** Frame and ball shapes share one rule; an unset shape means "match the pattern". */
const EYE_SHAPE_RULE = enumOf(Object.values(EyeShape));

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
  // An empty string inherits bgColor; 'transparent' omits the logo backing fill while keeping the module gap.
  logoBackgroundColor: { kind: 'color', allowTransparent: true, allowEmpty: true },
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
  frameFontFamily: enumOf(FRAME_FONT_FAMILIES),
  isCustomEyeColor: { kind: 'boolean' },
  eyeFrameColor: { kind: 'color' },
  eyeBallColor: { kind: 'color' },
  eyeFrameShape: EYE_SHAPE_RULE,
  eyeBallShape: EYE_SHAPE_RULE,
  mazePathWidth: { kind: 'number', min: 0.1, max: 0.5 },
  mosaicMode: enumOf(['tiles', 'halftone'] satisfies MosaicMode[]),
  mosaicContrast: { kind: 'number', min: 0, max: 1 },
  quietZoneModules: { kind: 'number', min: 2, max: 10 },
  animationFps: { kind: 'number', min: 1, max: 60 },
  isLuminanceMaskingEnabled: { kind: 'boolean' },
  fgColorDark: { kind: 'color' },
  fgColorLight: { kind: 'color' },
  luminanceThreshold: { kind: 'number', min: 0, max: 1 },
};

/**
 * Clean baseline defaults for every visual style setting.
 * When applying a brand template, omitted visual properties fall back to these defaults
 * so prior canvas styles do not bleed through.
 */
export const STYLE_BASELINE: Readonly<Partial<QRConfig>> = {
  style: QRStyle.STANDARD,
  fgColor: '#000000',
  bgColor: '#ffffff',
  eyeColor: '#000000',
  gradientType: 'none',
  gradientColorStops: undefined,
  gradientAngle: 0,
  errorCorrectionLevel: QRErrorCorrectionLevel.H,
  logoSize: 0.2,
  logoPaddingStyle: 'square',
  logoPadding: 1,
  logoBackgroundColor: '',
  isBorderEnabled: false,
  borderSize: 0.05,
  borderColor: '#000000',
  borderStyle: 'solid',
  borderTextPosition: 'bottom-center',
  borderTextColor: '#ffffff',
  borderLogoPosition: 'bottom-center',
  socialFormat: SocialFormat.SQUARE_1_1,
  templateStyle: TemplateStyle.NONE,
  templateBgColor: undefined,
  templateTextColor: undefined,
  templateQrScale: 1.0,
  isMazeEnabled: false,
  isMazeBridgesEnabled: true,
  mazeColor: '#3b82f6',
  showMazeSolution: false,
  frameStyle: 'none',
  frameTextColor: '#ffffff',
  frameBgColor: '#000000',
  framePosition: 'bottom',
  frameIcon: 'none',
  frameFontFamily: 'sans-serif',
  isCustomEyeColor: undefined,
  eyeFrameColor: undefined,
  eyeBallColor: undefined,
  eyeFrameShape: undefined,
  eyeBallShape: undefined,
  mazePathWidth: undefined,
  mosaicMode: undefined,
  mosaicContrast: undefined,
  quietZoneModules: 4,
  animationFps: 30,
  isLuminanceMaskingEnabled: false,
  fgColorDark: undefined,
  fgColorLight: undefined,
  luminanceThreshold: undefined,
};

/** Valid property keys for QR visual style configuration. */
export type StyleField = Extract<keyof QRConfig, string>;

const BASELINE_ENTRIES = Object.entries(STYLE_BASELINE);

/**
 * Complete patch restoring all visual settings, logos, images, and frame text
 * to clean baseline defaults while leaving QR payload and content fields untouched.
 * @returns Partial QRConfig updates to pass to updateConfig.
 */
export function resetStylePatch(): Partial<QRConfig> {
  return {
    ...STYLE_BASELINE,
    logoUrl: null,
    borderLogoUrl: null,
    backgroundImageUrl: null,
    mosaicImageUrl: null,
    frameText: '',
  };
}

/**
 * Reports whether all visual settings, logos, images, and frame text already match
 * clean baseline defaults, ignoring QR payload and free-text content fields.
 * @param config - Active QR configuration.
 * @returns True when Reset style would have nothing to reset.
 */
export function isStyleAtBaseline(config: QRConfig): boolean {
  if (
    (config.logoUrl ?? null) !== null ||
    (config.borderLogoUrl ?? null) !== null ||
    (config.backgroundImageUrl ?? null) !== null ||
    (config.mosaicImageUrl ?? null) !== null ||
    (config.frameText ?? '') !== ''
  ) {
    return false;
  }

  for (const [key, baselineValue] of BASELINE_ENTRIES) {
    const currentValue: unknown = Reflect.get(config, key);
    if (key === 'gradientColorStops') {
      if (Array.isArray(currentValue) && currentValue.length > 0) return false;
      continue;
    }
    if (baselineValue === undefined) {
      if (currentValue !== undefined) return false;
      continue;
    }
    if ((currentValue ?? baselineValue) !== baselineValue) {
      return false;
    }
  }

  return true;
}

/**
 * Reports whether a config key is a style setting that style files and templates may carry.
 * @param key - Config key.
 * @returns True when the key has a rule.
 */
export function isStyleField(key: string): key is StyleField {
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
      if (rule.allowEmpty && value === '') return value;
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
    // An unset field (such as an eye shape left to match the pattern) is absent, not rejected.
    if (!rule || source[key] === undefined) continue;
    const value = cleanValue(rule, source[key]);
    if (value === undefined) skipped += 1;
    else style[key] = value;
  }
  return { style: style as Partial<QRConfig>, skipped };
}

