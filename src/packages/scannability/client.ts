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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QRConfig } from '@/packages/core/types';
import {
  assessScannability,
  createScannabilityEvaluator,
  type ScannabilityAssessment,
  type ScannabilityEvaluator,
} from './lib/evaluator';

export type { ScannabilityAssessment } from './lib/evaluator';
export type { ScannabilityStatus, ExportRisk, ExportRiskPolicyInput } from './lib/exportRiskPolicy';
export type { HealthScore } from './lib/scoring';

/**
 * App capabilities injected into the hook. The package never reads app stores or contexts itself.
 */
export interface UseScannabilityOptions {
  /** Called with an error classification whenever a check fails (e.g. to emit a telemetry signal). */
  onFail?: (errorType: string) => void;
  /** Fallback QR module count used when a check does not pass one. */
  getModuleCount?: () => number | undefined;
}

export interface UseScannabilityReturn extends ScannabilityAssessment {
  /**
   * Asks for a fresh Scannability Health assessment of the given pixels, bitmap, or (when neither
   * is given) the preview canvas.
   */
  checkScannability: (
    overrideImageData?: ImageData,
    overrideImageBitmap?: ImageBitmap,
    overrideModuleCount?: number
  ) => void;
}

/**
 * Thin React adapter over the Scannability Health Evaluator: creates it, keeps its configuration
 * in sync, mirrors its assessment into state and destroys it on unmount. The Scannability Worker,
 * watchdog and main-thread fallback stay private to the evaluator.
 *
 * @param canvasRef - Ref to the preview canvas element.
 * @param config - Current QR code configuration profile.
 * @param options - Injected app capabilities (failure reporting, module count).
 * @returns The current assessment plus the `checkScannability` trigger.
 */
export function useScannability(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  config: QRConfig,
  options: UseScannabilityOptions = {}
): UseScannabilityReturn {
  const [assessment, setAssessment] = useState<ScannabilityAssessment>(() =>
    assessScannability('idle', config)
  );

  const latest = useRef({ canvasRef, options, config });
  useEffect(() => {
    latest.current = { canvasRef, options, config };
  });

  const evaluatorRef = useRef<ScannabilityEvaluator | null>(null);

  const getEvaluator = useCallback((): ScannabilityEvaluator => {
    if (evaluatorRef.current) return evaluatorRef.current;
    const evaluator = createScannabilityEvaluator({
      config: latest.current.config,
      getCanvas: () => latest.current.canvasRef.current,
      getModuleCount: () => latest.current.options.getModuleCount?.(),
      onFail: (errorType) => latest.current.options.onFail?.(errorType),
    });
    evaluator.subscribe(setAssessment);
    evaluatorRef.current = evaluator;
    return evaluator;
  }, []);

  useEffect(() => {
    latest.current.config = config;
    getEvaluator().setConfig(config);
  }, [config, getEvaluator]);

  useEffect(() => {
    return () => {
      evaluatorRef.current?.destroy();
      evaluatorRef.current = null;
    };
  }, []);

  const checkScannability = useCallback(
    (overrideImageData?: ImageData, overrideImageBitmap?: ImageBitmap, overrideModuleCount?: number) => {
      void getEvaluator().check({
        imageData: overrideImageData,
        imageBitmap: overrideImageBitmap,
        moduleCount: overrideModuleCount,
      });
    },
    [getEvaluator]
  );

  return useMemo(() => ({ ...assessment, checkScannability }), [assessment, checkScannability]);
}
