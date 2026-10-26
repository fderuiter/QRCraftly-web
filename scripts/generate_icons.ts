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

/**
 * Draws the app icons and favicons in `public/` from one module grid (#1667). The SVG is written
 * as is; the PNGs are rasterised by headless Chromium. Run it by hand after changing the mark:
 *
 *   pnpm run icons:generate
 *
 * Set `QRC_CHROMIUM` to a Chromium binary when the one Playwright expects is not installed.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = process.env.ICONS_OUTPUT_DIR || path.resolve(__dirname, '../public');

/** Brand colours: teal-700 tile with white modules, and teal-400 with slate-900 for dark mode. */
const LIGHT = { tile: '#0f766e', module: '#ffffff' };
const DARK = { tile: '#2dd4bf', module: '#0f172a' };

/** The mark is a 15 by 15 module grid: three 7 by 7 finder patterns and a 7 by 7 data block. */
export const GRID = 15;
const FINDER = 7;
const DATA_ORIGIN = FINDER + 1;
const DATA_BLOCK = [
  '1011001',
  '0100101',
  '1101010',
  '0010110',
  '1011001',
  '0100101',
  '1101011',
];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Each finder is a one-module ring around a light gap and a 3 by 3 centre, as in a real QR code. */
function finderRects(x: number, y: number): Rect[] {
  return [
    { x, y, w: FINDER, h: 1 },
    { x, y: y + FINDER - 1, w: FINDER, h: 1 },
    { x, y: y + 1, w: 1, h: FINDER - 2 },
    { x: x + FINDER - 1, y: y + 1, w: 1, h: FINDER - 2 },
    { x: x + 2, y: y + 2, w: 3, h: 3 },
  ];
}

/** Every dark module of the mark, in grid units. */
export function markRects(): Rect[] {
  const rects = [
    ...finderRects(0, 0),
    ...finderRects(DATA_ORIGIN, 0),
    ...finderRects(0, DATA_ORIGIN),
  ];
  DATA_BLOCK.forEach((row, r) => {
    [...row].forEach((bit, c) => {
      if (bit === '1') rects.push({ x: DATA_ORIGIN + c, y: DATA_ORIGIN + r, w: 1, h: 1 });
    });
  });
  return rects;
}

/** The modules as one path, so neighbouring squares never show hairline seams when scaled. */
function markPath(): string {
  return markRects()
    .map(({ x, y, w, h }) => `M${x} ${y}h${w}v${h}h${-w}z`)
    .join('');
}

interface Layout {
  /** Canvas size in pixels of the 512 master; everything scales from it. */
  size: number;
  /** Tile inset from the canvas edge, and its corner radius. A full-bleed tile has inset 0. */
  tileInset: number;
  tileRadius: number;
  /** Width of the module grid. */
  markSize: number;
}

/**
 * `any` icons and favicons: a rounded tile with a transparent margin, the mark well inside the
 * rounded corners. `maskable` and Apple touch icons: a full-bleed square, with the mark inside the
 * central 80% circle (the maskable safe zone): its corners sit 255 / sqrt(2) = 180 px from the
 * centre of a 512 canvas, under the 204.8 px radius.
 */
const TILE: Layout = { size: 512, tileInset: 32, tileRadius: 96, markSize: 288 };
const FULL_BLEED: Layout = { size: 512, tileInset: 0, tileRadius: 0, markSize: 255 };

function iconSvg(layout: Layout, colors: { tile: string; module: string } = LIGHT, extraStyle = ''): string {
  const { size, tileInset, tileRadius, markSize } = layout;
  const tileSize = size - tileInset * 2;
  const offset = (size - markSize) / 2;
  const scale = markSize / GRID;
  const style = extraStyle ? `<style>${extraStyle}</style>` : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    style,
    `<rect class="tile" x="${tileInset}" y="${tileInset}" width="${tileSize}" height="${tileSize}" rx="${tileRadius}" fill="${colors.tile}"/>`,
    `<path class="mark" transform="translate(${offset} ${offset}) scale(${scale})" fill="${colors.module}" d="${markPath()}"/>`,
    '</svg>',
    '',
  ].join('');
}

/** The SVG favicon follows the operating system theme, since a tab bar can be light or dark. */
export function faviconSvg(): string {
  const dark = `@media (prefers-color-scheme: dark){.tile{fill:${DARK.tile}}.mark{fill:${DARK.module}}}`;
  return iconSvg(TILE, LIGHT, dark);
}

const PNG_OUTPUTS: { file: string; px: number; layout: Layout }[] = [
  { file: 'icon-192x192.png', px: 192, layout: TILE },
  { file: 'icon-512x512.png', px: 512, layout: TILE },
  { file: 'icon-192x192-maskable.png', px: 192, layout: FULL_BLEED },
  { file: 'icon-512x512-maskable.png', px: 512, layout: FULL_BLEED },
  { file: 'favicon.png', px: 192, layout: TILE },
  { file: 'favicon-32x32.png', px: 32, layout: TILE },
  // iOS fills transparent pixels with black and rounds the corners itself, so the touch icon is opaque.
  { file: 'apple-touch-icon.png', px: 180, layout: FULL_BLEED },
];

async function main(): Promise<void> {
  fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.svg'), faviconSvg());

  const browser = await chromium.launch({ executablePath: process.env.QRC_CHROMIUM || undefined });
  try {
    for (const { file, px, layout } of PNG_OUTPUTS) {
      const page = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
      const svg = iconSvg(layout).replace('<svg ', `<svg width="${px}" height="${px}" `);
      await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
      await page.locator('svg').screenshot({ path: path.join(PUBLIC_DIR, file), omitBackground: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`[Icons] Wrote favicon.svg and ${PNG_OUTPUTS.length} PNG icons to ${PUBLIC_DIR}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
