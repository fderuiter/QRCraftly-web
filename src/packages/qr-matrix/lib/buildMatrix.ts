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

import { QRType, type QRConfig, type QRErrorCorrectionLevel, type QRModules } from '@/types';
import { normalizeUrl, shouldNormalizeUrl } from '@/utils/url';

/**
 * The part of a QR encoder that matrix building needs: Reed-Solomon encoding plus module layout.
 */
export interface QrEncoder {
  create(value: string, options: { errorCorrectionLevel: QRErrorCorrectionLevel }): { modules: QRModules };
}

/** The fields of a configuration that decide which modules are dark. */
export type MatrixSource = Pick<QRConfig, 'type' | 'value' | 'errorCorrectionLevel'>;

/**
 * Returns the exact string that gets encoded: URL payloads are normalized first
 * (for example `example.com` becomes `https://example.com`), everything else is unchanged.
 */
export function resolveEncodedValue(source: Pick<QRConfig, 'type' | 'value'>): string {
  const { type, value } = source;
  return type === QRType.URL && shouldNormalizeUrl(value) ? normalizeUrl(value) : value;
}

/**
 * Builds the QR module matrix for a configuration. This is the single place that turns a
 * configuration into modules, so the canvas, workers, animations and SVG export all encode
 * the same string.
 * @param source The payload type, value and error correction level.
 * @param encoder The encoder to use; callers load it with `loadQrEncoder` (./encoder) or inject a fake.
 * @throws When the encoder rejects the value (for example an empty or oversized payload).
 */
export function buildMatrix(source: MatrixSource, encoder: QrEncoder): QRModules {
  return encoder.create(resolveEncodedValue(source), {
    errorCorrectionLevel: source.errorCorrectionLevel,
  }).modules;
}
