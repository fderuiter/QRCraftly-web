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

/** Messages between the multi-code receiver and its decoder workers (#1142). */
import type { QrPoint, QrReadLevel, QrTile } from '@/packages/qr-decode';

/** One camera frame to read. The bitmap is transferred and closed by the worker. */
export interface TileReadRequest {
  id: number;
  image: ImageBitmap;
  /** The tracked tiles to read from their corners, or null for a full search. */
  tiles: QrTile[] | null;
}

/** One code a worker read. Corners are top-left, top-right, bottom-right, bottom-left, in frame pixels. */
export interface TileCode {
  text: string;
  corners: [QrPoint, QrPoint, QrPoint, QrPoint];
  version: number;
  level: QrReadLevel;
}

export interface TileReadResponse {
  id: number;
  /** A search's codes, best first; or one entry per tracked tile, null where it did not read. */
  codes: Array<TileCode | null>;
  error?: string;
}
