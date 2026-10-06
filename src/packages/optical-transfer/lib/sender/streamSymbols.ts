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
 * One QR version for a whole single-code stream (#1306). The manifest frame is shorter than a data
 * frame, so left to itself the encoder gives it a smaller code, and on a fixed-size canvas that
 * code's larger modules and wider quiet zone make the picture shrink every 16th frame.
 */
import { QrEncodeError, type QrEccLetter, type QrSymbol, type QrSymbolEncoder } from '@/packages/qr-matrix/encoder';
import { ALPHANUMERIC_CAPACITY } from '../fountain/session';

/** Levels from strongest to weakest. */
const LEVELS: readonly QrEccLetter[] = ['H', 'Q', 'M', 'L'];

/** Frame texts a version is chosen from: frame 0 is a manifest and frame 1 a data frame. */
export interface StreamFrameSource {
  frameText(index: number): string;
}

/** The smallest version whose alphanumeric capacity at `level` holds `length` characters, or 0. */
function smallestVersion(length: number, level: QrEccLetter): number {
  return ALPHANUMERIC_CAPACITY[level].findIndex((capacity) => capacity >= length) + 1;
}

/**
 * The version every frame of a single-code stream is drawn at: the data frames' own version at the
 * stream's level, or the manifest's at level L when that is larger (a tiny file). Frames are Base45,
 * which QR codes hold in alphanumeric mode.
 * @param stream - The stream.
 * @param level - The stream's error correction level.
 * @returns A QR version, or 0 when a frame is too long for the table (the encoder then picks).
 */
export function streamVersionOf(stream: StreamFrameSource, level: QrEccLetter): number {
  const data = smallestVersion(stream.frameText(1).length, level);
  const manifest = smallestVersion(stream.frameText(0).length, 'L');
  return data && manifest ? Math.max(data, manifest) : 0;
}

/**
 * Encodes one frame at the stream's version. A frame that does not fit at the stream's level (the
 * manifest of a Reliable stream) drops to a weaker level at the same version, so the code keeps its
 * size; only text no level holds there gets the smallest version that holds it.
 * @param encoder - The QR encoder.
 * @param text - The frame's text.
 * @param level - The stream's error correction level.
 * @param version - The stream's version, or 0 to let the encoder pick.
 * @returns The symbol.
 */
export function encodeStreamFrame(encoder: QrSymbolEncoder, text: string, level: QrEccLetter, version: number): QrSymbol {
  if (version > 0) {
    for (const candidate of LEVELS.slice(LEVELS.indexOf(level))) {
      try {
        return encoder.create(text, { errorCorrectionLevel: candidate, version });
      } catch (error) {
        if (!(error instanceof QrEncodeError) || error.kind !== 'too-long') throw error;
      }
    }
  }
  return encoder.create(text, { errorCorrectionLevel: level });
}
