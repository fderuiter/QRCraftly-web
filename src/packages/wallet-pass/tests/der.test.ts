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
import { childAt, readChildren, readDerAll, sequence, integer, TAG } from '../index';

describe('der: child node memoization cache', () => {
  it('memoizes parsed child nodes per DerNode instance', () => {
    const derData = sequence(integer(1), integer(2), integer(3));
    const node = readDerAll(derData);

    const children1 = readChildren(node);
    const children2 = readChildren(node);

    expect(children1).toBe(children2);
    expect(children1).toHaveLength(3);
    expect(children1[0].tag).toBe(TAG.INTEGER);
    expect(children1[1].tag).toBe(TAG.INTEGER);
    expect(children1[2].tag).toBe(TAG.INTEGER);
  });

  it('reuses memoized array during childAt calls', () => {
    const derData = sequence(integer(100), integer(200));
    const node = readDerAll(derData);

    const child0 = childAt(node, 0, TAG.INTEGER);
    const child1 = childAt(node, 1, TAG.INTEGER);

    const cachedChildren = readChildren(node);
    expect(child0).toBe(cachedChildren[0]);
    expect(child1).toBe(cachedChildren[1]);
  });
});
