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

import { useState, useEffect } from 'react';
import { setCachedAsset, convertImageToBase64 } from '@/packages/qr-export';

/**
 * Hook to load an image asynchronously.
 * Returns the HTMLImageElement once loaded, or null. While a new url loads it returns null, never
 * the previous url's image, so a repaint cannot draw the old logo under the new config (#1587).
 */
export const useImage = (url: string | null) => {
  const [loaded, setLoaded] = useState<{ url: string; img: HTMLImageElement } | null>(null);

  useEffect(() => {
    if (!url) {
      setLoaded(null);
      return;
    }
    const setImage = (img: HTMLImageElement | null) => setLoaded(img ? { url, img } : null);

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = url;

    const tryCache = (loadedImg: HTMLImageElement) => {
      if (url.startsWith('data:')) {
        setCachedAsset(url, url);
      } else {
        const base64 = convertImageToBase64(loadedImg);
        if (base64) {
          setCachedAsset(url, base64);
        }
      }
    };

    // If image is already cached and loaded immediately
    if (img.complete && img.naturalHeight !== 0) {
        setImage(img);
        tryCache(img);
        return;
    }

    img.onload = () => {
      setImage(img);
      tryCache(img);
    };
    img.onerror = () => setImage(null);

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [url]);

  return loaded && loaded.url === url ? loaded.img : null;
};
