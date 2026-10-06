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

import type { QrRead, QrReadOptions, QrReader } from '@/packages/qr-decode';
import { isDangerousUrl } from '@/utils/security';
import { simulatePrint, type OpticalScratchBuffers, type PixelFrame } from './opticalSimulation';
import { auditModuleContrast } from './contrastAudit';

export type { OpticalScratchBuffers, PixelFrame } from './opticalSimulation';

export interface ScannabilityResult {
  success: boolean;
  physicalReady: boolean;
  error?: string | null;
  localContrastViolations?: number;
  minLocalContrast?: number;
}

/**
 * Attempts one read with our reader (#1178). Reader exceptions are treated as "no code found" so
 * a failure in one pass never prevents the next.
 */
function tryRead(reader: QrReader, frame: PixelFrame, options: QrReadOptions): QrRead | null {
  try {
    const [code] = reader.read(frame.data, frame.width, frame.height, options);
    return code ?? null;
  } catch {
    return null;
  }
}

/**
 * How the physical check reads the simulated print: as the scanner's camera fallback does
 * (`optical-scanner` `decodeSync`), with both polarities, a whole-frame threshold and a half-size
 * retry, so the verdict tracks what a camera would read rather than one binarizer's limits.
 */
const CAMERA_READ: QrReadOptions = { inverted: true, global: true, half: true };

/**
 * The single Scannability Health check, written as a generator so the Scannability Worker can
 * yield to its event loop (and abandon superseded requests) between the expensive stages, while
 * the main-thread fallback runs the exact same steps synchronously. Every `yield` marks a point
 * where the caller may stop iterating.
 *
 * Stages: localized module contrast audit, two-pass (normal, then inverted) digital decode, the
 * dangerous-URL security check, the optical print simulation of the code the decode found, then
 * a physical decode, read as the camera scanner reads, that must find the same text.
 *
 * @param reader - The QR reader, from `loadQrReader`.
 * @param frame - Pixels to evaluate.
 * @param moduleCount - QR modules per side; enables the localized contrast audit.
 * @param scratch - Optional reusable buffers for the optical simulation.
 * @returns A generator whose return value is the check result.
 */
export function* scannabilitySteps(
  reader: QrReader,
  frame: PixelFrame,
  moduleCount?: number,
  scratch?: OpticalScratchBuffers
): Generator<void, ScannabilityResult, void> {
  // 0. Localized module contrast audit
  let localContrastViolations = 0;
  let minLocalContrast = 21;
  if (moduleCount && moduleCount > 0) {
    const audit = auditModuleContrast(frame, moduleCount);
    localContrastViolations = audit.violations;
    minLocalContrast = audit.minContrast;
  }
  const metrics = { localContrastViolations, minLocalContrast };

  // 1. Digital check (pass 1: normal polarity, pass 2: inverted polarity)
  let digital = tryRead(reader, frame, { inverted: false });
  if (digital === null) {
    yield;
    digital = tryRead(reader, frame, { inverted: true });
  }

  if (digital === null) {
    return { success: false, physicalReady: false, error: 'NOT_FOUND', ...metrics };
  }

  // Security check: a code that decodes to a dangerous URL is never reported as scannable.
  if (isDangerousUrl(digital.text)) {
    return { success: false, physicalReady: false, error: 'SECURITY_VIOLATION', ...metrics };
  }

  yield;

  // 2. Optical print simulation, in module units around the code the digital check found (#1248)
  const printed = simulatePrint(frame, digital, scratch);

  yield;

  // 3. Physical check, read the way the camera scanner reads. A misread is not a pass.
  const physical = tryRead(reader, printed, CAMERA_READ);

  return { success: true, physicalReady: physical?.text === digital.text, ...metrics };
}

/**
 * Runs the Scannability Health check synchronously on the calling thread. This is the same
 * step sequence the Scannability Worker runs (see `scannabilitySteps`), so worker and
 * main-thread fallback results match by construction rather than by copied code.
 * @param reader - The QR reader, from `loadQrReader`.
 */
export function performScannabilityCheck(
  reader: QrReader,
  imageData: PixelFrame,
  width: number,
  height: number,
  moduleCount?: number
): ScannabilityResult {
  const steps = scannabilitySteps(reader, { data: imageData.data, width, height }, moduleCount);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
