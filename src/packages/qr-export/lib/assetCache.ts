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

const cache = new Map<string, string>();

/**
 * Retrieves a base64 data-URI for a cached image asset if it exists.
 * @param url The original image asset URL.
 */
export const getCachedAsset = (url: string): string | null => {
  if (!url) return null;
  return cache.get(url) || null;
};

/**
 * Stores a base64 data-URI in the cache.
 * @param url The original image asset URL.
 * @param base64 The base64 data-URI representation of the asset.
 */
export const setCachedAsset = (url: string, base64: string): void => {
  if (!url || !base64) return;
  cache.set(url, base64);
};

/**
 * Clears the in-memory asset cache.
 */
export const clearAssetCache = (): void => {
  cache.clear();
};

/**
 * Helper to convert a loaded HTMLImageElement into a Base64 data-URI using an offscreen canvas.
 * Returns null if the conversion fails (e.g., due to CORS taint, invalid dimensions, or non-browser environments).
 * @param img The loaded HTMLImageElement.
 */
export const convertImageToBase64 = (img: HTMLImageElement): string | null => {
  try {
    if (typeof document === 'undefined') {
      return null;
    }
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL();
  } catch {
    // Gracefully fallback on canvas taint/CORS/error
    return null;
  }
};

