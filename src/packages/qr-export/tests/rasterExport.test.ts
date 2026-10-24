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

// @vitest-environment jsdom
/**
 * The PNG path decodes (#1610): renderQRRaster draws the real export into a software canvas,
 * and our own decoder must read back exactly the payload, at every size the download menu
 * offers. A renderer that draws nothing, or the wrong payload, fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { qrReader } from '../../../../tests/fixtures/qrReader';
import { RasterContext, toContext } from '../../../../tests/fixtures/rasterContext';
import type { QRConfig } from '@/packages/core/types';
import { renderQRRaster } from '../index';
import { EXPORT_CASES } from './exportCases';

/** The sizes in the download menu (ExportOptions: screen, print, poster). */
const SIZE_PRESETS = [512, 2048, 4096];

/** A logo image that loads at once; the software canvas draws it as an opaque grey square. */
class LoadedImage {
  crossOrigin = '';
  naturalWidth = 64;
  complete = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

let rasters: Map<HTMLCanvasElement, RasterContext>;

beforeEach(() => {
  rasters = new Map();
  vi.stubGlobal('Image', LoadedImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const raster = new RasterContext(this.width, this.height);
    rasters.set(this, raster);
    return toContext(raster);
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Renders the PNG export of `config` and decodes it. */
async function decodeRaster(config: QRConfig, width: number): Promise<string | undefined> {
  const canvas = await renderQRRaster(config, width);
  const raster = rasters.get(canvas);
  if (!raster) throw new Error('renderQRRaster drew on no canvas');
  expect(raster.canvas).toEqual({ width, height: width });
  return qrReader.read(raster.data, width, width)[0]?.text;
}

describe('PNG export decodes back to its payload (#1610)', () => {
  it.each(SIZE_PRESETS)('at %i px', async (width) => {
    const config = EXPORT_CASES[0].config;
    expect(await decodeRaster(config, width)).toBe(config.value);
  }, 60_000);

  it.each(EXPORT_CASES)('for ', async ({ config }) => {
    expect(await decodeRaster(config, 1024)).toBe(config.value);
  }, 60_000);
});
