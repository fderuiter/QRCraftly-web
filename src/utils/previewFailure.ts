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

import { QRErrorCorrectionLevel } from '../types';

/**
 * Why the preview could not draw a code (#1251): the content is blocked by validation, it is
 * too long for the error-correction level, or the encoder rejected it for another reason.
 */
export type PreviewFailure = 'blocked' | 'too-long' | 'failed';

/** Bytes a version 40 code holds at each error-correction level (byte mode). */
const BYTE_CAPACITY: Record<QRErrorCorrectionLevel, number> = {
  [QRErrorCorrectionLevel.L]: 2953,
  [QRErrorCorrectionLevel.M]: 2331,
  [QRErrorCorrectionLevel.Q]: 1663,
  [QRErrorCorrectionLevel.H]: 1273,
};

const LEVEL_NAMES: Record<QRErrorCorrectionLevel, string> = {
  [QRErrorCorrectionLevel.L]: 'Low',
  [QRErrorCorrectionLevel.M]: 'Medium',
  [QRErrorCorrectionLevel.Q]: 'Quartile',
  [QRErrorCorrectionLevel.H]: 'High',
};

/** Explains that the content does not fit, with the limit and what to try next. */
export function tooLongMessage(level: QRErrorCorrectionLevel): string {
  const limit = BYTE_CAPACITY[level] ?? BYTE_CAPACITY[QRErrorCorrectionLevel.H];
  const name = LEVEL_NAMES[level] ?? LEVEL_NAMES[QRErrorCorrectionLevel.H];
  const advice = level === QRErrorCorrectionLevel.L
    ? 'Shorten the content.'
    : 'Shorten the content or choose a lower error correction level.';
  return `This content is too long for one QR code at ${name} error correction (about ${limit.toLocaleString('en-US')} bytes at most). ${advice}`;
}

/** The message shown when an export is refused because the preview has no code to export. */
export function previewFailureMessage(reason: PreviewFailure, level: QRErrorCorrectionLevel): string {
  if (reason === 'too-long') return tooLongMessage(level);
  if (reason === 'blocked') return 'Fix the highlighted content first. There is no QR code to export yet.';
  return 'This content could not be turned into a QR code. Check the content and try again.';
}
