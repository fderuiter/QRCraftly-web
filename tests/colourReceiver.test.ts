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

import { beforeAll, describe, expect, it } from 'vitest';
import { loadCrossTalkKernels } from '../src/packages/optical-transfer/index';
import { CLEAN_CHANNEL, COLOUR_BLIND_CHANNEL, runColourTransfer } from './utils/colourBench';

// The full-size colour runs live in colourTransfer.slow.test.ts (#1608). These small runs keep the
// colour receiver covered on every PR: a short file, a small screen and a frame cap.
const SMALL_SCREEN = { width: 800, height: 800, modulePx: 3 };
const SMALL_RUN = { bytes: 2_000, screen: SMALL_SCREEN, maxFrames: 200 } as const;

beforeAll(() => loadCrossTalkKernels());

describe('colour receiver on a short transfer (#1147)', () => {
  it('fits the colour model from a beacon and finishes in colour', async () => {
    const result = await runColourTransfer({ mode: 'colour', channel: CLEAN_CHANNEL, ...SMALL_RUN });
    expect(result.verified).toBe(true);
    expect(result.state).toBe('colour');
    expect(result.fits).toBeGreaterThanOrEqual(1);
    expect(result.colourReads).toBeGreaterThan(0);
  });

  it('follows tracked tiles and falls back to a search only on a miss', async () => {
    const result = await runColourTransfer({ mode: 'colour', channel: CLEAN_CHANNEL, ...SMALL_RUN, readPath: 'tracked' });
    expect(result.verified).toBe(true);
    expect(result.trackedFallbacks).toBeLessThan(result.tileDecodes);
  });

  it('falls back to mono when the camera sees no colour', async () => {
    const result = await runColourTransfer({ mode: 'colour', channel: COLOUR_BLIND_CHANNEL, ...SMALL_RUN, maxFrames: 400 });
    expect(result.complete).toBe(true);
    expect(result.state).toBe('mono');
  });
});
