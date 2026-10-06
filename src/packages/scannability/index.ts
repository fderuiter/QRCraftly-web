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


export type { ScannabilityStatus, ExportRisk, ExportRiskPolicyInput, ExportOptions } from './lib/exportRiskPolicy';
export type { HealthScore } from './lib/scoring';
export type { ScannabilityResult } from './lib/checker';
export type { ModuleContrastAuditResult, LowContrastCell } from './lib/contrastAudit';

export { calculateScannabilityHealth } from './lib/scoring';
export { getExportRiskPolicy } from './lib/exportRiskPolicy';
export { getScanVerdict, getScanAdvice, getScanChecks, RELIABLE_SCORE } from './lib/verdict';
export type { ScanVerdict, ScanFix, ScanAdvice } from './lib/verdict';
export { auditModuleContrast } from './lib/contrastAudit';
export {
  simulatePrint,
  PRINT_PX_PER_MODULE,
  PRINT_QUIET_ZONE_MODULES,
  PRINT_BLUR_MODULES,
  type GreyFrame,
  type PrintPlacement,
} from './lib/opticalSimulation';
export {
  isWorkerRequest,
  assertWorkerRequest,
  isWorkerResponse,
  assertWorkerResponse,
  type WorkerRequest,
  type WorkerResponse,
} from './lib/sharedContract';
export { releaseImageHandle } from './lib/imageHandle';
export {
  createScannabilityWorker,
  type ScannabilityWorkerFactory,
  type ScannabilityWorkerHandle,
  type ScannabilityWorkerHandlers,
} from './lib/workerFactory';
export type { PixelFrame } from './lib/checker';
export {
  createScannabilityEvaluator,
  assessScannability,
  type ScannabilityEvaluator,
  type ScannabilityEvaluatorConfig,
  type ScannabilityAssessment,
  type ScannabilityCheckRequest,
  type ScannabilityCanvas,
  type ScannabilityClock,
  type ScannabilityFrameReader,
} from './lib/evaluator';
