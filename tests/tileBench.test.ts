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
import { TILE_LAYOUTS, modulePxFor } from '../src/packages/optical-transfer/index';
import { runTearScenario, runTileTransfer } from './utils/tileBench';

const FRAME = { width: 1920, height: 1080 };
const screenFor = (id: keyof typeof TILE_LAYOUTS) => ({ frame: FRAME, modulePx: modulePxFor(TILE_LAYOUTS[id], FRAME) });

describe('multi-code transfer simulation (#1142)', () => {
  it('moves a file through tiled frames with one search, tracked crops and dedup', async () => {
    const result = await runTileTransfer({ layoutId: '2x2-v25', screen: screenFor('2x2-v25'), bytes: 30_000, hold: 2, staggered: true });
    expect(result.complete).toBe(true);
    expect(result.searches).toBe(1);
    // Four tiles per camera frame, and a tile held for two refreshes is read again by the camera.
    expect(result.decodes).toBeGreaterThan(result.cameraFrames * 3);
    expect(result.goodputKBps).toBeGreaterThan(20);
  }, 120_000);

  it('keeps at least half the tiles of a torn frame when staggered, and fewer when every tile changes together', async () => {
    const staggered = await runTearScenario('2x2-v25', screenFor('2x2-v25'), 2, true, 3);
    const together = await runTearScenario('2x2-v25', screenFor('2x2-v25'), 2, false, 3);
    expect(staggered.worst).toBeGreaterThanOrEqual(0.5);
    expect(staggered.mean).toBeGreaterThan(together.mean);
    expect(together.worst).toBeLessThanOrEqual(0.5);
  }, 120_000);

  it('still finishes when every frame is torn', async () => {
    const result = await runTileTransfer({ layoutId: '2x2-v25', screen: screenFor('2x2-v25'), bytes: 20_000, hold: 2, staggered: true, tear: true });
    expect(result.complete).toBe(true);
  }, 120_000);
});
