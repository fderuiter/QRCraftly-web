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
 * Held-out acquisition (#1161, ADR 0047): frames seen at a strong angle, 15% to 25% keystone at
 * 2.5 to 3 camera pixels per cell, drawn from seeds the strict search was not tuned on. A slice of
 * `acquisitionSet.ts`'s held-out set small enough to run in every test run: Ultra's 4K-class
 * captures take seconds each to simulate, so its frames, and the full set, are left to
 * `pnpm run bench:optical-finder`, whose results ADR 0047 records.
 *
 * Every frame acquired must be the frame sent, with its four fiducials within a cell of where they
 * are. A frame the whole-image search reads on its own must be read the same way with the strict
 * search after it. The floors are this slice's results [simulated]; a change that lowers one has
 * made the search worse.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { acquireFrame, loadOpticalModem, type ModemProfile } from '../index';
import { HELD_OUT_SEED, MONOCHROME_LARGE, SET_GEOMETRIES, SET_SESSION, SHIPPED_FOUR_COLOUR, captureCase, caseSeq, foundAll, profileCases } from './acquisitionSet';

const [STEADY, WIDE] = SHIPPED_FOUR_COLOUR;
const [WIDE_MONO] = MONOCHROME_LARGE;

interface Slice {
  name: string;
  profile: ModemProfile;
  count: number;
  /** Fewest that must be acquired. */
  floor: number;
  /** Fewest the whole-image search must acquire on its own. */
  wholeFloor: number;
}

const SLICES: readonly Slice[] = [
  { name: STEADY.name, profile: STEADY, count: 16, floor: 11, wholeFloor: 2 },
  { name: WIDE.name, profile: WIDE, count: 3, floor: 2, wholeFloor: 0 },
  { name: WIDE_MONO.name, profile: WIDE_MONO, count: 3, floor: 1, wholeFloor: 0 },
];

beforeAll(() => loadOpticalModem());

describe('held-out acquisition at a strong angle', () => {
  it.each(SLICES)('acquires $name frames', ({ profile, count, floor, wholeFloor }) => {
    let acquired = 0;
    let whole = 0;
    const wrong: number[] = [];
    const misplaced: number[] = [];
    const changed: number[] = [];
    for (const c of profileCases(profile, count, HELD_OUT_SEED)) {
      const { image, fiducials } = captureCase(c);
      const alone = acquireFrame(image, SET_GEOMETRIES, { strict: false });
      const result = acquireFrame(image, SET_GEOMETRIES);
      if (alone.ok) {
        whole++;
        if (!result.ok || JSON.stringify(result.fiducials) !== JSON.stringify(alone.fiducials)) changed.push(caseSeq(c));
      }
      if (!result.ok) continue;
      acquired++;
      const { header } = result.frame;
      if (header.seq !== caseSeq(c) || header.session !== SET_SESSION || result.frame.cols !== profile.cols) wrong.push(caseSeq(c));
      if (!foundAll(result.fiducials.points, fiducials, c.pixelsPerCell)) misplaced.push(caseSeq(c));
    }
    expect({ wrong, misplaced, changed }).toEqual({ wrong: [], misplaced: [], changed: [] });
    expect(acquired).toBeGreaterThanOrEqual(floor);
    expect(whole).toBeGreaterThanOrEqual(wholeFloor);
  }, 120_000);
});
