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
 * The optical print simulation (#1248), run for real: our encoder, our reader, no mocks. The
 * corpus pins the calibration. Plain codes must always pass, at every version, error correction
 * level and preview size, and designs a phone struggles with on paper must fail.
 */
import { describe, expect, it } from 'vitest';
import type { QrEccLetter } from '@/packages/qr-matrix/encoder';
import { qrEncoder } from '../../../../tests/fixtures/qrEncoder';
import { qrReader } from '../../../../tests/fixtures/qrReader';
import { performScannabilityCheck, type PixelFrame } from '../checker';
import { PRINT_PX_PER_MODULE, PRINT_QUIET_ZONE_MODULES, simulatePrint } from '../index';

interface Design {
  /** Dark module colour (grey level). */
  ink?: number;
  /** Radius of each data module's dot, in modules; omit for square modules. */
  dot?: number;
  /** Alpha of every pixel (0 = transparent). */
  alpha?: number;
}

/** Draws a code the way the preview canvas holds it: `size` pixels across, with a 4-module quiet zone. */
function render(version: number, level: QrEccLetter, size: number, design: Design = {}): PixelFrame {
  const { modules } = qrEncoder.create('QR', { errorCorrectionLevel: level, version });
  const n = modules.size;
  const cell = size / (n + 8);
  const ink = design.ink ?? 0;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const my = y / cell - 4;
      const mx = x / cell - 4;
      const row = Math.floor(my);
      const col = Math.floor(mx);
      let dark = row >= 0 && col >= 0 && row < n && col < n && modules.get(row, col);
      const finder = (row < 7 && col < 7) || (row < 7 && col >= n - 7) || (row >= n - 7 && col < 7);
      if (dark && design.dot !== undefined && !finder) {
        const dx = mx - col - 0.5;
        const dy = my - row - 0.5;
        dark = dx * dx + dy * dy <= design.dot * design.dot;
      }
      const i = (y * size + x) * 4;
      if (dark) data[i] = data[i + 1] = data[i + 2] = ink;
      data[i + 3] = design.alpha ?? 255;
    }
  }
  return { data, width: size, height: size };
}

const check = (frame: PixelFrame) => performScannabilityCheck(qrReader, frame, frame.width, frame.height);
const LEVELS: QrEccLetter[] = ['L', 'M', 'Q', 'H'];
const VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 25];
const SIZES = [512, 768, 1024];

describe('optical print simulation', () => {
  // One test per version keeps each well inside the test timeout on a slow CI runner.
  it.each(VERSIONS.map((version, v) => [version, v]))(
    'passes every plain version %i code, at every level and preview size (never "fragile")',
    (version, v) => {
      const fragile: string[] = [];
      LEVELS.forEach((level, l) => {
        const size = SIZES[(v + l) % SIZES.length];
        const result = check(render(version, level, size));
        expect(result.success).toBe(true);
        if (!result.physicalReady) fragile.push(`v${version}-${level}@${size}`);
      });
      expect(fragile).toEqual([]);
    },
  );

  it('passes dark grey and coloured-on-light designs a phone reads from paper', () => {
    expect(check(render(4, 'M', 512, { ink: 110 }))).toMatchObject({ success: true, physicalReady: true });
    expect(check(render(7, 'Q', 768, { dot: 0.45 }))).toMatchObject({ success: true, physicalReady: true });
  });

  it.each([2, 5, 8])('fails tiny dots that blur away on paper (version %i)', (version) => {
    expect(check(render(version, 'M', 512, { dot: 0.2 }))).toMatchObject({ success: true, physicalReady: false });
  });

  it('frames the code at a fixed scale, whatever the preview size', () => {
    const side = (25 + 2 * PRINT_QUIET_ZONE_MODULES) * PRINT_PX_PER_MODULE;
    for (const size of [300, 600, 1200]) {
      const frame = render(2, 'M', size);
      const [code] = qrReader.read(frame.data, frame.width, frame.height);
      const printed = simulatePrint(frame, code);
      expect([printed.width, printed.height, printed.data.length]).toEqual([side, side, side * side]);
    }
  });

  it('gives the same picture, and so the same verdict, every time', () => {
    const frame = render(6, 'L', 600);
    const [code] = qrReader.read(frame.data, frame.width, frame.height);
    const first = simulatePrint(frame, code).data.slice();
    expect(simulatePrint(frame, code).data).toEqual(first);
    expect(simulatePrint(frame, code, {}).data).toEqual(first);
  });

  it('shows paper through transparent pixels', () => {
    const frame = render(1, 'M', 300, { alpha: 0 });
    const corners = [
      { x: 41, y: 41 },
      { x: 259, y: 41 },
      { x: 259, y: 259 },
      { x: 41, y: 259 },
    ] as const;
    const printed = simulatePrint(frame, { corners, version: 1 });
    expect(Math.min(...printed.data)).toBeGreaterThanOrEqual(229);
    expect(Math.max(...printed.data)).toBeLessThanOrEqual(241);
  });
});
