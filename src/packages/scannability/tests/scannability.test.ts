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

import { describe, it, expect } from 'vitest';
import { calculateScannabilityHealth, getExportRiskPolicy, auditModuleContrast } from '../index';
import { qrReader } from '../../../../tests/fixtures/qrReader';
import { evaluateScannability, performScannabilityCheck } from '../checker';
import { type QRConfig, QRType, QRErrorCorrectionLevel, QRStyle, SocialFormat, TemplateStyle } from '@/packages/core/types';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { renderCorpusFrame } from '../../../../tests/utils/scannerCorpus';

const getBaseConfig = (): QRConfig => ({
  type: QRType.TEXT,
  value: 'hello world',
  fgColor: '#000000',
  bgColor: '#FFFFFF',
  eyeColor: '#000000',
  errorCorrectionLevel: QRErrorCorrectionLevel.M,
  logoUrl: '',
  logoSize: 0.2,
  logoPadding: 0,
  logoPaddingStyle: 'square',
  logoBackgroundColor: '#FFFFFF',
  style: QRStyle.STANDARD,
  socialFormat: SocialFormat.SQUARE_1_1,
  templateStyle: TemplateStyle.NONE,
  isBorderEnabled: false,
  borderSize: 0.05,
  borderStyle: 'solid',
  borderColor: '#000000',
  borderText: '',
  borderTextColor: '#000000',
  borderLogoUrl: null,
  borderTextPosition: 'bottom-center',
  borderLogoPosition: 'bottom-center',
});

describe('Scannability Deep Module (Public Entry Points)', () => {
  describe('calculateScannabilityHealth', () => {
    it('returns perfect 100 health score for standard high contrast config', () => {
      const config = getBaseConfig();
      const health = calculateScannabilityHealth(config);
      expect(health.score).toBe(100);
      expect(health.warnings).toHaveLength(0);
      expect(health.criticalWarnings).toHaveLength(0);
    });

    it('deducts score and adds critical warning on low contrast', () => {
      const config: QRConfig = {
        ...getBaseConfig(),
        fgColor: '#888888',
        bgColor: '#999999',
        eyeColor: '#888888',
      };
      const health = calculateScannabilityHealth(config);
      expect(health.score).toBeLessThanOrEqual(60);
      expect(health.criticalWarnings).toContain('critical-contrast');
    });

    it('evaluates contrast against white fallback when bgColor is transparent', () => {
      const config: QRConfig = {
        ...getBaseConfig(),
        fgColor: '#000000',
        bgColor: 'transparent',
        eyeColor: '#000000',
      };
      const health = calculateScannabilityHealth(config);
      expect(health.score).toBe(100);
      expect(health.criticalWarnings).not.toContain('critical-contrast');
    });

    it('flags a gradient whose end stop fades into the background (#1365)', () => {
      const config: QRConfig = {
        ...getBaseConfig(),
        fgColor: '#000000',
        bgColor: '#ffffff',
        eyeColor: '#000000',
        gradientType: 'linear',
        gradientColorStops: [
          { offset: 0, color: '#000000' },
          { offset: 1, color: '#ffffff' },
        ],
      };
      const health = calculateScannabilityHealth(config);
      expect(health.criticalWarnings).toContain('critical-contrast');
    });

    it('evaluates inherited finder contrast from gradient stops when isCustomEyeColor is false and ignores stale eyeColor', () => {
      const healthyUnified: QRConfig = {
        ...getBaseConfig(),
        fgColor: '#0f172a',
        bgColor: '#ffffff',
        eyeColor: '#ffffff',
        isCustomEyeColor: false,
        gradientType: 'radial',
        gradientColorStops: [
          { offset: 0, color: '#0f172a' },
          { offset: 1, color: '#1e3a8a' },
        ],
      };
      expect(calculateScannabilityHealth(healthyUnified).score).toBe(100);

      const lowContrastCustomEye: QRConfig = {
        ...healthyUnified,
        isCustomEyeColor: true,
        eyeFrameColor: '#f1f5f9',
      };
      expect(calculateScannabilityHealth(lowContrastCustomEye).criticalWarnings).toContain('critical-contrast');
    });

    it('deducts score when localized contrast violations occur', () => {
      const config = getBaseConfig();
      const health = calculateScannabilityHealth(config, { violations: 4, minContrast: 2.2 });
      expect(health.score).toBeLessThan(100);
      expect(health.warnings.some((w) => w.includes('Local contrast drop detected'))).toBe(true);
    });

    it('deducts score and emits warning when logo is present with Low (L) error correction', () => {
      const configL: QRConfig = {
        ...getBaseConfig(),
        logoUrl: 'data:image/png;base64,dummy',
        errorCorrectionLevel: QRErrorCorrectionLevel.L,
      };
      const healthL = calculateScannabilityHealth(configL);
      expect(healthL.score).toBe(85);
      expect(healthL.warnings).toContain('Low error correction with logo');
    });

    it('does not emit error correction warning when logo is present with Medium (M) or High (H) error correction', () => {
      const configM: QRConfig = {
        ...getBaseConfig(),
        logoUrl: 'data:image/png;base64,dummy',
        errorCorrectionLevel: QRErrorCorrectionLevel.M,
      };
      const healthM = calculateScannabilityHealth(configM);
      expect(healthM.score).toBe(100);
      expect(healthM.warnings).not.toContain('Low error correction with logo');

      const configH: QRConfig = {
        ...getBaseConfig(),
        logoUrl: 'data:image/png;base64,dummy',
        errorCorrectionLevel: QRErrorCorrectionLevel.H,
      };
      const healthH = calculateScannabilityHealth(configH);
      expect(healthH.score).toBe(100);
      expect(healthH.warnings).not.toContain('Low error correction with logo');
    });

    it('deducts score and warns when quiet zone margin is below 4 modules', () => {
      const config: QRConfig = {
        ...getBaseConfig(),
        quietZoneModules: 2,
      };
      const health = calculateScannabilityHealth(config);
      expect(health.score).toBe(85);
      expect(health.warnings).toContain('Quiet zone is narrower than the recommended 4 modules');
    });

    it('does not warn when quiet zone margin is 4 or higher', () => {
      const config: QRConfig = {
        ...getBaseConfig(),
        quietZoneModules: 4,
      };
      const health = calculateScannabilityHealth(config);
      expect(health.score).toBe(100);
      expect(health.warnings).not.toContain('Quiet zone is narrower than the recommended 4 modules');
    });
  });

  describe('getExportRiskPolicy', () => {
    it('returns safe for physical-pass with high health score', () => {
      const risk = getExportRiskPolicy({
        status: 'physical-pass',
        health: { score: 95, warnings: [], criticalWarnings: [] },
      });
      expect(risk).toBe('safe');
    });

    it('returns unsafe for fail status or critical warnings', () => {
      const failRisk = getExportRiskPolicy({
        status: 'fail',
        health: { score: 40, warnings: [], criticalWarnings: [] },
      });
      expect(failRisk).toBe('unsafe');

      const warningRisk = getExportRiskPolicy({
        status: 'digital-pass',
        health: { score: 60, warnings: [], criticalWarnings: ['critical-contrast'] },
      });
      expect(warningRisk).toBe('unsafe');
    });

    it('returns caution when checking, idle, or when score < 80', () => {
      const idleRisk = getExportRiskPolicy({
        status: 'idle',
        health: { score: 100, warnings: [], criticalWarnings: [] },
      });
      expect(idleRisk).toBe('caution');

      const lowScoreRisk = getExportRiskPolicy({
        status: 'digital-pass',
        health: { score: 75, warnings: ['Pattern complexity'], criticalWarnings: [] },
      });
      expect(lowScoreRisk).toBe('caution');
    });
  });

  describe('performScannabilityCheck on a transparent background', () => {
    it('reads clear pixels as the white paper the code is printed on, not as black', () => {
      const frame = renderCorpusFrame({ text: 'https://qrcraftly.com', width: 400, height: 400, modulePx: 8 });
      const clear = frame.data.slice();
      for (let i = 0; i < clear.length; i += 4) {
        if (clear[i] > 128) clear.set([0, 0, 0, 0], i);
        else if (clear[i] < 128) clear.set([0, 0, 0, 255], i);
      }
      expect(performScannabilityCheck(qrReader, { data: frame.data, width: 400, height: 400 }, 400, 400).success).toBe(true);
      expect(performScannabilityCheck(qrReader, { data: clear, width: 400, height: 400 }, 400, 400).success).toBe(true);
    });
  });

  describe('evaluateScannability (Headless Evaluator)', () => {
    it('evaluates image data and returns complete scannability assessment report', () => {
      const width = 20;
      const height = 20;
      const data = new Uint8ClampedArray(width * height * 4);
      // Fill with solid white
      data.fill(255);

      const config = getBaseConfig();
      const assessment = evaluateScannability(qrReader, { data, width, height }, config);

      expect(assessment).toHaveProperty('status');
      expect(assessment).toHaveProperty('health');
      expect(assessment).toHaveProperty('exportRisk');
      expect(assessment).toHaveProperty('result');
      expect(assessment.health.score).toBe(100);
    });
  });

  describe('auditModuleContrast and quiet zone margins', () => {
    it('respects quiet zone margin parameter at 2 modules', () => {
      const moduleCount = 21;
      const margin = 2;
      const cellSize = 10;
      const width = (moduleCount + 2 * margin) * cellSize;
      const height = width;
      const data = new Uint8ClampedArray(width * height * 4);
      data.fill(255); // white background

      // Draw a black module at matrix cell (0,0) located at pixel offset margin * cellSize
      const startX = margin * cellSize;
      const startY = margin * cellSize;
      for (let y = startY; y < startY + cellSize; y++) {
        for (let x = startX; x < startX + cellSize; x++) {
          const idx = (y * width + x) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 255;
        }
      }

      const audit = auditModuleContrast({ data, width, height }, moduleCount, margin);
      expect(audit.violations).toBe(0);

      const frame = { data, width, height };
      const res = performScannabilityCheck(qrReader, frame, width, height, moduleCount, margin);
      expect(res.localContrastViolations).toBe(0);
    });

    it('respects quiet zone margin parameter at 8 modules', () => {
      const moduleCount = 21;
      const margin = 8;
      const cellSize = 10;
      const width = (moduleCount + 2 * margin) * cellSize;
      const height = width;
      const data = new Uint8ClampedArray(width * height * 4);
      data.fill(255); // white background

      // Draw a black module at matrix cell (0,0) located at pixel offset margin * cellSize
      const startX = margin * cellSize;
      const startY = margin * cellSize;
      for (let y = startY; y < startY + cellSize; y++) {
        for (let x = startX; x < startX + cellSize; x++) {
          const idx = (y * width + x) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 255;
        }
      }

      const audit = auditModuleContrast({ data, width, height }, moduleCount, margin);
      expect(audit.violations).toBe(0);

      const frame = { data, width, height };
      const res = performScannabilityCheck(qrReader, frame, width, height, moduleCount, margin);
      expect(res.localContrastViolations).toBe(0);
    });

    it('returns identical fallback result for zero or negative dimensions or module counts', () => {
      const fallback = { violations: 0, minContrast: 21, lowContrastCells: [] };

      expect(auditModuleContrast({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, 21)).toEqual(fallback);
      expect(auditModuleContrast({ data: new Uint8ClampedArray(100), width: 10, height: 10 }, 0)).toEqual(fallback);
      expect(auditModuleContrast({ data: new Uint8ClampedArray(100), width: 10, height: 10 }, -1)).toEqual(fallback);
      expect(auditModuleContrast({ data: new Uint8ClampedArray(100), width: -10, height: 10 }, 21)).toEqual(fallback);
      expect(auditModuleContrast({ data: new Uint8ClampedArray(100), width: 10, height: -10 }, 21)).toEqual(fallback);
      expect(auditModuleContrast(null as any, 21)).toEqual(fallback);
    });

    it('verifies numeric parity across opaque canvas frames', () => {
      const moduleCount = 21;
      const cellSize = 4;
      const width = moduleCount * cellSize;
      const height = width;
      const data = new Uint8ClampedArray(width * height * 4);

      // Checkerboard pattern of black (0) and white (255)
      for (let r = 0; r < moduleCount; r++) {
        for (let c = 0; c < moduleCount; c++) {
          const isDark = (r + c) % 2 === 0;
          const val = isDark ? 0 : 255;
          for (let y = r * cellSize; y < (r + 1) * cellSize; y++) {
            for (let x = c * cellSize; x < (c + 1) * cellSize; x++) {
              const idx = (y * width + x) * 4;
              data[idx] = val;
              data[idx + 1] = val;
              data[idx + 2] = val;
              data[idx + 3] = 255;
            }
          }
        }
      }

      const audit = auditModuleContrast({ data, width, height }, moduleCount, 0);
      expect(audit.violations).toBe(0);
      expect(audit.minContrast).toBeCloseTo(21, 1);
      expect(audit.lowContrastCells).toHaveLength(0);
    });

    it('correctly handles non-opaque and transparent canvas frames', () => {
      const moduleCount = 21;
      const cellSize = 4;
      const width = moduleCount * cellSize;
      const height = width;
      const data = new Uint8ClampedArray(width * height * 4);

      // Transparent background (alpha = 0, RGB = 0).
      // When composited onto white, transparent pixels should evaluate as white (lum = 1.0).
      // Draw opaque black modules on half the cells.
      for (let r = 0; r < moduleCount; r++) {
        for (let c = 0; c < moduleCount; c++) {
          const isDark = r === 0 && c === 0;
          for (let y = r * cellSize; y < (r + 1) * cellSize; y++) {
            for (let x = c * cellSize; x < (c + 1) * cellSize; x++) {
              const idx = (y * width + x) * 4;
              if (isDark) {
                // Opaque black
                data[idx] = 0;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 255;
              } else {
                // Fully transparent (stored as clear black)
                data[idx] = 0;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 0;
              }
            }
          }
        }
      }

      const audit = auditModuleContrast({ data, width, height }, moduleCount, 0);
      expect(audit.violations).toBe(0);
      expect(audit.minContrast).toBeCloseTo(21, 1);
    });

    it('detects low contrast violations in low-contrast module areas', () => {
      const moduleCount = 21;
      const cellSize = 4;
      const width = moduleCount * cellSize;
      const height = width;
      const data = new Uint8ClampedArray(width * height * 4);

      // Background: white (#FFFFFF)
      data.fill(255);

      // Draw dark modules in 7x7 block so refDark is low (0.0) and refLight is high (1.0)
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          for (let y = r * cellSize; y < (r + 1) * cellSize; y++) {
            for (let x = c * cellSize; x < (c + 1) * cellSize; x++) {
              const idx = (y * width + x) * 4;
              data[idx] = 0;
              data[idx + 1] = 0;
              data[idx + 2] = 0;
              data[idx + 3] = 255;
            }
          }
        }
      }

      // Add a module in the dark region that is faded (RGB = 160, lum ~0.35 <= midLum 0.5),
      // yielding contrast (1.0 + 0.05) / (0.35 + 0.05) ~ 2.62 < 3.0
      const targetR = 0;
      const targetC = 0;
      for (let y = targetR * cellSize; y < (targetR + 1) * cellSize; y++) {
        for (let x = targetC * cellSize; x < (targetC + 1) * cellSize; x++) {
          const idx = (y * width + x) * 4;
          data[idx] = 160;
          data[idx + 1] = 160;
          data[idx + 2] = 160;
          data[idx + 3] = 255;
        }
      }

      const audit = auditModuleContrast({ data, width, height }, moduleCount, 0);
      expect(audit.minContrast).toBeLessThan(3.0);
      expect(audit.violations).toBeGreaterThan(0);
      expect(audit.lowContrastCells.some((cell) => cell.row === targetR && cell.col === targetC)).toBe(true);
    });

    it('verifies Float64Array.prototype.slice().sort() matches numeric sorting parity', () => {
      const floatBuffer = new Float64Array([0.85, 0.12, 0.05, 1.0, 0.45, 0.23, 0.99, 0.0]);
      const typedSorted = floatBuffer.slice().sort();
      const boxedSorted = Array.from(floatBuffer).sort((a, b) => a - b);

      expect(typedSorted).toBeInstanceOf(Float64Array);
      expect(Array.from(typedSorted)).toEqual(boxedSorted);
    });
  });
});

