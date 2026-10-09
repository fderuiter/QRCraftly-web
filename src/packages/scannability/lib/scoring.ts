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

import { QRConfig } from '@/types';
import { LOW_RELIABILITY_PATTERNS, SYSTEM_LIMITS } from '@/constants';
import { getContrastRatio } from '@/utils/colorUtils';

export interface HealthScore {
  score: number;
  warnings: string[];
  /** Machine-readable conditions that require export confirmation. */
  criticalWarnings?: string[];
}

/**
 * Evaluates static and dynamic heuristics to produce a comprehensive Scannability Health score.
 *
 * @param config - The QR code configuration profile.
 * @param localMetrics - Optional localized module contrast metrics.
 * @returns Comprehensive health score and warning diagnostics.
 */
export function calculateScannabilityHealth(
  config: QRConfig,
  localMetrics?: { violations?: number; minContrast?: number }
): HealthScore {
  let score = 100;
  const warnings: string[] = [];
  const criticalWarnings: string[] = [];

  const bgForContrast = config.bgColor === 'transparent' ? '#ffffff' : config.bgColor;
  // A gradient is only as scannable as its weakest stop, so every stop is checked.
  const moduleColors = (config.gradientType && config.gradientType !== 'none' && config.gradientColorStops?.length)
    ? config.gradientColorStops.map((stop) => stop.color)
    : [config.fgColor];

  const fgContrast = Math.min(...moduleColors.map((color) => getContrastRatio(color, bgForContrast)));
  const eyeFrameContrast = getContrastRatio(config.eyeFrameColor || config.eyeColor, bgForContrast);
  const eyeBallContrast = getContrastRatio(config.eyeBallColor || config.eyeColor, bgForContrast);
  const worstContrast = Math.min(fgContrast, eyeFrameContrast, eyeBallContrast);

  if (worstContrast < 3.0) {
    score -= 40;
    warnings.push('Contrast ratio is critically low');
    criticalWarnings.push('critical-contrast');
  } else if (worstContrast < 4.5) {
    score -= 20;
    warnings.push('Contrast ratio is low');
  }

  if (localMetrics && typeof localMetrics.violations === 'number' && localMetrics.violations > 0) {
    const deduction = Math.min(35, 15 + Math.floor(localMetrics.violations / 2));
    score -= deduction;
    warnings.push(
      `Local contrast drop detected across ${localMetrics.violations} module zone${localMetrics.violations > 1 ? 's' : ''}`
    );
  }

  const isComplex = LOW_RELIABILITY_PATTERNS.includes(config.style);
  if (isComplex) {
    score -= 10;
    if (worstContrast < 7.0) {
      score -= 20;
      warnings.push('Pattern complexity too high for current contrast');
    }
  }

  if (config.logoUrl) {
    if (config.logoSize > SYSTEM_LIMITS.MAX_LOGO_SIZE) {
      score -= 15;
      warnings.push('Logo size might obscure too much data');
    }
    if (config.errorCorrectionLevel === 'L') {
      score -= 15;
      warnings.push('Low error correction with logo');
    }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    warnings,
    criticalWarnings,
  };
}
