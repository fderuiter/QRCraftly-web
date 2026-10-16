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

import { useCallback, useEffect, useState } from 'react';
import type { QrEncoder } from '@/packages/qr-matrix';
import { getQrCanvasRuntime } from '@/utils/qrCanvasRuntime';

export interface UseQrEncoderResult {
  /** The main-thread encoder, or null if loading or failed. */
  encoder: QrEncoder | null;
  /** True while the encoder module initialization is in progress. */
  isLoading: boolean;
  /** Error object if module load failed, or null otherwise. */
  error: Error | null;
  /** Clears the error state and re-attempts loading the encoder. */
  retry: () => void;
}

/**
 * The main-thread QR encoder, from the same runtime `QRCanvas` uses.
 * Exposes loading status, error status, and a retry function.
 * @returns The encoder state object.
 */
export function useQrEncoder(): UseQrEncoderResult {
  const [attempt, setAttempt] = useState(0);

  const [state, setState] = useState<{
    encoder: QrEncoder | null;
    isLoading: boolean;
    error: Error | null;
  }>(() => ({
    encoder: null,
    isLoading: typeof window !== 'undefined',
    error: null,
  }));

  const retry = useCallback(() => {
    setState({ encoder: null, isLoading: true, error: null });
    setAttempt((c) => c + 1);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let live = true;
    let res: QrEncoder | Promise<QrEncoder>;
    try {
      res = getQrCanvasRuntime().loadEncoder();
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'The QR encoder did not load.');
      console.warn('The QR encoder did not load:', err);
      setState({ encoder: null, isLoading: false, error: errorObj });
      return;
    }

    if (!(res instanceof Promise)) {
      setState({ encoder: res, isLoading: false, error: null });
      return;
    }

    res
      .then((loaded) => {
        if (live) {
          setState({ encoder: loaded, isLoading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (live) {
          const errorObj = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'The QR encoder did not load.');
          console.warn('The QR encoder did not load:', err);
          setState({ encoder: null, isLoading: false, error: errorObj });
        }
      });

    return () => {
      live = false;
    };
  }, [attempt]);

  return { ...state, retry };
}

