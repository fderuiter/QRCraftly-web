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

import { buildMatrix, isFinderPattern, type QrEncoder } from '@/packages/qr-matrix';
import { QRErrorCorrectionLevel, QRType } from '@/types';

/** Reed-Solomon error correction tier. */
export type EccLevel = 'L' | 'M' | 'Q' | 'H';

/** All error correction tiers, weakest first. */
export const ECC_LEVELS: readonly EccLevel[] = ['L', 'M', 'Q', 'H'];

/** Payload encoded when the requested payload cannot be encoded. */
export const FALLBACK_PAYLOAD = 'https://qrcraftly.com';

/**
 * A QR module matrix built once for an arcade target. Both game modes and the scannability
 * frame painter read the same matrix, so there is exactly one encode per target.
 */
export interface TargetMatrix {
  /** Modules along one side. */
  size: number;
  /** Row-major module values (1 = dark). */
  modules: Uint8Array;
  /** Payload actually encoded (the fallback when the requested payload could not be encoded). */
  payload: string;
  /** Error correction tier actually used. */
  ecc: EccLevel;
  /** Whether the requested payload failed to encode and the fallback was used. */
  usedFallback: boolean;
}

function toErrorCorrectionLevel(ecc: EccLevel): QRErrorCorrectionLevel {
  switch (ecc) {
    case 'L':
      return QRErrorCorrectionLevel.L;
    case 'M':
      return QRErrorCorrectionLevel.M;
    case 'Q':
      return QRErrorCorrectionLevel.Q;
    case 'H':
      return QRErrorCorrectionLevel.H;
  }
}

function encode(payload: string, ecc: EccLevel, encoder: QrEncoder): TargetMatrix {
  // The payload is already the exact string the generator encodes (see `targetFromConfig`,
  // which applies `resolveEncodedValue`), so it is encoded verbatim here.
  const matrix = buildMatrix({ type: QRType.TEXT, value: payload, errorCorrectionLevel: toErrorCorrectionLevel(ecc) }, encoder);
  const size = matrix.size;
  const modules = new Uint8Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      modules[r * size + c] = matrix.get(r, c) ? 1 : 0;
    }
  }
  return { size, modules, payload, ecc, usedFallback: false };
}

/**
 * Builds the module matrix for an arcade target.
 * @param payload - Text to encode. Empty or unencodable payloads fall back to {@link FALLBACK_PAYLOAD}.
 * @param ecc - Error correction tier.
 * @param encoder - The QR encoder (`loadQrEncoder` from `@/packages/qr-matrix`).
 * @returns The matrix.
 */
export function buildTargetMatrix(payload: string, ecc: EccLevel, encoder: QrEncoder): TargetMatrix {
  if (payload.length > 0) {
    try {
      return encode(payload, ecc, encoder);
    } catch {
      // Too long for any QR version: fall through to the fallback payload.
    }
  }
  return { ...encode(FALLBACK_PAYLOAD, ecc, encoder), usedFallback: true };
}

/** Modules along one side of {@link blankTargetMatrix}: a version 2 symbol. */
const BLANK_SIZE = 25;

/**
 * An all-light matrix that stands in for a target while the encoder loads, so the game keeps its
 * layout before the first real encode.
 * @param payload - The payload the real matrix will encode.
 * @param ecc - Error correction tier.
 * @returns A blank matrix.
 */
export function blankTargetMatrix(payload: string, ecc: EccLevel): TargetMatrix {
  return { size: BLANK_SIZE, modules: new Uint8Array(BLANK_SIZE * BLANK_SIZE), payload, ecc, usedFallback: false };
}

/**
 * Whether a module is dark.
 * @param matrix - The matrix.
 * @param r - Row.
 * @param c - Column.
 * @returns True for a dark module; false for light or out-of-range modules.
 */
export function isDarkModule(matrix: TargetMatrix, r: number, c: number): boolean {
  if (r < 0 || c < 0 || r >= matrix.size || c >= matrix.size) return false;
  return matrix.modules[r * matrix.size + c] === 1;
}

/** Identifier of one of the three 7x7 corner finder patterns. */
export type FinderId = 'topLeft' | 'topRight' | 'bottomLeft';

/**
 * Which corner finder pattern a module belongs to. Uses the finder geometry shared with the
 * renderer (`isFinderPattern` from `@/packages/qr-matrix`).
 * @param r - Row.
 * @param c - Column.
 * @param size - Modules along one side.
 * @returns The finder, or null outside the finder patterns.
 */
export function finderAt(r: number, c: number, size: number): FinderId | null {
  if (!isFinderPattern(r, c, size)) return null;
  if (r < 7) return c < 7 ? 'topLeft' : 'topRight';
  return 'bottomLeft';
}
