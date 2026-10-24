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
 * How fast the logo-coverage test answers for every module of a version 9 code (#1608). A
 * benchmark, not a test: `pnpm run test:slow` prints the numbers and nothing here fails on time.
 */
import { bench, describe } from 'vitest';
import { getLogoMetrics, getIsCoveredByLogo } from '../index';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { type QRConfig, QRErrorCorrectionLevel } from '@/packages/core/types';

const MODULE_COUNT = 53;
const CELL_SIZE = 10;

const config: QRConfig = {
  ...DEFAULT_CONFIG,
  logoUrl: 'https://example.com/logo.png',
  logoSize: 0.2,
  logoPadding: 1,
  logoPaddingStyle: 'circle',
  errorCorrectionLevel: QRErrorCorrectionLevel.H,
};

describe('getIsCoveredByLogo', () => {
  const isCovered = getIsCoveredByLogo(config, MODULE_COUNT, getLogoMetrics(config, MODULE_COUNT, CELL_SIZE));

  bench(`every module of a ${MODULE_COUNT}x${MODULE_COUNT} code`, () => {
    for (let r = 0; r < MODULE_COUNT; r++) {
      for (let c = 0; c < MODULE_COUNT; c++) isCovered(r, c);
    }
  });
});
