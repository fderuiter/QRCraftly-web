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

/**
 * The QR encoder on its own (#1177), for workers and scripts that need nothing
 * else from this package: `loadQrEncoder`, `createQrEncoder` and their types.
 */
export {
  loadQrEncoder,
  createQrEncoder,
  QrEncodeError,
  QR_ENCODE_WASM_URL,
  type QrSymbolEncoder,
  type QrSymbol,
  type QrModuleGrid,
  type QrEncodeOptions,
  type QrEncodeErrorKind,
  type QrEncodedSegment,
  type QrSegmentInput,
  type QrSegmentMode,
  type QrEccLetter,
} from './lib/encoder';
