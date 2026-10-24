/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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

import { type QRConfig, type QRModules, QRType } from '@/types';
import { validateConfig } from '@/packages/qr-payload';
import { buildMatrix, loadQrEncoder } from '@/packages/qr-matrix';
import { REGEX_BIDI_CONTROL_CHARS, REGEX_STRICT_CONTROL_CHARS } from '@/packages/core/security';
import { PayloadRejectedError } from './svgExport';

/**
 * The Wallet card (ADR 0048): a phone-sized image with a plain black-on-white code that a
 * wallet app can turn into a pass from a photo (Google Wallet's "Photo" import). The code is
 * drawn without any of the design's colours, patterns or logo, because the wallet reads it
 * once and then draws its own plain copy.
 */

/** Card size in pixels: a 9:16 phone screen. */
export const WALLET_CARD_SIZE = { width: 1080, height: 1920 } as const;

/** Longest title and subtitle, in characters. */
export const WALLET_CARD_TEXT_LIMITS = { title: 60, subtitle: 80 } as const;

/** Text printed above the code. Both lines are optional. */
export interface WalletCardText {
  title?: string;
  subtitle?: string;
}

/** Thrown when the content must not go on a wallet card. */
export class WalletCardRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletCardRefusedError';
  }
}

/** Why a content type gets no wallet card, or `null` when it may have one. */
export function walletRefusalReason(type: QRType): string | null {
  if (type === QRType.PAYMENT) {
    return 'Payment codes are not offered as wallet cards: a wallet can show a pass on the lock screen, where anyone holding the phone could use it.';
  }
  if (type === QRType.BULK_CSV) return 'Wallet cards are made one code at a time.';
  return null;
}

const INK = '#000000';
const PAPER = '#ffffff';
const TITLE_INK = '#111111';
const SUBTITLE_INK = '#4a4a4a';
const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TITLE_FONT = `600 64px ${FONT_STACK}`;
const SUBTITLE_FONT = `400 40px ${FONT_STACK}`;
const TITLE_LINE = 80;
const SUBTITLE_LINE = 52;
const MAX_LINES = 2;
const SIDE = 96;
const TOP = 160;
/** Quiet zone in modules on every side (ISO/IEC 18004 asks for at least four). */
const QUIET_ZONE = 4;
const GAP = 72;

/** One line of text placed on the card (`y` is the alphabetic baseline). */
export interface WalletCardLine {
  text: string;
  font: string;
  color: string;
  x: number;
  y: number;
}

/** Where everything goes on the card. */
export interface WalletCardPlan {
  width: number;
  height: number;
  lines: WalletCardLine[];
  /** Left and top edge of the first module, in pixels. */
  originX: number;
  originY: number;
  /** Width of one module in whole pixels, so every edge is crisp. */
  moduleSize: number;
  modules: QRModules;
}

/** Measures `text` in `font`, in pixels. */
export type MeasureText = (text: string, font: string) => number;

/** Removes control and hidden direction characters and trims to `limit` characters. */
export function cleanCardText(text: string | undefined, limit: number): string {
  return (text ?? '').replace(REGEX_STRICT_CONTROL_CHARS, ' ').replace(REGEX_BIDI_CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** Breaks `text` into at most two lines that fit `width`, ending the last with an ellipsis if it is cut. */
function wrap(text: string, font: string, width: number, measure: MeasureText): string[] {
  if (!text) return [];
  const lines: string[] = [];
  let line = '';
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (measure(next, font) <= width || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === MAX_LINES - 1) {
      line = words.slice(i).join(' ');
      break;
    }
  }
  if (line) lines.push(line);
  return lines.map((value) => {
    if (measure(value, font) <= width) return value;
    let cut = value;
    while (cut.length > 1 && measure(`${cut}…`, font) > width) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  });
}

/**
 * Lays out the card: the title and subtitle centred at the top, then the code with its quiet
 * zone, as large as fits, centred in the space left.
 * @param modules - The code's module matrix.
 * @param text - The optional title and subtitle.
 * @param measure - Measures text; the canvas's `measureText` in the browser.
 */
export function planWalletCard(modules: QRModules, text: WalletCardText, measure: MeasureText): WalletCardPlan {
  const { width, height } = WALLET_CARD_SIZE;
  const textWidth = width - SIDE * 2;
  const lines: WalletCardLine[] = [];
  let y = TOP;
  for (const value of wrap(cleanCardText(text.title, WALLET_CARD_TEXT_LIMITS.title), TITLE_FONT, textWidth, measure)) {
    y += TITLE_LINE;
    lines.push({ text: value, font: TITLE_FONT, color: TITLE_INK, x: width / 2, y });
  }
  for (const value of wrap(cleanCardText(text.subtitle, WALLET_CARD_TEXT_LIMITS.subtitle), SUBTITLE_FONT, textWidth, measure)) {
    y += SUBTITLE_LINE;
    lines.push({ text: value, font: SUBTITLE_FONT, color: SUBTITLE_INK, x: width / 2, y });
  }
  const top = lines.length > 0 ? y + GAP : TOP;
  const span = modules.size + QUIET_ZONE * 2;
  const box = Math.min(width - SIDE * 2, height - top - TOP);
  const moduleSize = Math.max(1, Math.floor(box / span));
  const side = moduleSize * span;
  const originX = Math.round((width - side) / 2) + QUIET_ZONE * moduleSize;
  const originY = Math.round(top + (height - top - TOP - side) / 2) + QUIET_ZONE * moduleSize;
  return { width, height, lines, originX, originY, moduleSize, modules };
}

/** The drawing calls the card needs, so it can be painted onto any 2D context. */
export type WalletCardContext = Pick<CanvasRenderingContext2D, 'fillStyle' | 'font' | 'textAlign' | 'textBaseline' | 'fillRect' | 'fillText'>;

/** Paints a planned card: white paper, the text, then horizontal runs of dark modules. */
export function paintWalletCard(ctx: WalletCardContext, plan: WalletCardPlan): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, plan.width, plan.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const line of plan.lines) {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, line.x, line.y);
  }
  ctx.fillStyle = INK;
  const { modules, moduleSize, originX, originY } = plan;
  for (let row = 0; row < modules.size; row++) {
    let runStart = -1;
    for (let col = 0; col <= modules.size; col++) {
      const isDark = col < modules.size && modules.get(row, col);
      if (isDark) {
        if (runStart < 0) runStart = col;
      } else if (runStart >= 0) {
        ctx.fillRect(originX + runStart * moduleSize, originY + row * moduleSize, (col - runStart) * moduleSize, moduleSize);
        runStart = -1;
      }
    }
  }
}

/**
 * Draws the Wallet card for the current content onto a new canvas.
 * @param config - The content: type, value and error correction level.
 * @param text - The optional title and subtitle.
 * @throws WalletCardRefusedError for content that gets no card, PayloadRejectedError when the
 *   content fails validation, and the encoder's `QrEncodeError` when it cannot be encoded.
 */
export async function renderWalletCard(config: QRConfig, text: WalletCardText): Promise<HTMLCanvasElement> {
  const refusal = walletRefusalReason(config.type);
  if (refusal) throw new WalletCardRefusedError(refusal);
  const violations = validateConfig(config);
  if (violations.length > 0) throw new PayloadRejectedError(violations);

  const modules = buildMatrix(config, await loadQrEncoder());
  const canvas = document.createElement('canvas');
  canvas.width = WALLET_CARD_SIZE.width;
  canvas.height = WALLET_CARD_SIZE.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  const measure: MeasureText = (value, font) => {
    ctx.font = font;
    return ctx.measureText(value).width;
  };
  paintWalletCard(ctx, planWalletCard(modules, text, measure));
  return canvas;
}
