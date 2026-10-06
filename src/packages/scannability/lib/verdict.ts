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

import type { ExportRiskPolicyInput, ScannabilityStatus } from './exportRiskPolicy';

/** One verdict for the scannability badge, combining the scan result and the health score (#1053). */
export type ScanVerdict = 'checking' | 'reliable' | 'fragile' | 'unreliable';

/** A one-tap change that addresses the top scannability issue. */
export type ScanFix = 'raise-error-correction' | 'increase-contrast' | 'standard-pattern' | 'smaller-logo';

/** Plain-language explanation of the top issue, with a fix when one is known. */
export interface ScanAdvice {
  message: string;
  fix?: ScanFix;
}

/** Score at or above which a passing design reads as reliable. */
export const RELIABLE_SCORE = 90;

/**
 * Derives the single verdict shown to people. "Reliable" needs a print-simulation pass, a
 * score of 90 or more and no warnings; any other pass is "fragile", and a failed scan or a
 * critical warning is "unreliable". Returns null while there is nothing to judge.
 * @param input - Scan status and optional health score.
 * @returns The verdict, or null when idle.
 */
export function getScanVerdict({ status, health }: ExportRiskPolicyInput): ScanVerdict | null {
  if (status === 'idle') return null;
  if (status === 'checking') return 'checking';
  if (status === 'fail' || health?.criticalWarnings?.length) return 'unreliable';
  if (status === 'digital-pass') return 'fragile';
  if (health && (health.score < RELIABLE_SCORE || (health.warnings?.length ?? 0) > 0)) return 'fragile';
  return 'reliable';
}

/**
 * Explains the top issue in plain words and picks the fix that addresses it.
 * @param input - Scan status, optional health score and the current error correction level.
 * @param input.status - Current scan status.
 * @param input.health - Optional health score with warnings.
 * @param input.errorCorrectionLevel - The design's error correction level.
 * @returns Advice, or null when the design scans reliably or is still being checked.
 */
export function getScanAdvice({
  status,
  health,
  errorCorrectionLevel,
}: ExportRiskPolicyInput & { errorCorrectionLevel?: string }): ScanAdvice | null {
  const verdict = getScanVerdict({ status, health });
  if (verdict === null || verdict === 'checking' || verdict === 'reliable') return null;

  const canRaiseEc = errorCorrectionLevel !== 'H';
  const top = health?.warnings?.[0] ?? '';

  if (top.startsWith('Contrast ratio is critically low')) {
    return { message: 'The colours are too close for a camera to tell apart. Use dark modules on a light background.', fix: 'increase-contrast' };
  }
  if (top.startsWith('Contrast ratio is low')) {
    return { message: 'The colours are a little close. Darker modules on a lighter background scan more reliably.', fix: 'increase-contrast' };
  }
  if (top.startsWith('Local contrast drop')) {
    return canRaiseEc
      ? { message: 'Some modules blur together when printed. Higher error correction or a bolder pattern helps.', fix: 'raise-error-correction' }
      : { message: 'Some modules blur together when printed. A bolder pattern or stronger contrast helps.', fix: 'standard-pattern' };
  }
  if (top.startsWith('Pattern complexity')) {
    return { message: 'This pattern needs stronger contrast to scan. Try a bolder pattern or darker colours.', fix: 'standard-pattern' };
  }
  if (top.startsWith('Logo size')) {
    return { message: 'The logo covers too much of the code. A smaller logo leaves enough of it readable.', fix: 'smaller-logo' };
  }
  if (top.startsWith('Low error correction with logo')) {
    return { message: 'A logo hides part of the code, so it needs higher error correction.', fix: 'raise-error-correction' };
  }
  if (status === 'fail') {
    return { message: 'A camera could not read this design. Stronger contrast usually fixes it.', fix: 'increase-contrast' };
  }
  // The print simulation loses modules that are too thin or too faint to survive blur (#1248).
  // Spare error correction recovers a few of them; a bolder pattern keeps them.
  if (status === 'digital-pass') {
    return canRaiseEc
      ? { message: 'It scans on a screen, but some modules blur away in the print simulation. Higher error correction or a bolder pattern helps; test with a phone camera before printing.', fix: 'raise-error-correction' }
      : { message: 'It scans on a screen, but some modules blur away in the print simulation. A bolder pattern or stronger contrast helps; test with a phone camera before printing.', fix: 'standard-pattern' };
  }
  return top ? { message: top } : null;
}

/**
 * Describes what was tested, for the details panel.
 * @param status - Current scan status.
 * @returns One line per check with its result.
 */
export function getScanChecks(status: ScannabilityStatus): { label: string; passed: boolean }[] {
  if (status === 'idle' || status === 'checking') return [];
  return [
    { label: 'Screen scan', passed: status !== 'fail' },
    { label: 'Print simulation', passed: status === 'physical-pass' },
  ];
}
