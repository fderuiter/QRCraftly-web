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


/** Share image size: the 1.91:1 card that Open Graph and X crop to. `scripts/utils/shareImages.ts` draws every `/og/<id>.png` at this size. */
export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;

/** Size of `public/og-image.png`, the fallback image of pages without their own share image. */
export const FALLBACK_SHARE_IMAGE_WIDTH = 1280;
export const FALLBACK_SHARE_IMAGE_HEIGHT = 720;

/**
 * The real pixel size of a page's share image, for `og:image:width` and `og:image:height` (#1265).
 * @param image - The image path or absolute URL the page declares.
 * @returns Its width and height, or null when the image is not one the build makes or ships.
 */
export function getShareImageSize(image: string): { width: number; height: number } | null {
  const path = image.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '');
  if (/^\/og\/[a-z0-9-]+\.png$/.test(path)) return { width: SHARE_IMAGE_WIDTH, height: SHARE_IMAGE_HEIGHT };
  if (path === '/og-image.png' || path === '') return { width: FALLBACK_SHARE_IMAGE_WIDTH, height: FALLBACK_SHARE_IMAGE_HEIGHT };
  return null;
}
