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

import { type QRConfig, type QRModules, QRType, SocialFormat, TemplateStyle, WifiEncryption, type WifiData } from '@/types';
import { drawQRInternal, type ModuleRenderOptions, type MazeData } from '@/packages/qr-matrix';
import { drawRoundRect } from '@/packages/qr-matrix/canvas';
import { hexToRgba, getContrastRatio } from '@/packages/core/encoding';
import { hydrateWifiData } from '@/packages/qr-payload';

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

/**
 * Wi-Fi Display Card template: fills the background and draws an outer sign border.
 */
function drawWifiCardBackground(
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  width: number,
  height: number
): void {
  const bg = resolveTemplateBg(config);
  const fg = resolveTemplateText(config);

  // Background
  if (bg !== 'transparent') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
  }

  // Outer decorative card border
  const inset = width * 0.025;
  const radius = width * 0.03;
  ctx.strokeStyle = fg;
  ctx.lineWidth = Math.max(2, width * 0.006);
  ctx.beginPath();
  drawRoundRect(ctx, inset, inset, width - 2 * inset, height - 2 * inset, radius);
  ctx.stroke();
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
 * Renders the Wi-Fi card sign header (Wi-Fi badge icon & heading) and network detail badges.
 */
function drawWifiCardChrome(
  ctx: CanvasRenderingContext2D,
  config: QRConfig,
  displayWidth: number,
  displayHeight: number,
  qrY: number,
  qrSize: number
): void {
  const fg = resolveTemplateText(config);
  const bg = resolveTemplateBg(config);
  const safePad = qrSize * 0.05;

  // Header Area: Top to QR Safe-Zone
  const headerTop = displayWidth * 0.03;
  const headerBottom = qrY - safePad;
  const headerHeight = Math.max(0, headerBottom - headerTop);

  // Wi-Fi Badge Icon & Heading
  const iconRadius = Math.min(displayWidth * 0.035, headerHeight * 0.22);
  const badgeCircleR = iconRadius * 1.3;
  const headline = config.templateHeadline?.trim() || 'Connect to Wi-Fi';

  // Enforce minimum headline size >= 4% of displayWidth
  const minHeadlineFontSize = Math.round(displayWidth * 0.04);
  let headlineFontSize = Math.max(minHeadlineFontSize, Math.round(Math.min(displayWidth * 0.048, headerHeight * 0.28)));

  const maxHeadlineWidth = displayWidth * 0.85;
  ctx.font = `bold ${headlineFontSize}px sans-serif`;
  while (ctx.measureText(headline).width > maxHeadlineWidth && headlineFontSize > minHeadlineFontSize) {
    headlineFontSize -= 1;
    ctx.font = `bold ${headlineFontSize}px sans-serif`;
  }

  const totalHeaderContentHeight = badgeCircleR * 2 + headlineFontSize * 1.0;
  const headerCenterY = headerTop + headerHeight / 2;
  const iconY = Math.max(headerTop + badgeCircleR, headerCenterY - totalHeaderContentHeight / 2 + badgeCircleR);
  const iconX = displayWidth / 2;

  ctx.save();
  // Badge background circle
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.arc(iconX, iconY, badgeCircleR, 0, Math.PI * 2);
  ctx.fill();

  // Wi-Fi Signal Arcs inside badge
  const effectiveBg = bg === 'transparent'
    ? (getContrastRatio(fg, '#ffffff') >= getContrastRatio(fg, '#000000') ? '#ffffff' : '#000000')
    : bg;
  ctx.strokeStyle = effectiveBg;
  ctx.fillStyle = effectiveBg;
  ctx.lineWidth = Math.max(1.5, iconRadius * 0.2);

  // Outer Arc
  ctx.beginPath();
  ctx.arc(iconX, iconY + iconRadius * 0.3, iconRadius, -Math.PI * 0.75, -Math.PI * 0.25);
  ctx.stroke();

  // Middle Arc
  ctx.beginPath();
  ctx.arc(iconX, iconY + iconRadius * 0.3, iconRadius * 0.65, -Math.PI * 0.75, -Math.PI * 0.25);
  ctx.stroke();

  // Inner Arc
  ctx.beginPath();
  ctx.arc(iconX, iconY + iconRadius * 0.3, iconRadius * 0.3, -Math.PI * 0.75, -Math.PI * 0.25);
  ctx.stroke();

  // Center Dot
  ctx.beginPath();
  ctx.arc(iconX, iconY + iconRadius * 0.35, iconRadius * 0.12, 0, Math.PI * 2);
  ctx.fill();

  // Heading Text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  ctx.font = `bold ${headlineFontSize}px sans-serif`;
  const headingY = iconY + badgeCircleR + headlineFontSize * 0.8;
  if (ctx.measureText(headline).width > maxHeadlineWidth) {
    ctx.fillText(headline, displayWidth / 2, headingY, maxHeadlineWidth);
  } else {
    ctx.fillText(headline, displayWidth / 2, headingY);
  }
  ctx.restore();

  // Bottom Area: QR Safe-Zone to Canvas Bottom
  const bottomTop = qrY + qrSize + safePad;
  const bottomHeight = displayHeight - bottomTop - displayWidth * 0.03;
  const bottomCenterY = bottomTop + bottomHeight / 2;

  // Hydrate Wi-Fi payload
  let wifiData: WifiData | null = null;
  try {
    wifiData = hydrateWifiData(config.value);
  } catch {
    wifiData = null;
  }

  const ssid = wifiData?.ssid || 'Wi-Fi Network';
  const isOpenNetwork = wifiData?.encryption === WifiEncryption.NOPASS;
  const isWpa2Eap = wifiData?.encryption === WifiEncryption.WPA2_EAP;

  let passLabel = 'PASSWORD';
  let passVal = wifiData?.password || '';

  if (isOpenNetwork) {
    passLabel = 'PASSWORD';
    passVal = 'No password needed';
  } else if (isWpa2Eap && !wifiData?.password) {
    passLabel = 'SIGN-IN';
    passVal = 'Sign in with your network account';
  }

  const badgeW = displayWidth * 0.84;
  const minBadgeH = displayWidth * 0.075;
  const badgeH = Math.max(minBadgeH, Math.min(displayWidth * 0.085, bottomHeight * 0.38));
  const badgeGap = displayWidth * 0.018;
  const totalBadgesH = badgeH * 2 + badgeGap;
  const badgeX = (displayWidth - badgeW) / 2;
  const badge1Y = bottomCenterY - totalBadgesH / 2;
  const badge2Y = badge1Y + badgeH + badgeGap;
  const padX = badgeW * 0.04;

  const drawBadge = (
    y: number,
    label: string,
    val: string,
    isMonospace: boolean
  ) => {
    ctx.save();
    // Badge background fill
    ctx.fillStyle = hexToRgba(fg, 0.08);
    ctx.strokeStyle = fg;
    ctx.lineWidth = Math.max(1, displayWidth * 0.002);
    ctx.beginPath();
    drawRoundRect(ctx, badgeX, y, badgeW, badgeH, displayWidth * 0.015);
    ctx.fill();
    ctx.stroke();

    // Label
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const labelFontSize = Math.max(Math.round(displayWidth * 0.018), Math.round(badgeH * 0.25));
    ctx.font = `bold ${labelFontSize}px sans-serif`;
    ctx.fillText(label, badgeX + padX, y + badgeH * 0.3, badgeW - padX * 2);

    // Value
    const maxValWidth = badgeW - padX * 2;
    const initialValFontSize = Math.max(Math.round(displayWidth * 0.025), Math.round(badgeH * 0.36));
    const floorValFontSize = Math.round(displayWidth * 0.022);

    let valFontSize = initialValFontSize;
    let fontStyle = isMonospace ? `bold ${valFontSize}px monospace` : `bold ${valFontSize}px sans-serif`;
    ctx.font = fontStyle;
    let textWidth = ctx.measureText(val).width;

    while (textWidth > maxValWidth && valFontSize > floorValFontSize) {
      valFontSize -= 1;
      fontStyle = isMonospace ? `bold ${valFontSize}px monospace` : `bold ${valFontSize}px sans-serif`;
      ctx.font = fontStyle;
      textWidth = ctx.measureText(val).width;
    }

    if (textWidth > maxValWidth) {
      ctx.fillText(val, badgeX + padX, y + badgeH * 0.7, maxValWidth);
    } else {
      ctx.fillText(val, badgeX + padX, y + badgeH * 0.7);
    }
    ctx.restore();
  };

  drawBadge(badge1Y, 'NETWORK', ssid, false);
  drawBadge(badge2Y, passLabel, passVal, passLabel === 'PASSWORD');
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
  [TemplateStyle.WIFI_CARD]: drawWifiCardBackground,
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

  // Fallback WIFI_CARD to SOLID_FRAME if payload type is not QRType.WIFI
  const activeTemplateStyle =
    config.templateStyle === TemplateStyle.WIFI_CARD && config.type !== QRType.WIFI
      ? TemplateStyle.SOLID_FRAME
      : config.templateStyle;

  // ── 1. Background ──────────────────────────────────────────────────────────
  const drawBackground = BACKGROUND_PAINTERS[activeTemplateStyle] ?? drawNoneBackground;
  drawBackground(ctx, config, displayWidth, displayHeight);

  // ── 2. QR Bounding-Box ────────────────────────────────────────────────────
  // For NONE template on a square canvas the QR fills 100 % so it looks
  // identical to the previous rendering path.
  const isNoneSquare =
    activeTemplateStyle === TemplateStyle.NONE &&
    config.socialFormat === SocialFormat.SQUARE_1_1;

  // User-controlled scale multiplier (clamped to valid range).
  let userScale = Math.min(1.5, Math.max(0.5, config.templateQrScale ?? 1.0));
  if (activeTemplateStyle === TemplateStyle.WIFI_CARD) {
    userScale = Math.min(
      userScale,
      config.socialFormat === SocialFormat.SQUARE_1_1 ? 1.0 : 1.2
    );
  }
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

  // ── 5. Headline / Subtext / Wi-Fi Card Chrome ────────────────────────────
  if (activeTemplateStyle !== TemplateStyle.NONE) {
    if (activeTemplateStyle === TemplateStyle.WIFI_CARD) {
      drawWifiCardChrome(ctx, config, displayWidth, displayHeight, qrY, qrSize);
    } else {
      drawTemplateText(ctx, config, displayWidth, displayHeight, qrY, qrSize);
    }
  }
}
