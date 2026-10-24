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
 * False acquisitions (#1161, ADR 0047): the whole-image search and the strict search after it must
 * find no frame in a picture that holds none a receiver may read. The pictures are
 * `acquisitionSet.ts`'s negatives: blank, gradient, noise and blocky pictures, real fiducials among
 * random cells, and captured frames with their header scrambled, their fiducials painted over or
 * a grid size the receiver was not told about. `pnpm run bench:optical-finder` runs more of them,
 * at 1080p as well.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { acquireFrame, loadOpticalModem } from '../index';
import { HELD_OUT_SEED, SET_GEOMETRIES, negativeCases } from './acquisitionSet';

/** At least 200, and a whole number of rounds of the nine kinds. */
const NEGATIVES = 216;

beforeAll(() => loadOpticalModem());

describe('fiducial search negatives', () => {
  it(`acquires nothing in ${NEGATIVES} pictures with no readable frame`, () => {
    const acquired: string[] = [];
    let count = 0;
    for (const { kind, image } of negativeCases(NEGATIVES, HELD_OUT_SEED + 2)) {
      count++;
      const result = acquireFrame(image, SET_GEOMETRIES);
      if (result.ok) acquired.push(`${count - 1} (${kind})`);
    }
    expect(count).toBe(NEGATIVES);
    expect(acquired).toEqual([]);
  }, 240_000); // about 50 s under coverage on a laptop, twice that on CI's 2-vCPU runners
});
