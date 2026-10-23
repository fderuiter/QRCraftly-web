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
import { simulatePrint, simulatePrintTs, type PixelFrame } from '../index';

function renderFrame(version: number, size: number, ink = 0): PixelFrame {
  const { modules } = qrEncoder.create('QR', { errorCorrectionLevel: 'M', version });
  const n = modules.size;
  const cell = size / (n + 8);
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / cell - 4);
      const col = Math.floor(x / cell - 4);
      const dark = row >= 0 && col >= 0 && row < n && col < n && modules.get(row, col);
      const i = (y * size + x) * 4;
      if (dark) data[i] = data[i + 1] = data[i + 2] = ink;
      data[i + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

describe('optical simulation differential tests (Rust WASM vs TS Oracle)', () => {
  it.each([1, 2, 5, 10, 20])('produces byte-identical simulation output for version %i', (version) => {
    const frame = renderFrame(version, 512);
    const [code] = qrReader.read(frame.data, frame.width, frame.height);
    expect(code).toBeDefined();

    const wasmOutput = simulatePrint(frame, code);
    const tsOutput = simulatePrintTs(frame, code);

    expect(wasmOutput.width).toBe(tsOutput.width);
    expect(wasmOutput.height).toBe(tsOutput.height);
    expect(wasmOutput.data.length).toBe(tsOutput.data.length);

    // Assert that WASM kernel matches TypeScript oracle output byte for byte
    expect(Array.from(wasmOutput.data)).toEqual(Array.from(tsOutput.data));
  });

  it('matches across different ink intensities and frame dimensions', () => {
    const frame = renderFrame(4, 384, 50);
    const [code] = qrReader.read(frame.data, frame.width, frame.height);
    expect(code).toBeDefined();

    const wasmOutput = simulatePrint(frame, code);
    const tsOutput = simulatePrintTs(frame, code);

    expect(Array.from(wasmOutput.data)).toEqual(Array.from(tsOutput.data));
  });
});
