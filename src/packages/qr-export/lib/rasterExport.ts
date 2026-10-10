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

import { QRConfig, SocialFormat, TemplateStyle } from '@/types';
import { validateConfig } from '@/packages/qr-payload';
import { buildMatrix, drawQRInternal, loadQrEncoder } from '@/packages/qr-matrix';
import { generateMaze, getCachedMaze, getMazeCacheKey, storeMaze, type MazeData } from '@/packages/qr-matrix/maze';
import { loadMosaicSource } from '@/packages/qr-matrix/mosaic';
import { drawWithTemplate, SOCIAL_DIMENSIONS } from './templateRenderer';
import { PayloadRejectedError } from './svgExport';

/** How long an export waits for a logo image before drawing without it. */
const IMAGE_LOAD_TIMEOUT_MS = 5000;

/** Loads an image for drawing, or resolves `null` when it cannot be loaded in time. */
function loadImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    let settled = false;
    const finish = (value: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), IMAGE_LOAD_TIMEOUT_MS);
    img.onload = () => finish(img.naturalWidth > 0 ? img : null);
    img.onerror = () => finish(null);
    img.src = url;
    if (img.complete && img.naturalWidth > 0) finish(img);
  });
}

/**
 * Renders the code for `config` onto a new canvas `width` pixels wide, with the same renderer
 * as the preview. Raster exports use this instead of copying the preview canvas, so a file
 * always encodes the current content (#1252) and is drawn at its full size (#1256).
 *
 * @param config - The configuration to draw.
 * @param width - Output width in pixels; the height follows the social format.
 * @throws PayloadRejectedError when the content fails validation, and the encoder's
 *   `QrEncodeError` when it cannot be encoded (for example when it is too long).
 */
export async function renderQRRaster(config: QRConfig, width: number): Promise<HTMLCanvasElement> {
  const violations = validateConfig(config);
  if (violations.length > 0) throw new PayloadRejectedError(violations);

  const modules = buildMatrix(config, await loadQrEncoder());
  const moduleCount = modules.size;

  const [logoImg, borderLogoImg] = await Promise.all([
    loadImage(config.logoUrl),
    loadImage(config.isBorderEnabled ? config.borderLogoUrl : null),
    config.mosaicImageUrl ? loadMosaicSource(config.mosaicImageUrl) : null,
  ]);

  let mazeData: MazeData | null = null;
  if (config.isMazeEnabled) {
    const key = getMazeCacheKey(config, moduleCount, modules);
    mazeData = getCachedMaze(key) ?? null;
    if (!mazeData) {
      mazeData = generateMaze(modules, config, moduleCount);
      storeMaze(key, mazeData);
    }
  }

  const useTemplate = config.templateStyle !== TemplateStyle.NONE || config.socialFormat !== SocialFormat.SQUARE_1_1;
  const { width: frameWidth, height: frameHeight } = SOCIAL_DIMENSIONS[config.socialFormat] ?? { width: 1, height: 1 };
  const outWidth = Math.max(1, Math.round(width));
  const outHeight = useTemplate ? Math.max(1, Math.round((outWidth * frameHeight) / frameWidth)) : outWidth;

  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');

  if (useTemplate) {
    drawWithTemplate(ctx, modules, config, logoImg, borderLogoImg, outWidth, outHeight, moduleCount, false, mazeData);
  } else {
    ctx.clearRect(0, 0, outWidth, outHeight);
    drawQRInternal(ctx, modules, config, logoImg, borderLogoImg, outWidth, moduleCount, false, mazeData);
  }
  return canvas;
}
