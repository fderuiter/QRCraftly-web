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
 * Worst-case Grunge eyes (#1397). The eye outline comes from a seeded generator; here it is
 * replaced by fixed patterns of the most extreme values, so every outline the generator could
 * pick is bounded by these. Each one must still decode.
 */

import { describe, it, expect, vi } from 'vitest';

let pattern: number[] = [0.5];
vi.mock('../lib/prng', () => ({
  seedRandom: () => {
    let i = 0;
    return () => pattern[i++ % pattern.length];
  },
}));

import { qrEncoder as QRCode } from '../../../../tests/fixtures/qrEncoder';
import { qrReader } from '../../../../tests/fixtures/qrReader';
import { DEFAULT_CONFIG } from '@/constants';
import { type QRConfig, QRStyle } from '@/types';
import { drawQRInternal, clearFluidCache } from '../index';
import { RasterContext, toContext } from './rasterContext';

const HIGH = 0.999999;
// All small, all large, alternating, and the vertex patterns that broke the old outline range.
const PATTERNS: Record<string, number[]> = {
  'all small': [0],
  'all large': [HIGH],
  'alternating small first': [0, HIGH],
  'alternating large first': [HIGH, 0],
  'large on one side': [HIGH, HIGH, HIGH, HIGH, 0, 0, 0, 0],
  'large on the other side': [0, 0, 0, 0, HIGH, HIGH, HIGH, HIGH],
  'one small vertex': [0, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH, HIGH],
  'one large vertex': [HIGH, 0, 0, 0, 0, 0, 0, 0],
};

const CASES = [
  { value: 'https://example.com', size: 240 },
  { value: 'https://example.com', size: 1000 },
  { value: 'https://qrcraftly.com/a/much/longer/path?with=query&and=more-0123456789abcdef', size: 300 },
];

describe('worst-case Grunge eye outlines still decode (#1397)', () => {
  for (const [name, values] of Object.entries(PATTERNS)) {
    for (const { value, size } of CASES) {
      it(`decodes ${value.length} characters at ${size} px (${name})`, () => {
        pattern = values;
        const config: QRConfig = {
          ...(DEFAULT_CONFIG as QRConfig),
          value,
          fgColor: '#000000',
          bgColor: '#ffffff',
          eyeColor: '#000000',
          style: QRStyle.GRUNGE,
          gradientType: 'none',
          logoUrl: null,
          isBorderEnabled: false,
          frameStyle: 'none',
        };
        const qr = QRCode.create(value, { errorCorrectionLevel: config.errorCorrectionLevel });
        const modules = qr.modules as unknown as { size: number };
        const raster = new RasterContext(size, size);
        clearFluidCache();
        drawQRInternal(toContext(raster), modules as never, config, null, null, size, modules.size);
        expect(qrReader.read(raster.data, size, size)[0]?.text).toBe(value);
      });
    }
  }
});
