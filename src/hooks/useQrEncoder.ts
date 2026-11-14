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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QrEncoder } from '@/packages/qr-matrix';
import { getQrCanvasRuntime } from '@/utils/qrCanvasRuntime';

/** Where loading the encoder stands (#1711). */
type EncoderState = { status: 'loading' } | { status: 'ready'; encoder: QrEncoder } | { status: 'failed'; error: unknown };

/** What `useQrEncoder` gives its caller. */
export type QrEncoderLoad =
  | { status: 'loading' }
  | { status: 'ready'; encoder: QrEncoder }
  /** The load failed. `retry` asks again; nothing retries on its own, so a broken network sees one request per press. */
  | { status: 'failed'; error: unknown; retry: () => void };

/**
 * The first state, and the load it started. An encoder already in memory is ready at once, without
 * a loading frame; a load still under way is handed to the effect, so a mount asks only once.
 */
function firstLoad(): { state: EncoderState; pending: Promise<QrEncoder> | null } {
  // Pre-rendering has no encoder to fetch; the effect below loads it in the browser.
  if (typeof window === 'undefined') return { state: { status: 'loading' }, pending: null };
  try {
    const loaded = getQrCanvasRuntime().loadEncoder();
    if (!(loaded instanceof Promise)) return { state: { status: 'ready', encoder: loaded }, pending: null };
    // The effect handles the outcome; this copy only must not go unhandled before it runs.
    loaded.catch(() => undefined);
    return { state: { status: 'loading' }, pending: loaded };
  } catch (error) {
    return { state: { status: 'loading' }, pending: Promise.reject(error) };
  }
}

/**
 * The main-thread QR encoder, from the same runtime `QRCanvas` uses.
 * @returns Whether it is loading, ready (with the encoder) or failed (with a retry). Always loading during pre-rendering.
 */
export function useQrEncoder(): QrEncoderLoad {
  const [first] = useState(firstLoad);
  const [state, setState] = useState<EncoderState>(first.state);
  /** The load the first render started, used once by the first effect run. */
  const pendingRef = useRef(first.pending);

  useEffect(() => {
    if (state.status !== 'loading') return;
    // Each load belongs to this effect run: an unmount, or a later attempt, retires it.
    let live = true;
    const pending = pendingRef.current;
    pendingRef.current = null;
    (pending ?? Promise.resolve().then(() => getQrCanvasRuntime().loadEncoder()))
      .then(
        (encoder) => {
          if (live) setState({ status: 'ready', encoder });
        },
        (error: unknown) => {
          if (!live) return;
          console.warn('The QR encoder did not load:', error);
          setState({ status: 'failed', error });
        }
      );
    return () => {
      live = false;
    };
  }, [state.status]);

  /** Only a failed load can be retried, so presses while one is loading start nothing. */
  const retry = useCallback(() => setState((current) => (current.status === 'failed' ? { status: 'loading' } : current)), []);

  return state.status === 'failed' ? { ...state, retry } : state;
}
