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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let env: Record<string, string> = {};
try {
  env = loadEnv(process.env.NODE_ENV || 'production', process.cwd(), '');
} catch (error) {
  console.warn('[ShareImages] Failed to load env via Vite loadEnv:', error);
}
process.env.VITE_DOMAIN = env.VITE_DOMAIN || process.env.VITE_DOMAIN || 'https://qrcraftly.com';

const { contentRegistry, auxiliaryRegistry } = await import('../src/data/contentRegistry');
const { TYPE_PAGE_TYPES } = await import('../src/data/relatedPages');
const { buildMatrix, loadQrEncoder } = await import('../src/packages/qr-matrix');
const { getSamplePayload } = await import('../src/packages/qr-payload');
const { QRType, QRErrorCorrectionLevel } = await import('../src/packages/core/types');
const { resolvePublicUrl } = await import('../src/utils/metadataEngine');
const { renderExampleSvg, renderMosaicExamplePng, renderShareImage } = await import('./utils/shareImages');

const CLIENT_DIR = process.env.SHARE_IMAGES_DIST_DIR || path.resolve(__dirname, '../dist/client');
const OG_PREFIX = '/og/';

/**
 * Writes one share image per registry entry that points at /og/, each carrying a real QR code
 * of the page's own address, and one example SVG per generator page (#1030, #1031).
 */
async function main(): Promise<void> {
  const encoder = await loadQrEncoder();
  const domainLabel = new URL(resolvePublicUrl('/')).host;
  const ogDir = path.join(CLIENT_DIR, 'og');
  const examplesDir = path.join(CLIENT_DIR, 'examples');
  fs.mkdirSync(ogDir, { recursive: true });
  fs.mkdirSync(examplesDir, { recursive: true });

  let shareCount = 0;
  for (const entry of [...Object.values(contentRegistry), ...Object.values(auxiliaryRegistry)]) {
    if (!entry.image.startsWith(OG_PREFIX)) continue;
    const route = entry.id === 'index' ? '/' : `/${entry.id}`;
    const grid = buildMatrix(
      { type: QRType.URL, value: resolvePublicUrl(route), errorCorrectionLevel: QRErrorCorrectionLevel.M },
      encoder
    );
    const heading = 'seoTitle' in entry && entry.seoTitle ? entry.seoTitle.split(/\s[-|]\s/)[0] : entry.name;
    fs.writeFileSync(path.join(CLIENT_DIR, entry.image.slice(1)), renderShareImage(heading, domainLabel, grid));
    shareCount++;
  }

  for (const [id, type] of Object.entries(TYPE_PAGE_TYPES)) {
    const grid = buildMatrix(
      { type, value: getSamplePayload(type), errorCorrectionLevel: QRErrorCorrectionLevel.M },
      encoder
    );
    fs.writeFileSync(path.join(examplesDir, `${id}.svg`), renderExampleSvg(grid));
  }
  const mosaicGrid = buildMatrix(
    { type: QRType.URL, value: resolvePublicUrl('/'), errorCorrectionLevel: QRErrorCorrectionLevel.H },
    encoder
  );
  for (const mode of ['halftone', 'tiles'] as const) {
    fs.writeFileSync(path.join(examplesDir, `mosaic-${mode}.png`), renderMosaicExamplePng(mosaicGrid, mode));
  }
  console.log(`[ShareImages] Wrote ${shareCount} share images, ${Object.keys(TYPE_PAGE_TYPES).length} example SVGs and 2 mosaic examples.`);
}

await main();
