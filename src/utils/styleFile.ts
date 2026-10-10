import { QRConfig } from '../types';
import { pickStyle } from './styleFields';
import { extractStyleConfig } from './brandTemplateManager';

/** Marker that tells a style file from any other JSON file. */
export const STYLE_FILE_FORMAT = 'qrcraftly-style';
/** Current style file version. */
export const STYLE_FILE_VERSION = 1;
/** Largest style file read, in bytes. Real files are well under 2 KB. */
export const MAX_STYLE_FILE_BYTES = 16 * 1024;

/** Result of reading a style file. */
export type StyleFileResult =
  | { ok: true; style: Partial<QRConfig>; skipped: number }
  | { ok: false; reason: string };

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
