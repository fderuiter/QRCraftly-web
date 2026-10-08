import {
  BorderLogoPosition,
  BorderStyle,
  BorderTextPosition,
  FrameIcon,
  FramePosition,
  FrameStyle,
  ColorStop,
  GradientType,
  LogoPaddingStyle,
  QRConfig,
  QRErrorCorrectionLevel,
  QRStyle,
  SocialFormat,
  TemplateStyle,
} from '../types';
import { normalizeHex } from './colorUtils';
import { extractStyleConfig } from './brandTemplateManager';

/** Marker that tells a style file from any other JSON file. */
export const STYLE_FILE_FORMAT = 'qrcraftly-style';
/** Current style file version. */
export const STYLE_FILE_VERSION = 1;
/** Largest style file read, in bytes. Real files are well under 2 KB. */
export const MAX_STYLE_FILE_BYTES = 16 * 1024;

type FieldRule =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'color' }
  | { kind: 'number'; min: number; max: number }
  | { kind: 'boolean' }
  | { kind: 'colorStops' };

const enumOf = (values: readonly string[]): FieldRule => ({ kind: 'enum', values });

/**
 * Every setting a style file may carry, with the values each accepts. Anything else in a file
 * is ignored, and so are values outside these rules. Content (the QR value, type and text) and
 * uploaded images are not style: they are never written to a style file or read from one.
 */
const STYLE_FIELDS: Partial<Record<keyof QRConfig, FieldRule>> = {
  style: enumOf(Object.values(QRStyle)),
  fgColor: { kind: 'color' },
  bgColor: { kind: 'color' },
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
};

/** Result of reading a style file. */
export type StyleFileResult =
  | { ok: true; style: Partial<QRConfig>; skipped: number }
  | { ok: false; reason: string };

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
function pickStyle(source: Record<string, unknown>): { style: Partial<QRConfig>; skipped: number } {
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

/**
 * Serialises the style of a config to the text of a style file. Content and uploaded images
 * are left out.
 * @param config - Current configuration.
 * @returns JSON text for a `.qrcraftly.json` file.
 */
export function serializeStyle(config: QRConfig): string {
  const { style } = pickStyle(extractStyleConfig(config) as Record<string, unknown>);
  return `${JSON.stringify({ format: STYLE_FILE_FORMAT, version: STYLE_FILE_VERSION, style }, null, 2)}\n`;
}

/**
 * Reads the text of a style file. It never throws; a file that is not a style file, or is too
 * large, comes back as `ok: false` with a reason a person can read.
 * @param text - File text.
 * @returns The accepted style fields, or why the file was refused.
 */
export function parseStyleFile(text: string): StyleFileResult {
  if (text.length > MAX_STYLE_FILE_BYTES) return { ok: false, reason: 'That file is too large to be a QRCraftly style file.' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'That file is not valid JSON.' };
  }
  if (typeof data !== 'object' || data === null || (data as { format?: unknown }).format !== STYLE_FILE_FORMAT) {
    return { ok: false, reason: 'That is not a QRCraftly style file.' };
  }
  const { version, style } = data as { version?: unknown; style?: unknown };
  if (version !== STYLE_FILE_VERSION) return { ok: false, reason: 'That style file comes from a newer version of QRCraftly.' };
  if (typeof style !== 'object' || style === null || Array.isArray(style)) return { ok: false, reason: 'That style file has no settings.' };
  const picked = pickStyle(style as Record<string, unknown>);
  if (Object.keys(picked.style).length === 0) return { ok: false, reason: 'That style file has no usable settings.' };
  return { ok: true, ...picked };
}
