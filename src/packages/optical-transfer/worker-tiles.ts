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
 * One worker of the multi-code receiver's decoder pool (#1142). It reads a camera frame either
 * as a full search for every code in it, or, once the tiles are tracked, as the fast path that
 * reads each tile from its known corners without searching.
 */
import { loadQrReader, type QrReader } from '@/packages/qr-decode';
import type { TileReadRequest, TileReadResponse, TileCode } from './lib/receiver/tileContracts';

let reader: Promise<QrReader> | null = null;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function pixelsOf(image: ImageBitmap): Uint8ClampedArray | null {
  if (!canvas || canvas.width !== image.width || canvas.height !== image.height) {
    canvas = new OffscreenCanvas(image.width, image.height);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height).data;
}

async function read(request: TileReadRequest): Promise<TileReadResponse> {
  const { id, image, tiles } = request;
  try {
    reader ??= loadQrReader();
    const qr = await reader;
    const pixels = pixelsOf(image);
    if (!pixels) return { id, codes: [], error: 'No 2D canvas in this worker.' };
    const reads = tiles ? qr.readTracked(pixels, image.width, image.height, tiles) : qr.read(pixels, image.width, image.height, { maxCodes: 8 });
    const codes: Array<TileCode | null> = reads.map((code) => (code ? { text: code.text, corners: code.corners, version: code.version, level: code.level } : null));
    return { id, codes };
  } catch (error) {
    // A reader that failed to load is tried again with the next frame.
    reader = null;
    return { id, codes: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    image.close();
  }
}

self.onmessage = (event: MessageEvent<TileReadRequest>) => {
  void read(event.data).then((response) => self.postMessage(response));
};
