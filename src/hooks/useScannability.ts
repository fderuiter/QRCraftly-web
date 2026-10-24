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

import { useCallback } from 'react';
import type { QRConfig } from '@/packages/core/types';
import { useQRStore } from '@/context/QRContext';
import {
  useScannability as useScannabilityHealth,
  type UseScannabilityReturn,
} from '@/packages/scannability/client';
import { useCapabilities } from './useCapabilities';

export type {
  ScannabilityStatus,
  HealthScore,
  UseScannabilityReturn,
} from '@/packages/scannability/client';

/**
 * App wiring for the Scannability Health Evaluator: failures become `scannability-fail` store
 * signals (tagged with the browser engine and QR style), and the store's module count is used
 * when a check does not supply one. Must be used within `QRProvider`.
 * @param canvasRef - Ref to the preview canvas element.
 * @param config - Current QR code configuration profile.
 * @returns The current Scannability Health assessment plus the `checkScannability` trigger.
 */
export function useScannability(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  config: QRConfig
): UseScannabilityReturn {
  const store = useQRStore();
  const { engine } = useCapabilities();
  const styleId = config.style || 'default';

  const onFail = useCallback(
    (errorType: string) => store.emitSignal('scannability-fail', { engine, styleId, errorType }),
    [store, engine, styleId]
  );
  const getModuleCount = useCallback(() => store.getState().moduleCount, [store]);

  return useScannabilityHealth(canvasRef, config, { onFail, getModuleCount });
}
