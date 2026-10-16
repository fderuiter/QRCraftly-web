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

import { describe, it, expect } from 'vitest';
import { constructPhoneString, hydratePhoneData } from '../index';

describe('Phone generator', () => {
  it('constructs and hydrates successfully', () => {
    const data = {
      number: '+1234567890',
    };
    const str = constructPhoneString(data);
    const hydrated = hydratePhoneData(str);
    expect(hydrated).toEqual(data);
  });

  it('hydrates empty object when given non-tel string', () => {
    const hydrated = hydratePhoneData('mailto:test@test.com');
    expect(hydrated).toEqual({ number: '' });
  });

  it('hydrates empty object when given invalid string', () => {
    const hydrated = hydratePhoneData('invalid-string');
    expect(hydrated).toEqual({ number: '' });
  });
});
