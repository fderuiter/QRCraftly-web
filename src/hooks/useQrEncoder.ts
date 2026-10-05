/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import { useEffect, useState } from 'react';
import type { QrEncoder } from '@/packages/qr-matrix';
import { getQrCanvasRuntime } from '@/utils/qrCanvasRuntime';

/**
 * The main-thread QR encoder, from the same runtime `QRCanvas` uses.
 * @returns The encoder, or null until it has loaded (always null during pre-rendering).
 */
export function useQrEncoder(): QrEncoder | null {
  const [encoder, setEncoder] = useState<QrEncoder | null>(() => {
    // Pre-rendering has no encoder to fetch; the effect below reports a failed load in the browser.
    if (typeof window === 'undefined') return null;
    const loaded = getQrCanvasRuntime().loadEncoder();
    if (!(loaded instanceof Promise)) return loaded;
    loaded.catch(() => undefined);
    return null;
  });

  useEffect(() => {
    if (encoder) return;
    let live = true;
    Promise.resolve(getQrCanvasRuntime().loadEncoder())
      .then((loaded) => {
        if (live) setEncoder(loaded);
      })
      .catch((error: unknown) => console.warn('The QR encoder did not load:', error));
    return () => {
      live = false;
    };
  }, [encoder]);

  return encoder;
}
