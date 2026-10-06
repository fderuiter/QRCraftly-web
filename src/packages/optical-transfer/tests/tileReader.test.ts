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

import { describe, expect, it } from 'vitest';
import { qrEncoder } from '../../../../tests/fixtures/qrEncoder';
import { qrReader } from '../../../../tests/fixtures/qrReader';
import {
  TILE_LAYOUTS,
  TILE_QUIET_MODULES,
  TileReadSession,
  createPrismSession,
  createTileReader,
  layoutForCodes,
  tileFrameIndex,
  type PrismStream,
  type TileCode,
  type TileLayout,
  type TileReadRequest,
  type TileReadResponse,
  type TileWorker,
} from '../index';

const layout = TILE_LAYOUTS['2x2-v20'];
const MODULE_PX = 3;
const MARGIN = 40;

interface Grey {
  grey: Uint8ClampedArray;
  width: number;
  height: number;
}

async function tileStream(): Promise<PrismStream> {
  const bytes = Uint8Array.from({ length: 6000 }, (_, i) => (i * 31 + 7) % 251);
  const session = await createPrismSession(bytes, { fileName: 't.bin', mimeType: 'image/png', errorCorrectionLevel: 'L', maxVersion: 20, tile: layout });
  return session.stream;
}

/** Paints the tiles of one slot as a camera would see a sharp, level screen. */
function paintSlot(stream: PrismStream, target: TileLayout, slot: number): Grey {
  const pitch = (target.modules + 2 * TILE_QUIET_MODULES) * MODULE_PX;
  const width = target.columns * pitch + 2 * MARGIN;
  const height = target.rows * pitch + 2 * MARGIN;
  const grey = new Uint8ClampedArray(width * height).fill(128);
  for (let tile = 0; tile < target.tiles; tile++) {
    const matrix = qrEncoder.create(stream.frameText(tileFrameIndex(target, tile, slot)), { errorCorrectionLevel: 'L', version: target.version }).modules;
    const left = MARGIN + (tile % target.columns) * pitch;
    const top = MARGIN + Math.floor(tile / target.columns) * pitch;
    for (let y = 0; y < pitch; y++) grey.fill(250, (top + y) * width + left, (top + y) * width + left + pitch);
    for (let row = 0; row < matrix.size; row++) {
      for (let column = 0; column < matrix.size; column++) {
        if (!matrix.data[row * matrix.size + column]) continue;
        for (let dy = 0; dy < MODULE_PX; dy++) {
          const start = (top + (row + TILE_QUIET_MODULES) * MODULE_PX + dy) * width + left + (column + TILE_QUIET_MODULES) * MODULE_PX;
          grey.fill(10, start, start + MODULE_PX);
        }
      }
    }
  }
  return { grey, width, height };
}

/** What the decoder worker does, on the test's thread. */
function readFrame(frame: Grey, tiles: TileReadRequest['tiles']): Array<TileCode | null> {
  const reads = tiles ? qrReader.readTracked(frame.grey, frame.width, frame.height, tiles) : qrReader.read(frame.grey, frame.width, frame.height, { maxCodes: 8 });
  return reads.map((code) => (code ? { text: code.text, corners: code.corners, version: code.version, level: code.level } : null));
}

describe('multi-code receiver (#1142)', () => {
  it('names the layout from the version and number of codes a search found', () => {
    expect(layoutForCodes(20, 4)?.id).toBe('2x2-v20');
    expect(layoutForCodes(20, 5)?.id).toBe('3x2-v20');
    expect(layoutForCodes(25, 3)?.id).toBe('2x2-v25');
    expect(layoutForCodes(40, 1)?.id).toBe('1xv40');
    expect(layoutForCodes(11, 1)).toBeNull();
  });

  it('searches once, then reads every tile from its corners until tracking is lost', async () => {
    const stream = await tileStream();
    const session = new TileReadSession();
    const first = paintSlot(stream, layout, 0);

    expect(session.plan(first)).toBeNull();
    const found = session.report(null, readFrame(first, null));
    expect(found).toHaveLength(4);
    expect(session.isTracking).toBe(true);

    // The next slot's content is read on the fast path, from the corners the search found.
    const second = paintSlot(stream, layout, 1);
    const plan = session.plan(second);
    expect(plan?.tiles).toHaveLength(4);
    expect(plan?.tiles.every((tile) => tile.version === 20 && tile.level === 'L')).toBe(true);
    const read = session.report(plan, readFrame(second, plan?.tiles ?? null));
    const expected = [0, 1, 2, 3].map((tile) => stream.frameText(tileFrameIndex(layout, tile, 1)));
    expect(read.map((code) => code.text).sort()).toEqual([...expected].sort());

    // Frames with nothing in view lose the tiles, and the reader goes back to a full search.
    const blank = { grey: new Uint8ClampedArray(second.width * second.height).fill(128), width: second.width, height: second.height };
    for (let i = 0; i < 3; i++) {
      const lostPlan = session.plan(blank);
      session.report(lostPlan, readFrame(blank, lostPlan?.tiles ?? null));
    }
    expect(session.isTracking).toBe(false);
    expect(session.plan(blank)).toBeNull();
  });

  it('keeps searching every frame for a stream of one small code', () => {
    const session = new TileReadSession();
    const text = 'not a tile';
    const code = qrEncoder.create(text, { errorCorrectionLevel: 'M' }).modules;
    const side = (code.size + 8) * 4;
    const grey = new Uint8ClampedArray(side * side).fill(255);
    for (let row = 0; row < code.size; row++) {
      for (let column = 0; column < code.size; column++) {
        if (!code.data[row * code.size + column]) continue;
        for (let dy = 0; dy < 4; dy++) grey.fill(0, ((row + 4) * 4 + dy) * side + (column + 4) * 4, ((row + 4) * 4 + dy) * side + (column + 5) * 4);
      }
    }
    const frame = { grey, width: side, height: side };
    expect(session.report(null, readFrame(frame, null)).map((read) => read.text)).toEqual([text]);
    expect(session.isTracking).toBe(false);
    expect(session.plan(frame)).toBeNull();
  });

  it('runs frames through its workers, tracks the tiles and reports each frame once', async () => {
    const stream = await tileStream();
    let frame = paintSlot(stream, layout, 0);
    const requests: Array<TileReadRequest['tiles']> = [];
    const callbacks: Array<() => void> = [];
    const video = {
      readyState: 4,
      videoWidth: frame.width,
      videoHeight: frame.height,
      requestVideoFrameCallback: (callback: () => void) => callbacks.push(callback),
      cancelVideoFrameCallback: () => undefined,
    };
    const spawnWorker = (): TileWorker => {
      const worker: TileWorker = {
        onmessage: null,
        postMessage(message: TileReadRequest) {
          requests.push(message.tiles);
          const response: TileReadResponse = { id: message.id, codes: readFrame(frame, message.tiles) };
          queueMicrotask(() => worker.onmessage?.(new MessageEvent('message', { data: response })));
        },
        terminate: () => undefined,
      };
      return worker;
    };
    const texts: string[] = [];
    const reader = createTileReader({
      getVideo: () => video,
      poolSize: 2,
      onText: (text) => texts.push(text),
      spawnWorker,
      grab: async () => {
        const bitmap: Partial<ImageBitmap> = { width: frame.width, height: frame.height, close: () => undefined };
        return bitmap as ImageBitmap;
      },
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const nextFrame = async () => {
      callbacks.shift()?.();
      await settle();
      await settle();
    };

    reader.start();
    await nextFrame();
    await nextFrame();
    frame = paintSlot(stream, layout, 1);
    await nextFrame();
    reader.stop();

    expect(requests[0]).toBeNull();
    expect(requests.at(-1)).toHaveLength(4);
    const expected = [0, 1].flatMap((slot) => [0, 1, 2, 3].map((tile) => stream.frameText(tileFrameIndex(layout, tile, slot))));
    // Data frames reach the receiver once however often they are read; the manifest repeats on purpose.
    expect(new Set(texts)).toEqual(new Set(expected));
    expect(texts).toHaveLength(expected.length + 1);
  });
});
