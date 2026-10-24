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

import { describe, expect, expectTypeOf, it } from 'vitest';
import { ECC_LEVELS, type EccLevel } from '../ecc';

describe('ECC_LEVELS', () => {
  it('lists the four levels weakest first', () => {
    expect(ECC_LEVELS).toEqual(['L', 'M', 'Q', 'H']);
    expectTypeOf<EccLevel>().toEqualTypeOf<'L' | 'M' | 'Q' | 'H'>();
  });
});
