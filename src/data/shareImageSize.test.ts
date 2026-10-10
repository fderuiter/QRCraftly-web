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


import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auxiliaryRegistry, contentRegistry, legacyRouteRegistry } from './contentRegistry';
import { FALLBACK_SHARE_IMAGE_HEIGHT, FALLBACK_SHARE_IMAGE_WIDTH, getShareImageSize, SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH } from './shareImageSize';

/**
 * Reads the width and height from a PNG's IHDR chunk.
 * @param path - File path.
 * @returns The pixel size.
 */
function pngSize(path: string): { width: number; height: number } {
  const png = readFileSync(path);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('getShareImageSize', () => {
  it('gives generated share images their drawn size', () => {
    expect(getShareImageSize('/og/wifi-qr-code.png')).toEqual({ width: SHARE_IMAGE_WIDTH, height: SHARE_IMAGE_HEIGHT });
    expect(getShareImageSize('https://qrcraftly.com/og/index.png')).toEqual({ width: 1200, height: 630 });
  });

  it('matches the fallback image file in public/', () => {
    expect(pngSize('public/og-image.png')).toEqual({ width: FALLBACK_SHARE_IMAGE_WIDTH, height: FALLBACK_SHARE_IMAGE_HEIGHT });
    expect(getShareImageSize('/og-image.png?type=arcade')).toEqual(pngSize('public/og-image.png'));
  });

  it('knows the size of every image a page declares', () => {
    const pages = [...Object.values(contentRegistry), ...Object.values(auxiliaryRegistry), ...Object.values(legacyRouteRegistry)];
    for (const page of pages) expect(getShareImageSize(page.image), page.id).not.toBeNull();
  });

  it('declares no size for an image it does not know', () => {
    expect(getShareImageSize('https://example.com/picture.jpg')).toBeNull();
  });
});
