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

import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { QRErrorCorrectionLevel, QRStyle, QRType, type QRConfig } from '@/packages/core/types';
import { getSamplePayload } from '@/packages/qr-payload';
import { SYSTEM_LIMITS } from '@/packages/scannability';
import { SCAN_VALIDATION_ERROR } from '@/hooks/useQRDownload';
import {
  deriveVerdict,
  exportBlockReason,
  exportDecision,
  fixPatch,
  isEmptyValue,
  resetPatch,
  resolveEffectiveConfig,
  type ExportAction,
} from './decisions';

const config = (value: string, type: QRType = QRType.URL): QRConfig => ({ ...DEFAULT_CONFIG, type, value });
const ACTIONS: ExportAction[] = ['download', 'copy', 'share', 'wallet'];
const healthy = { status: 'physical-pass' as const, health: undefined };
const failing = { status: 'fail' as const, health: { score: 20, warnings: [], criticalWarnings: ['Low contrast'] } };

const named = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('resolveEffectiveConfig', () => {
  it.each([QRType.URL, QRType.TEXT, QRType.WIFI, QRType.EMAIL])('shows the %s sample for a blank or whitespace-only value', (type) => {
    const sample = getSamplePayload(type);
    for (const value of ['', '   \n']) {
      const isEmpty = isEmptyValue(value);
      expect(isEmpty).toBe(true);
      expect(resolveEffectiveConfig(config(value, type), { refused: false, isEmpty, sample }).value).toBe(sample);
    }
  });

  it.each([QRType.URL, QRType.TEXT, QRType.WIFI])('draws nothing for a refused %s field, even over the sample (#1279)', (type) => {
    const sample = getSamplePayload(type);
    expect(resolveEffectiveConfig(config('old content', type), { refused: true, isEmpty: false, sample }).value).toBe('');
    expect(resolveEffectiveConfig(config('', type), { refused: true, isEmpty: true, sample }).value).toBe('');
  });

  it('keeps a filled config as it is', () => {
    const filled = config('https://example.com');
    expect(resolveEffectiveConfig(filled, { refused: false, isEmpty: false, sample: 'x' })).toBe(filled);
  });
});

describe('deriveVerdict', () => {
  const health = { score: 90, warnings: [], criticalWarnings: [] };

  it('passes the raw verdict through for a real code', () => {
    expect(deriveVerdict('digital-pass', health, { isEmpty: false, refused: false, previewFailed: false }))
      .toEqual({ noVerdict: false, status: 'digital-pass', health });
  });

  it.each([
    ['the sample', { isEmpty: true, refused: false, previewFailed: false }],
    ['a refused field', { isEmpty: false, refused: true, previewFailed: false }],
    ['a failed preview', { isEmpty: false, refused: false, previewFailed: true }],
  ])('reports idle with no health for %s (#1251)', (_label, input) => {
    expect(deriveVerdict('fail', health, input)).toEqual({ noVerdict: true, status: 'idle', health: undefined });
  });
});

describe('exportBlockReason', () => {
  const base = { config: config('https://example.com'), refused: false, isEmpty: false, previewFailure: null, verdict: healthy };

  it.each(ACTIONS)('allows %s for a healthy code', (action) => {
    expect(exportBlockReason({ ...base, action })).toBeNull();
  });

  it.each(ACTIONS)('refuses %s while the form is empty and the sample is shown', (action) => {
    expect(exportBlockReason({ ...base, config: config(''), isEmpty: true, action })).toEqual({ kind: 'empty' });
  });

  it.each(ACTIONS)('refuses %s while a field holds a refused value, before anything else', (action) => {
    expect(exportBlockReason({ ...base, refused: true, isEmpty: true, action })).toEqual({ kind: 'refused' });
  });

  it.each(ACTIONS)('refuses %s when the preview could not draw a code', (action) => {
    expect(exportBlockReason({ ...base, previewFailure: 'too-long', action })).toEqual({ kind: 'preview-failure', failure: 'too-long' });
  });

  it.each(ACTIONS)('refuses %s for a dangerous link even when it would otherwise gate', (action) => {
    expect(exportBlockReason({ ...base, config: config('javascript:alert(1)'), verdict: failing, action })).toEqual({ kind: 'dangerous-url' });
  });

  it.each<ExportAction>(['download', 'copy', 'share'])('gates %s on a failing verdict', (action) => {
    expect(exportBlockReason({ ...base, verdict: failing, action })).toEqual({ kind: 'scan-risk' });
  });

  it('lets the wallet card through a failing verdict, since it draws a plain code', () => {
    expect(exportBlockReason({ ...base, verdict: failing, action: 'wallet' })).toBeNull();
  });

  it('does not gate a warning verdict', () => {
    const warning = { status: 'digital-pass' as const, health: { score: 60, warnings: ['Busy pattern'], criticalWarnings: [] } };
    expect(exportBlockReason({ ...base, verdict: warning, action: 'download' })).toBeNull();
  });

  it('does not gate while the check is still running or recovering', () => {
    expect(exportBlockReason({ ...base, verdict: { status: 'checking', health: undefined }, action: 'download' })).toBeNull();
  });

  it('gates a critical warning even when the check passed', () => {
    const critical = { status: 'digital-pass' as const, health: { score: 85, warnings: [], criticalWarnings: ['Logo too large'] } };
    expect(exportBlockReason({ ...base, verdict: critical, action: 'copy' })).toEqual({ kind: 'scan-risk' });
  });
});

describe('fixPatch', () => {
  it('raises error correction to H', () => {
    expect(fixPatch('raise-error-correction')).toEqual({ errorCorrectionLevel: QRErrorCorrectionLevel.H });
  });

  it('switches to the standard pattern', () => {
    expect(fixPatch('standard-pattern')).toEqual({ style: QRStyle.STANDARD });
  });

  it('shrinks the logo to the largest safe size', () => {
    expect(fixPatch('smaller-logo')).toEqual({ logoSize: SYSTEM_LIMITS.MAX_LOGO_SIZE });
  });

  it('restores black on white for more contrast', () => {
    expect(fixPatch('increase-contrast')).toEqual({
      fgColor: '#000000',
      bgColor: '#ffffff',
      eyeColor: '#000000',
      eyeFrameColor: '#000000',
      eyeBallColor: '#000000',
    });
  });
});

describe('resetPatch', () => {
  it('puts the default colors back and clears the eye overrides', () => {
    expect(resetPatch()).toEqual({
      fgColor: DEFAULT_CONFIG.fgColor,
      bgColor: DEFAULT_CONFIG.bgColor,
      eyeColor: DEFAULT_CONFIG.eyeColor,
      eyeFrameColor: undefined,
      eyeBallColor: undefined,
    });
  });
});

describe('exportDecision', () => {
  it('marks a plain success done with no toast', () => {
    expect(exportDecision({ success: true, format: 'png' })).toEqual({ toasts: [], markDone: true, retryWithAllowUnsafe: false });
  });

  it('explains a share that fell back to a download', () => {
    const decision = exportDecision({ success: true, format: 'share', fallbackTriggered: true });
    expect(decision.markDone).toBe(true);
    expect(decision.toasts).toEqual([{ type: 'info', message: 'This browser cannot share images, so the image was downloaded instead.', duration: 5000 }]);
  });

  it('warns when the logo was left out', () => {
    expect(exportDecision({ success: true, format: 'svg', logoOmitted: true }).toasts).toEqual([
      expect.objectContaining({ type: 'warning', duration: 7000 }),
    ]);
  });

  it('says nothing for a cancelled picker or share sheet', () => {
    expect(exportDecision({ success: false, format: 'share', error: named('AbortError') })).toEqual({ toasts: [], markDone: false, retryWithAllowUnsafe: false });
  });

  it('offers a retry with allowUnsafe when the finished image failed the scan check (#1255)', () => {
    expect(exportDecision({ success: false, format: 'png', error: named(SCAN_VALIDATION_ERROR, 'Failed') }))
      .toEqual({ toasts: [], markDone: false, retryWithAllowUnsafe: true });
  });

  it('reports the scan failure instead of retrying again once allowUnsafe was used', () => {
    expect(exportDecision({ success: false, format: 'png', error: named(SCAN_VALIDATION_ERROR, 'Failed') }, true))
      .toEqual({ toasts: [{ type: 'error', message: 'Failed', duration: 5000 }], markDone: false, retryWithAllowUnsafe: false });
  });

  it('falls back to a generic message naming the format for an unknown error', () => {
    expect(exportDecision({ success: false, format: 'pdf' }).toasts).toEqual([
      { type: 'error', message: 'Could not export the QR code as PDF. Try again, or pick another format.', duration: 5000 },
    ]);
  });
});
