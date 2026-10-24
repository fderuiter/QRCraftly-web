/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { describe, it, expect } from 'vitest';
import { PreallocatedFramePool, shuffleInPlace } from '@/packages/optical-transfer/protocol';

describe('PreallocatedFramePool', () => {
  it('pre-allocates contiguous memory and stores/retrieves frames accurately', () => {
    const pool = new PreallocatedFramePool(10, 29 * 29);
    const mockData1 = new Uint8Array(29 * 29).fill(1);
    const mockData2 = new Uint8Array(29 * 29).fill(2);

    pool.storeFrame(0, 29, mockData1);
    pool.storeFrame(1, 29, mockData2);

    expect(pool.hasFrame(0)).toBe(true);
    expect(pool.hasFrame(1)).toBe(true);
    expect(pool.hasFrame(2)).toBe(false);
    expect(pool.size).toBe(2);

    const frame0 = pool.getFrame(0);
    expect(frame0?.index).toBe(0);
    expect(frame0?.size).toBe(29);
    expect(frame0?.data[0]).toBe(1);

    const frame1 = pool.getFrame(1);
    expect(frame1?.index).toBe(1);
    expect(frame1?.size).toBe(29);
    expect(frame1?.data[0]).toBe(2);
  });

  it('expands memory pool capacity dynamically without losing existing frames', () => {
    const pool = new PreallocatedFramePool(2, 10 * 10);
    const data0 = new Uint8Array(10 * 10).fill(10);
    const data1 = new Uint8Array(10 * 10).fill(20);
    const data2 = new Uint8Array(10 * 10).fill(30);

    pool.storeFrame(0, 10, data0);
    pool.storeFrame(1, 10, data1);
    // Exceed initial capacity of 2
    pool.storeFrame(2, 10, data2);

    expect(pool.size).toBe(3);
    expect(pool.getFrame(0)?.data[0]).toBe(10);
    expect(pool.getFrame(1)?.data[0]).toBe(20);
    expect(pool.getFrame(2)?.data[0]).toBe(30);
  });

  it('clears frame mappings while leaving memory pool structure available for reuse', () => {
    const pool = new PreallocatedFramePool(5, 10 * 10);
    pool.storeFrame(0, 10, new Uint8Array(100).fill(5));
    expect(pool.size).toBe(1);

    pool.clear();
    expect(pool.size).toBe(0);
    expect(pool.hasFrame(0)).toBe(false);
  });

  it('deletes and releases frames accurately', () => {
    const pool = new PreallocatedFramePool(5, 10 * 10);
    pool.storeFrame(0, 10, new Uint8Array(100).fill(5));
    pool.storeFrame(1, 10, new Uint8Array(100).fill(6));
    expect(pool.size).toBe(2);

    expect(pool.delete(0)).toBe(true);
    expect(pool.hasFrame(0)).toBe(false);
    expect(pool.size).toBe(1);

    expect(pool.releaseFrame(1)).toBe(true);
    expect(pool.hasFrame(1)).toBe(false);
    expect(pool.size).toBe(0);
  });
});

describe('shuffleInPlace', () => {
  it('shuffles array elements in place maintaining all elements', () => {
    const original = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const array = [...original];
    shuffleInPlace(array);

    expect(array.length).toBe(original.length);
    expect(array.sort((a, b) => a - b)).toEqual(original);
  });
});
