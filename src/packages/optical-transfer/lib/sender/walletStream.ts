/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { loadQrEncoder } from '@/packages/qr-matrix/encoder';
import { ALPHANUMERIC_CAPACITY, TRANSFER_DENSITY_PROFILES, type StreamErrorCorrection, type TransferDensity } from '../fountain/session';
import type { TransferFrame } from './useOpticalSender';

/**
 * Characters a multipart UR adds around its fragment, at most: `UR:BYTES/` (9), a sequence
 * `<seq>-<n>/` of up to 22, and the Bytewords of the CBOR part header (up to 24 bytes) and its
 * CRC-32 (4 bytes), at two letters a byte.
 */
const UR_PART_OVERHEAD_CHARS = 9 + 22 + 2 * (24 + 4);

/**
 * Largest BC-UR fragment whose part still fits a QR code of this version and error correction in
 * alphanumeric mode, so every frame of the stream is the same size.
 * @param errorCorrectionLevel Error correction of the frames.
 * @param version QR version of the frames.
 * @returns Fragment length in bytes, at least 1.
 */
export function walletFragmentLength(errorCorrectionLevel: StreamErrorCorrection, version: number): number {
  return Math.max(1, Math.floor((ALPHANUMERIC_CAPACITY[errorCorrectionLevel][version - 1] - UR_PART_OVERHEAD_CHARS) / 2));
}

/** A wallet-compatible stream: real BCR-2024-001 `ur:bytes` parts, one per frame. */
export interface WalletStream {
  /** Parts a receiver needs at the least; the first this many frames are the pure fragments. */
  readonly fragmentCount: number;
  /** Frames made so far. */
  readonly shown: number;
  /** @returns The next part's QR modules. */
  nextFrame(): TransferFrame;
}

/**
 * Opens a stream that BC-UR wallets and tools can read (#1149). The file's bytes go out as a
 * `ur:bytes` payload with no name or type, in uppercase so the QR codes use alphanumeric mode.
 * @param bytes The file.
 * @param density Sets the frames' QR version and error correction, as for a Prism stream.
 * @returns The stream.
 */
export async function openWalletStream(bytes: Uint8Array, density: TransferDensity): Promise<WalletStream> {
  const { errorCorrectionLevel, maxVersion } = TRANSFER_DENSITY_PROFILES[density];
  // The codec loads only when someone sends in this mode.
  const [{ BcUrEncoder }, qr] = await Promise.all([import('../../bcur'), loadQrEncoder()]);
  const encoder = BcUrEncoder.forBytes(bytes, walletFragmentLength(errorCorrectionLevel, maxVersion));
  let shown = 0;
  return {
    fragmentCount: encoder.fragmentCount,
    get shown() {
      return shown;
    },
    nextFrame() {
      shown += 1;
      const { size, data } = qr.create(encoder.nextPart().toUpperCase(), { errorCorrectionLevel, version: maxVersion }).modules;
      return { size, data };
    },
  };
}
