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
import { concatBytes } from '../encoding';

describe('concatBytes', () => {
  it('handles empty input array', () => {
    const result = concatBytes([]);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  it('handles a single chunk', () => {
    const chunk = new Uint8Array([1, 2, 3, 4, 5]);
    const result = concatBytes([chunk]);
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(result).not.toBe(chunk);
  });

  it('concatenates multiple chunks in order', () => {
    const chunk1 = new Uint8Array([10, 20]);
    const chunk2 = new Uint8Array([30, 40, 50]);
    const chunk3 = new Uint8Array([60]);

    const result = concatBytes([chunk1, chunk2, chunk3]);
    expect(result).toEqual(new Uint8Array([10, 20, 30, 40, 50, 60]));
  });

  it('handles zero-length chunks correctly', () => {
    const empty1 = new Uint8Array(0);
    const chunk1 = new Uint8Array([1, 2]);
    const empty2 = new Uint8Array(0);
    const chunk2 = new Uint8Array([3]);
    const empty3 = new Uint8Array(0);

    const result = concatBytes([empty1, chunk1, empty2, chunk2, empty3]);
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('creates a new array that does not alias input buffers', () => {
    const chunk1 = new Uint8Array([100, 101]);
    const chunk2 = new Uint8Array([102, 103]);

    const result = concatBytes([chunk1, chunk2]);

    // Mutate output
    result[0] = 255;
    result[2] = 255;

    // Verify original arrays are unaffected
    expect(chunk1[0]).toBe(100);
    expect(chunk1[1]).toBe(101);
    expect(chunk2[0]).toBe(102);
    expect(chunk2[1]).toBe(103);
  });
});
