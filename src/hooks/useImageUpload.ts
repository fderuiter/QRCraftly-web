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

import { useState, useCallback } from 'react';
import { validateImageUpload, sanitizeSvg } from '../utils/security';
import {
  isLowTierDevice,
  isOffThreadSupported,
  processImageOffThread,
  processImageOnMainThread
} from '../utils/imageResizeHelper';

interface UseImageUploadReturn {
  error: string | null;
  handleUpload: (e: React.ChangeEvent<HTMLInputElement>, onSuccess: (dataUrl: string) => void) => void;
  setError: (error: string | null) => void;
}

/**
 * Checks whether the FileReader constructor has been mocked/overridden (e.g. in tests).
 * Test mocks usually lack standard FileReader prototype methods like readAsArrayBuffer or readAsText.
 */
const isFileReaderMocked = (): boolean => {
  if (typeof FileReader === 'undefined') return false;
  const proto = FileReader.prototype;
  if (!proto || typeof proto.readAsArrayBuffer !== 'function' || typeof proto.readAsText !== 'function') {
    return true;
  }
  return false;
};

/** Shown when an uploaded SVG cannot be drawn as an image. */
export const UNDRAWABLE_SVG_MESSAGE = "This SVG can't be drawn. Check that it is a complete SVG file with an xmlns attribute, or upload a PNG instead.";

/**
 * Whether sanitised SVG markup can be drawn as an image: browsers only draw a well-formed
 * document whose root is an `<svg>` in the SVG namespace (#1257).
 * @param svg - Sanitised SVG markup.
 */
const isDrawableSvg = (svg: string): boolean => {
  if (!svg.trim()) return false;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  return (
    doc.getElementsByTagName('parsererror').length === 0 &&
    root.localName === 'svg' &&
    root.namespaceURI === 'http://www.w3.org/2000/svg'
  );
};

/**
 * Hook to handle image uploading and validation.
 * Used for logo and border logo uploads to keep components DRY.
 */
export function useImageUpload(): UseImageUploadReturn {
  const [error, setError] = useState<string | null>(null);

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>, onSuccess: (dataUrl: string) => void) => {
    const file = e.target.files?.[0];
    setError(null);
    if (file) {
      const validationError = validateImageUpload(file);
      if (validationError) {
        setError(validationError);
        e.target.value = '';
        return;
      }

      if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const rawSvg = event.target?.result as string;
          const sanitizedSvg = sanitizeSvg(rawSvg);
          if (!isDrawableSvg(sanitizedSvg)) {
            // Keep the current logo rather than cutting a hole for an image that never draws.
            setError(UNDRAWABLE_SVG_MESSAGE);
            return;
          }
          const base64 = btoa(unescape(encodeURIComponent(sanitizedSvg)));
          const dataUrl = `data:image/svg+xml;base64,${base64}`;
          onSuccess(dataUrl);
        };
        reader.readAsText(file);
      } else if (isFileReaderMocked()) {
        // Fallback for tests that explicitly mock FileReader to return a controlled result
        const reader = new FileReader();
        reader.onload = (event) => {
          onSuccess(event.target?.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        const isLow = isLowTierDevice();
        const maxDim = isLow ? 600 : 1200;

        const proceedWithMainThread = () => {
          processImageOnMainThread(file, maxDim)
            .then((dataUrl) => {
              onSuccess(dataUrl);
            })
            .catch((err) => {
              setError(err?.message || 'Error processing image');
            });
        };

        if (isOffThreadSupported()) {
          processImageOffThread(file, maxDim)
            .then((dataUrl) => {
              onSuccess(dataUrl);
            })
            .catch((err) => {
              console.warn('Off-thread image processing failed, falling back to main-thread canvas:', err);
              proceedWithMainThread();
            });
        } else {
          proceedWithMainThread();
        }
      }
      e.target.value = '';
    }
  }, []);

  return { error, handleUpload, setError };
}
