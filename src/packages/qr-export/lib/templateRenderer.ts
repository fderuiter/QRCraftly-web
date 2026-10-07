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

import { QRConfig, QRModules, SocialFormat, TemplateStyle } from '@/types';
import { drawQRInternal, ModuleRenderOptions, type MazeData } from '@/packages/qr-matrix';
import { drawRoundRect } from '@/packages/qr-matrix/canvas';
import { hexToRgba } from '@/utils/colorUtils';

/**
 * Standard high-resolution dimensions for each social media format.
 * Width × Height in pixels (portrait-first for Story/Portrait).
 */
export const SOCIAL_DIMENSIONS: Record<SocialFormat, { width: number; height: number }> = {
  [SocialFormat.SQUARE_1_1]: { width: 1080, height: 1080 },
  [SocialFormat.PORTRAIT_4_5]: { width: 1080, height: 1350 },
  [SocialFormat.STORY_9_16]: { width: 1080, height: 1920 },
};

/**
 * Resolves the effective template background color.
 * Returns `templateBgColor` if explicitly set, otherwise falls back to `bgColor`.
 */
function resolveTemplateBg(config: QRConfig): string {
  return config.templateBgColor ?? config.bgColor;
}

/**
 * Resolves the effective template text/accent color.
 * Returns `templateTextColor` if explicitly set, otherwise falls back to `fgColor`.
 */
function resolveTemplateText(config: QRConfig): string {
  return config.templateTextColor ?? config.fgColor;
}

// ---------------------------------------------------------------------------
// Private template background painters
// ---------------------------------------------------------------------------

/**
 * Fills the entire canvas with the QR code's background colour.
 * Used for TemplateStyle.NONE – no decorative chrome, just a solid colour.
 */
function drawNoneBackground(
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  width: number,
  height: number
): void {
  const bg = resolveTemplateBg(config);
  if (bg !== 'transparent') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
  }
}

/**
 * Minimalist template: solid bgColor background with a thin fg-coloured
 * rectangular frame, optional headline above the QR zone, and optional
 * subtext below the QR zone.
 */
function drawMinimalistBackground(
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  width: number,
  height: number
): void {
  const bg = resolveTemplateBg(config);
  const fg = resolveTemplateText(config);

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Outer decorative frame (stroke only, no fill)
  const frameInset = width * 0.03;
  ctx.strokeStyle = fg;
  ctx.lineWidth = Math.max(1, width * 0.008);
  ctx.strokeRect(
    frameInset,
    frameInset,
    width - 2 * frameInset,
    height - 2 * frameInset
  );
}

/**
 * Gradient-blur template: draws a few blurred blobs using fg/bg colours to
 * create a soft gradient background.  A semi-transparent overlay then
 * improves contrast for the QR code zone.
 */
function drawGradientBlurBackground(
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  width: number,
  height: number
): void {
  const bg = resolveTemplateBg(config);
  const fg = resolveTemplateText(config);

  // Base fill
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Draw soft radial blobs using fg colour at low opacity
  const blobRadius = width * 0.55;
  const blobs: Array<[number, number]> = [
    [width * 0.2, height * 0.2],
    [width * 0.8, height * 0.3],
    [width * 0.5, height * 0.8],
  ];

  for (const [bx, by] of blobs) {
    const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, blobRadius);
    gradient.addColorStop(0, hexToRgba(fg, 0.18));
    gradient.addColorStop(1, hexToRgba(fg, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
}

/**
 * Solid-frame template: uses fgColor as the outer border/frame and bgColor
 * as the inner background.
 */
function drawSolidFrameBackground(
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  width: number,
  height: number
): void {
  const bg = resolveTemplateBg(config);
  const fg = resolveTemplateText(config);

  // Outer solid band
  ctx.fillStyle = fg;
  ctx.fillRect(0, 0, width, height);

  // Inner recessed area
  const inset = width * 0.06;
  ctx.fillStyle = bg;
  ctx.fillRect(inset, inset, width - 2 * inset, height - 2 * inset);
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function drawTemplateText(
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  displayWidth: number,
  displayHeight: number,
  qrY: number,
  qrSize: number
): void {
  const headline = config.templateHeadline?.trim() ?? '';
  const subtext = config.templateSubtext?.trim() ?? '';

  if (!headline && !subtext) return;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = resolveTemplateText(config);

  if (headline) {
    const headlineFontSize = Math.round(displayWidth * 0.055);
    ctx.font = `bold ${headlineFontSize}px sans-serif`;
    const headlineY = qrY - headlineFontSize * 1.5;
    ctx.fillText(headline, displayWidth / 2, Math.max(headlineFontSize * 1.5, headlineY), displayWidth * 0.9);
  }

  if (subtext) {
    const subtextFontSize = Math.round(displayWidth * 0.038);
    ctx.font = `${subtextFontSize}px sans-serif`;
    const subtextY = qrY + qrSize + subtextFontSize * 1.5;
    ctx.fillText(subtext, displayWidth / 2, Math.min(displayHeight - subtextFontSize * 1.5, subtextY), displayWidth * 0.9);
  }
}

/**
 * Strategy map for template background rendering.
 */
type BackgroundPainter = (
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  width: number,
  height: number
) => void;

const BACKGROUND_PAINTERS: Record<TemplateStyle, BackgroundPainter> = {
  [TemplateStyle.NONE]: drawNoneBackground,
  [TemplateStyle.MINIMALIST]: drawMinimalistBackground,
  [TemplateStyle.GRADIENT_BLUR]: drawGradientBlurBackground,
  [TemplateStyle.SOLID_FRAME]: drawSolidFrameBackground,
};

// ---------------------------------------------------------------------------
// Main public API
// ---------------------------------------------------------------------------

/**
 * Composes a full-canvas social-media export by:
 *  1. Painting the chosen template background.
 *  2. Translating / scaling the coordinate system so the QR code fits in a
 *     centred bounding-box (50 % of canvas width).
 *  3. Calling {@link drawQRInternal} inside that bounding-box (Decorator
 *     pattern – no QR logic is duplicated here).
 *  4. Restoring the context and drawing optional headline/subtext.
 *
 * For `TemplateStyle.NONE` with a square format this is equivalent to a
 * direct `drawQRInternal` call, so it can replace the existing code path
 * without visual regression.
 *
 * @param ctx           The 2-D drawing context (canvas or SVG-context).
 * @param modules       The raw QR module matrix.
 * @param config        Full QR configuration including template settings.
 * @param logoImg       Pre-loaded centre logo image (or null).
 * @param borderLogoImg Pre-loaded border logo image (or null).
 * @param displayWidth  Logical display width in px (no devicePixelRatio applied).
 * @param displayHeight Logical display height in px.
 * @param moduleCount   Number of QR modules per row/column.
 */
export function drawWithTemplate(
  ctx: CanvasRenderingContext2D,
  modules: QRModules,
  config: QRConfig,
  logoImg: HTMLImageElement | null,
  borderLogoImg: HTMLImageElement | null,
  displayWidth: number,
  displayHeight: number,
  moduleCount: number,
  isVirtual: boolean = false,
  mazeData?: MazeData | null,
  options?: ModuleRenderOptions
): void {
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  // ── 1. Background ──────────────────────────────────────────────────────────
  const drawBackground = BACKGROUND_PAINTERS[config.templateStyle] ?? drawNoneBackground;
  drawBackground(ctx, config, displayWidth, displayHeight);

  // ── 2. QR Bounding-Box ────────────────────────────────────────────────────
  // For NONE template on a square canvas the QR fills 100 % so it looks
  // identical to the previous rendering path.
  const isNoneSquare =
    config.templateStyle === TemplateStyle.NONE &&
    config.socialFormat === SocialFormat.SQUARE_1_1;

  // User-controlled scale multiplier (clamped to valid range).
  const userScale = Math.min(1.5, Math.max(0.5, config.templateQrScale ?? 1.0));
  const baseQrFraction = isNoneSquare ? 1.0 : 0.5 * userScale;

  const qrSize = displayWidth * baseQrFraction;
  const qrX = (displayWidth - qrSize) / 2;
  const qrY = (displayHeight - qrSize) / 2;

  // ── 3. Safe-zone white rectangle behind the QR ────────────────────────────
  // When a template is active the template background may be dark.  Drawing a
  // white rounded rectangle (the QR code's own bgColor) behind the matrix
  // ensures scanners can always read the code regardless of template colours.
  if (!isNoneSquare) {
    const safePad = qrSize * 0.05;
    ctx.save();
    ctx.fillStyle = config.bgColor === 'transparent' ? '#ffffff' : config.bgColor; // always the QR's own background
    const r = qrSize * 0.04; // corner radius
    const rx = qrX - safePad;
    const ry = qrY - safePad;
    const rw = qrSize + safePad * 2;
    const rh = qrSize + safePad * 2;

    ctx.beginPath();
    drawRoundRect(ctx, rx, ry, rw, rh, r);
    ctx.fill();
    ctx.restore();
  }

  // ── 4. Draw QR Inside Bounding-Box ────────────────────────────────────────
  const ctxScale = qrSize / displayWidth;

  ctx.save();
  ctx.translate(qrX, qrY);
  ctx.scale(ctxScale, ctxScale);

  // drawQRInternal works in the logical [0, displayWidth] × [0, displayWidth]
  // coordinate space; we pass displayWidth as both width and height because
  // the QR is always square.
  if (mazeData !== undefined || options !== undefined) {
    drawQRInternal(
      ctx as unknown as CanvasRenderingContext2D,
      modules,
      config,
      logoImg,
      borderLogoImg,
      displayWidth,
      moduleCount,
      isVirtual,
      mazeData,
      options
    );
  } else {
    drawQRInternal(
      ctx as unknown as CanvasRenderingContext2D,
      modules,
      config,
      logoImg,
      borderLogoImg,
      displayWidth,
      moduleCount,
      isVirtual
    );
  }

  ctx.restore();

  // ── 5. Headline / Subtext ─────────────────────────────────────────────────
  if (config.templateStyle !== TemplateStyle.NONE) {
    drawTemplateText(ctx, config, displayWidth, displayHeight, qrY, qrSize);
  }
}
