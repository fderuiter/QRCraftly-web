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

import type { PassColors } from '@/packages/wallet-pass';

/**
 * Draws the images an Apple pass carries, on the device. The icon (required by Apple, shown in
 * notifications) is a QR-style glyph in the pass colours; the logo is the design's own uploaded
 * logo, used only when it is already in the page as a `data:` or `blob:` image, so making a pass
 * never fetches anything.
 */

/** Icon sizes for 1x, 2x and 3x screens, in pixels. */
const ICON_SIZES = { 'icon.png': 29, 'icon@2x.png': 58, 'icon@3x.png': 87 } as const;
/** The logo's box on a generic pass at 1x, in points. */
const LOGO_BOX = { width: 160, height: 50 } as const;

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  return { canvas, ctx };
}

async function png(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('This browser could not make the pass images.'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Three finder-pattern squares on the pass background: a small, recognisable QR mark. */
function drawIcon(ctx: CanvasRenderingContext2D, size: number, colors: PassColors): void {
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, size, size);
  const unit = size / 9;
  for (const [x, y] of [
    [1, 1],
    [5, 1],
    [1, 5],
  ]) {
    ctx.fillStyle = colors.foreground;
    ctx.fillRect(x * unit, y * unit, unit * 3, unit * 3);
    ctx.fillStyle = colors.background;
    ctx.fillRect((x + 0.75) * unit, (y + 0.75) * unit, unit * 1.5, unit * 1.5);
    ctx.fillStyle = colors.foreground;
    ctx.fillRect((x + 1.125) * unit, (y + 1.125) * unit, unit * 0.75, unit * 0.75);
  }
  ctx.fillRect(5.5 * unit, 5.5 * unit, unit * 2, unit * 2);
}

function loadLocalImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url || !/^(data:image\/|blob:)/.test(url)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Renders `icon.png` at three sizes and, when the design has a local logo, `logo.png` at 1x and 2x.
 * @param colors - The pass colours.
 * @param logoUrl - The design's logo, if any.
 */
export async function renderPassImages(colors: PassColors, logoUrl?: string | null): Promise<Record<string, Uint8Array>> {
  const images: Record<string, Uint8Array> = {};
  for (const [name, size] of Object.entries(ICON_SIZES)) {
    const { canvas, ctx } = canvasOf(size, size);
    drawIcon(ctx, size, colors);
    images[name] = await png(canvas);
  }
  const logo = await loadLocalImage(logoUrl);
  if (logo) {
    for (const [name, scale] of [
      ['logo.png', 1],
      ['logo@2x.png', 2],
    ] as const) {
      const fit = Math.min((LOGO_BOX.width * scale) / logo.naturalWidth, (LOGO_BOX.height * scale) / logo.naturalHeight);
      const { canvas, ctx } = canvasOf(Math.max(1, Math.round(logo.naturalWidth * fit)), Math.max(1, Math.round(logo.naturalHeight * fit)));
      ctx.drawImage(logo, 0, 0, canvas.width, canvas.height);
      images[name] = await png(canvas);
    }
  }
  return images;
}
