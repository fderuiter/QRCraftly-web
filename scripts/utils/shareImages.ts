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

import { planMosaic, rasterizeMosaic, type MosaicMode, type MosaicSource } from '../../src/packages/qr-matrix/mosaic';
import { createCanvas, drawText, drawable, encodePng, encodeRgbPng, fillRect, lineHeight, textWidth, wrapText, type Rgb } from './pixelImage';

/** The module grid of a QR code: its side length and whether a module is dark. */
export interface ModuleGrid {
  size: number;
  get(row: number, col: number): boolean;
}

import { SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH } from '../../src/data/shareImageSize';

export { SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH };

const PALETTE: Rgb[] = [
  [15, 23, 42], // 0 background, slate 900
  [255, 255, 255], // 1 QR panel and heading
  [15, 23, 42], // 2 dark modules
  [129, 140, 248], // 3 accent bar and domain, indigo 400
  [148, 163, 184], // 4 secondary text, slate 400
];
const BG = 0;
const WHITE = 1;
const DARK = 2;
const ACCENT = 3;
const MUTED = 4;

const MARGIN = 64;
const PANEL = 440;
const QUIET_ZONE = 4;

/**
 * Picks the largest text scale at which the heading fits in the given lines and width.
 * @param text - Drawable heading.
 * @param maxWidth - Available width in pixels.
 * @param maxLines - Most lines allowed.
 * @returns The scale and wrapped lines.
 */
function fitHeading(text: string, maxWidth: number, maxLines: number): { scale: number; lines: string[] } {
  for (const scale of [10, 9, 8, 7, 6, 5]) {
    const lines = wrapText(text, scale, maxWidth);
    if (lines.length <= maxLines && lines.every((line) => textWidth(line, scale) <= maxWidth)) return { scale, lines };
  }
  return { scale: 4, lines: wrapText(text, 4, maxWidth).slice(0, maxLines) };
}

/**
 * Draws a page's share image: its heading beside a real, scannable QR code of its address.
 * @param heading - The page heading.
 * @param domainLabel - The site name shown under the heading.
 * @param grid - Modules of the QR code to show.
 * @returns PNG file bytes.
 */
export function renderShareImage(heading: string, domainLabel: string, grid: ModuleGrid): Buffer {
  const canvas = createCanvas(SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT, PALETTE);
  fillRect(canvas, 0, 0, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT, BG);
  fillRect(canvas, 0, 0, 16, SHARE_IMAGE_HEIGHT, ACCENT);

  const panelX = SHARE_IMAGE_WIDTH - MARGIN - PANEL;
  const panelY = (SHARE_IMAGE_HEIGHT - PANEL) / 2;
  fillRect(canvas, panelX, panelY, PANEL, PANEL, WHITE);
  const modulePx = Math.max(1, Math.floor(PANEL / (grid.size + QUIET_ZONE * 2)));
  const drawn = modulePx * (grid.size + QUIET_ZONE * 2);
  const originX = panelX + Math.floor((PANEL - drawn) / 2) + QUIET_ZONE * modulePx;
  const originY = panelY + Math.floor((PANEL - drawn) / 2) + QUIET_ZONE * modulePx;
  for (let row = 0; row < grid.size; row++) {
    for (let col = 0; col < grid.size; col++) {
      if (grid.get(row, col)) fillRect(canvas, originX + col * modulePx, originY + row * modulePx, modulePx, modulePx, DARK);
    }
  }

  const textWidthLimit = panelX - MARGIN - 48;
  const { scale, lines } = fitHeading(drawable(heading) || 'QRCRAFTLY', textWidthLimit, 5);
  const step = Math.round(lineHeight(scale) * 1.2);
  const blockHeight = (lines.length - 1) * step + lineHeight(scale);
  let y = Math.round((SHARE_IMAGE_HEIGHT - blockHeight) / 2) - 24;
  for (const line of lines) {
    drawText(canvas, line, MARGIN + 16, y, scale, WHITE);
    y += step;
  }
  drawText(canvas, drawable(domainLabel), MARGIN + 16, SHARE_IMAGE_HEIGHT - MARGIN - lineHeight(6), 6, ACCENT);
  drawText(canvas, 'FREE STATIC QR CODES', MARGIN + 16, SHARE_IMAGE_HEIGHT - MARGIN - lineHeight(6) - 48, 4, MUTED);
  return encodePng(canvas);
}

/**
 * Draws a QR code as a small SVG: one path, with a white quiet zone.
 * @param grid - Modules of the QR code.
 * @returns SVG markup.
 */
export function renderExampleSvg(grid: ModuleGrid): string {
  const total = grid.size + QUIET_ZONE * 2;
  let path = '';
  for (let row = 0; row < grid.size; row++) {
    let col = 0;
    while (col < grid.size) {
      if (!grid.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < grid.size && grid.get(row, col)) col++;
      path += `M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${col - start}v1h-${col - start}z`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total * 8}" height="${total * 8}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#0f172a"/></svg>`
  );
}

/** Side of the demonstration picture the mosaic examples are built from. */
const DEMO_IMAGE_SIZE = 256;
/** Pixels per module in the mosaic example PNGs (a multiple of 3, the halftone subdivision). */
const MOSAIC_PIXELS_PER_MODULE = 12;

/**
 * Paints the picture behind the mosaic examples: a sun over a striped sea. It is drawn in code,
 * so the examples need no photo, no AI and no licence.
 * @returns An opaque RGBA image.
 */
export function createDemoImage(): MosaicSource {
  const size = DEMO_IMAGE_SIZE;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const horizon = size * 0.62;
      let rgb: Rgb;
      if (y < horizon) {
        const t = y / horizon;
        rgb = [Math.round(250 - 90 * t), Math.round(130 + 50 * t), Math.round(40 + 140 * t)];
      } else {
        const stripe = Math.floor((y - horizon) / 9) % 2 === 0;
        rgb = stripe ? [20, 60, 120] : [40, 110, 170];
      }
      if (Math.hypot(x - size * 0.5, y - size * 0.46) < size * 0.2) rgb = [255, 214, 70];
      const at = (y * size + x) * 4;
      data.set([rgb[0], rgb[1], rgb[2], 255], at);
    }
  }
  return { width: size, height: size, data };
}

/**
 * Renders a Mosaic QR example (ADR 0019) as a PNG: the demonstration picture tiled into the
 * modules of the code, each module keeping its dark or light value.
 * @param grid - Modules of the QR code.
 * @param mode - Tile layout.
 * @returns The PNG file bytes.
 */
export function renderMosaicExamplePng(grid: ModuleGrid, mode: MosaicMode): Buffer {
  const plan = planMosaic(grid, createDemoImage(), { mode, contrast: 0.5 });
  const { width, height, data } = rasterizeMosaic(plan, MOSAIC_PIXELS_PER_MODULE, QUIET_ZONE);
  return encodeRgbPng(width, height, data);
}
