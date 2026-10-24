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
 * How fast each module style draws a version 9 code with a logo (#1608). A benchmark, not a test:
 * `pnpm run test:slow` prints the numbers and nothing here fails on time.
 */
import { bench, describe } from 'vitest';
import { getLogoMetrics, renderModules } from '../index';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { type QRConfig, QRErrorCorrectionLevel, QRStyle } from '@/packages/core/types';

const MODULE_COUNT = 53;
const CELL_SIZE = 10;

const modules = {
  size: MODULE_COUNT,
  get: (r: number, c: number) => (r + c) % 2 === 0,
};

const ctx = {
  fillStyle: '',
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  closePath: () => {},
  fill: () => {},
  stroke: () => {},
  rect: () => {},
  arc: () => {},
  roundRect: () => {},
  quadraticCurveTo: () => {},
} as any;

describe('renderModules', () => {
  for (const style of [QRStyle.HIVE, QRStyle.STARBURST, QRStyle.MODERN, QRStyle.CIRCUIT, QRStyle.SWISS, QRStyle.FLUID, QRStyle.STANDARD]) {
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      style,
      logoUrl: 'https://example.com/logo.png',
      logoSize: 0.2,
      logoPadding: 1,
      logoPaddingStyle: 'circle',
      errorCorrectionLevel: QRErrorCorrectionLevel.H,
    };
    const logoMetrics = getLogoMetrics(config, MODULE_COUNT, CELL_SIZE);

    bench(style, () => {
      renderModules(ctx, modules as any, config, 0, 0, CELL_SIZE, MODULE_COUNT, logoMetrics);
    });
  }
});
