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
import { crc32, crc32c, crc32Hex } from '../checksum';
import { createZip } from '../zip';

const CHECK = new TextEncoder().encode('123456789');

describe('checksum (#1599)', () => {
  it('matches the standard check values', () => {
    expect(crc32(CHECK)).toBe(0xcbf43926);
    expect(crc32c(CHECK)).toBe(0xe3069283);
    expect(crc32Hex(CHECK)).toBe('cbf43926');
  });
});

describe('zip (#1599)', () => {
  it('stores the CRC-32 of each entry', () => {
    const zip = createZip([{ name: 'check.txt', data: CHECK }], { date: new Date(2026, 0, 1) });
    expect(new DataView(zip.buffer).getUint32(14, true)).toBe(0xcbf43926);
  });
});
