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

import { useCallback, useMemo, useState } from 'react';
import type { QRConfig } from '@/packages/core/types';
import { getSamplePayload } from '@/packages/qr-payload';
import type { ScannabilityStatus } from '@/packages/scannability';
import { useQRStore, useQRStoreSelector } from '@/context/QRContext';
import { deriveVerdict, isEmptyValue, resolveEffectiveConfig } from '@/components/generator/decisions';
import type { RenderedInfo } from '@/components/qr-canvas/virtualRender';
import type { PreviewFailure } from '@/utils/previewFailure';
import { useLeadingDebounce } from './useDebounce';
import { useScannability, type HealthScore } from './useScannability';

export interface GeneratorPreview {
  /** The config the preview and exports use: the sample for an empty form, blank for a refused field. */
  effectiveConfig: QRConfig;
  /** `effectiveConfig` debounced for the canvas, so typing does not redraw on every keystroke. */
  debouncedConfig: QRConfig;
  /** Scan status for the badge and gates; 'idle' while there is no real code (#1251). */
  verdict: ScannabilityStatus;
  health: HealthScore | undefined;
  /** True when there is no real code to judge. */
  noVerdict: boolean;
  /** True when the form holds nothing to encode and the sample is shown. */
  isEmpty: boolean;
  /** True when a field holds a value the form refused (#1279). */
  refused: boolean;
  moduleCount: number;
  /** QRCanvas `onRendered`: records the module count and runs one scan check on the rendered image. */
  onRendered: (info?: RenderedInfo) => void;
  /** QRCanvas `onRenderFailed`. */
  onRenderFailed: (reason: PreviewFailure) => void;
  /** Why the preview has no code to show, if it has none (#1251). */
  previewFailure: PreviewFailure | null;
  /** True while the scan worker has recovered from an error and retries are active. */
  recovering: boolean;
}

/**
 * The generator preview's state: the effective and debounced configs, the scan verdict and the
 * canvas callbacks. Must be used within `QRProvider`.
 * @param canvasRef - Ref to the preview canvas.
 */
export function useGeneratorPreview(canvasRef: React.RefObject<HTMLCanvasElement | null>): GeneratorPreview {
  const config = useQRStoreSelector((s) => s.config);
  const refused = useQRStoreSelector((s) => s.contentRefused);
  const moduleCount = useQRStoreSelector((s) => s.moduleCount);
  const { setModuleCount } = useQRStore();

  const isEmpty = isEmptyValue(config.value);
  const samplePayload = useMemo(() => getSamplePayload(config.type), [config.type]);
  const effectiveConfig = useMemo(
    () => resolveEffectiveConfig(config, { refused, isEmpty, sample: samplePayload }),
    [config, refused, isEmpty, samplePayload],
  );

  // The scan check reads the undebounced config; the canvas below gets the debounced one.
  const { status: rawStatus, checkScannability, health: rawHealth, workerRecoveryActive } = useScannability(canvasRef, effectiveConfig);

  const [previewFailure, setPreviewFailure] = useState<PreviewFailure | null>(null);
  const { noVerdict, status: verdict, health } = deriveVerdict(rawStatus, rawHealth, {
    isEmpty,
    refused,
    previewFailed: previewFailure !== null,
  });

  const onRendered = useCallback((info: RenderedInfo = { moduleCount: 0 }) => {
    setPreviewFailure(null);
    if (info.moduleCount) setModuleCount(info.moduleCount);
    if (info.virtualImageBitmap) {
      checkScannability(undefined, info.virtualImageBitmap, info.moduleCount);
    } else if (info.virtualImageData) {
      checkScannability(info.virtualImageData, undefined, info.moduleCount);
    }
  }, [setModuleCount, checkScannability]);

  // Debounce the effective config for QRCanvas to prevent lag during rapid typing or style changes.
  const debouncedConfig = useLeadingDebounce(effectiveConfig, 100);

  return {
    effectiveConfig,
    debouncedConfig,
    verdict,
    health,
    noVerdict,
    isEmpty,
    refused,
    moduleCount,
    onRendered,
    onRenderFailed: setPreviewFailure,
    previewFailure,
    recovering: workerRecoveryActive,
  };
}
