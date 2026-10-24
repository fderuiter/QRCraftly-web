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

/**
 * The generator's export and preview decisions as pure functions (#1516), so each one is
 * tested on its own and QRToolInner only wires them to state, toasts and focus.
 */

import { DEFAULT_CONFIG } from '@/packages/core/config';
import { type QRConfig, QRErrorCorrectionLevel, QRStyle } from '@/packages/core/types';
import { isDangerousUrl } from '@/packages/core/security';
import { getExportRiskPolicy, SYSTEM_LIMITS, type ExportRiskPolicyInput, type ScanFix, type ScannabilityStatus } from '@/packages/scannability';
import { SCAN_VALIDATION_ERROR, type ExportStatus } from '@/hooks/useQRDownload';
import type { PreviewFailure } from '@/utils/previewFailure';

type Health = ExportRiskPolicyInput['health'];

/**
 * The config the preview and exports use. A refused field draws nothing rather than a code
 * that no longer matches the form (#1279), and an empty form shows the type's sample.
 */
export function resolveEffectiveConfig(
  config: QRConfig,
  { refused, isEmpty, sample }: { refused: boolean; isEmpty: boolean; sample: string },
): QRConfig {
  if (refused) return { ...config, value: '' };
  return isEmpty ? { ...config, value: sample } : config;
}

/** Whether the form holds nothing to encode: no value, or only whitespace. */
export function isEmptyValue(value: string): boolean {
  return !value || !value.trim();
}

/** The verdict inputs the badge and the gates read. */
export interface Verdict<H extends Health = Health> {
  /** True when there is no real code to judge, so no verdict is shown (#1251). */
  noVerdict: boolean;
  status: ScannabilityStatus;
  health: H | undefined;
}

/**
 * Reports 'idle' and no health while the preview shows the sample, a refused field or no code
 * at all, so no verdict is shown for a code that does not exist (#1251).
 */
export function deriveVerdict<H extends Health>(
  rawStatus: ScannabilityStatus,
  rawHealth: H | undefined,
  { isEmpty, refused, previewFailed }: { isEmpty: boolean; refused: boolean; previewFailed: boolean },
): Verdict<H> {
  const noVerdict = isEmpty || refused || previewFailed;
  return { noVerdict, status: noVerdict ? 'idle' : rawStatus, health: noVerdict ? undefined : rawHealth };
}

/** The export surfaces. The wallet card draws a plain black-on-white code, so scan risk does not apply to it. */
export type ExportAction = 'download' | 'copy' | 'share' | 'wallet';

/**
 * Why an export cannot go ahead as asked. Every kind but `scan-risk` refuses outright;
 * `scan-risk` asks first and offers "Export anyway".
 */
export type ExportBlockReason =
  | { kind: 'refused' }
  | { kind: 'empty' }
  | { kind: 'preview-failure'; failure: PreviewFailure }
  | { kind: 'dangerous-url' }
  | { kind: 'scan-risk' };

/**
 * The one check every export surface runs before exporting, in the order the reasons are reported.
 * @returns `null` when the export may go ahead.
 */
export function exportBlockReason({
  config,
  refused,
  isEmpty,
  previewFailure,
  verdict,
  action,
}: {
  config: Pick<QRConfig, 'value'>;
  refused: boolean;
  isEmpty: boolean;
  previewFailure: PreviewFailure | null;
  verdict: Pick<Verdict, 'status' | 'health'>;
  action: ExportAction;
}): ExportBlockReason | null {
  if (refused) return { kind: 'refused' };
  if (isEmpty) return { kind: 'empty' };
  // There is no code to export: say why, with no "Export Anyway" (#1251).
  if (previewFailure) return { kind: 'preview-failure', failure: previewFailure };
  // A script or data link is refused outright: no "Export Anyway" for it.
  if (isDangerousUrl(config.value)) return { kind: 'dangerous-url' };
  if (action !== 'wallet' && getExportRiskPolicy(verdict) === 'unsafe') return { kind: 'scan-risk' };
  return null;
}

/** The config patch for a scan fix offered by the badge or the safety gate. */
export function fixPatch(fix: ScanFix): Partial<QRConfig> {
  if (fix === 'raise-error-correction') return { errorCorrectionLevel: QRErrorCorrectionLevel.H };
  if (fix === 'standard-pattern') return { style: QRStyle.STANDARD };
  if (fix === 'smaller-logo') return { logoSize: SYSTEM_LIMITS.MAX_LOGO_SIZE };
  return {
    fgColor: '#000000',
    bgColor: '#ffffff',
    eyeColor: '#000000',
    eyeFrameColor: '#000000',
    eyeBallColor: '#000000',
  };
}

/** The config patch that puts the colors back to the defaults. */
export function resetPatch(): Partial<QRConfig> {
  return {
    fgColor: DEFAULT_CONFIG.fgColor,
    bgColor: DEFAULT_CONFIG.bgColor,
    eyeColor: DEFAULT_CONFIG.eyeColor,
    eyeFrameColor: undefined,
    eyeBallColor: undefined,
  };
}

/** A toast the generator raises after an export. */
export interface ExportToast {
  type: 'info' | 'warning' | 'error';
  message: string;
  duration: number;
}

/** What to do with a finished export. */
export interface ExportDecision {
  /** Toasts to raise, in order. */
  toasts: ExportToast[];
  /** True when the originating button should show its check mark. */
  markDone: boolean;
  /** True when the finished image failed the scan check and the user may retry with `allowUnsafe` (#1255). */
  retryWithAllowUnsafe: boolean;
}

/**
 * Turns an export result into toasts, the done state and an optional retry. Success shows on the
 * button itself, a cancelled picker or share sheet says nothing, and other errors raise a toast.
 * @param result - The export result.
 * @param allowedUnsafe - Whether this export already ran with `allowUnsafe`, so no further retry is offered.
 */
export function exportDecision(result: ExportStatus, allowedUnsafe = false): ExportDecision {
  if (result.error?.name === SCAN_VALIDATION_ERROR && !allowedUnsafe) {
    return { toasts: [], markDone: false, retryWithAllowUnsafe: true };
  }
  if (result.success) {
    const toasts: ExportToast[] = [];
    if (result.fallbackTriggered) {
      toasts.push({ type: 'info', message: 'This browser cannot share images, so the image was downloaded instead.', duration: 5000 });
    }
    if (result.logoOmitted) {
      toasts.push({
        type: 'warning',
        message: 'The logo was left out of this file because it could not be loaded from its web address. Upload the logo as an image file to include it.',
        duration: 7000,
      });
    }
    return { toasts, markDone: Boolean(result.format), retryWithAllowUnsafe: false };
  }
  if (result.error?.name === 'AbortError') return { toasts: [], markDone: false, retryWithAllowUnsafe: false };
  return {
    toasts: [{
      type: 'error',
      message: result.error?.message || `Could not export the QR code${result.format ? ` as ${result.format.toUpperCase()}` : ''}. Try again, or pick another format.`,
      duration: 5000,
    }],
    markDone: false,
    retryWithAllowUnsafe: false,
  };
}
