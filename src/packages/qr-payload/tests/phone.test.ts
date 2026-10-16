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
import { PhoneContract, constructPhoneString, hydratePhoneData, validatePayload } from '../index';
import { QRType } from '@/types';

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

  describe('Phone input validation rules', () => {
    it('accepts valid phone numbers, extensions, USSD codes, and pauses', () => {
      expect(PhoneContract.validate?.('tel:+1234567890')).toEqual([]);
      expect(PhoneContract.validate?.('tel:+1234567890;ext=89')).toEqual([]);
      expect(PhoneContract.validate?.('tel:*%2306%23')).toEqual([]); // decoded as *#06#
      expect(PhoneContract.validate?.('tel:123,456')).toEqual([]);
      expect(PhoneContract.validate?.('tel:+1%20555%20123%204567')).toEqual([]);
    });

    it('rejects numbers containing letters in the main number part', () => {
      const invalidUri = 'tel:+1555abc1234';
      const violations = PhoneContract.validate?.(invalidUri);
      expect(violations).toContain('PHONE_STRUCTURE_VIOLATION');
      expect(validatePayload(invalidUri, QRType.PHONE)).toContain('PHONE_STRUCTURE_VIOLATION');
    });

    it('rejects numbers containing invalid or non-dialable symbols', () => {
      const invalidUri = 'tel:+15551234567<script>alert(1)</script>';
      const violations = PhoneContract.validate?.(invalidUri);
      expect(violations).toContain('PHONE_STRUCTURE_VIOLATION');
    });

    it('rejects numbers containing line breaks', () => {
      const invalidUri = 'tel:+15551234567\n+15559876543';
      const violations = PhoneContract.validate?.(invalidUri);
      expect(violations).toContain('PHONE_STRUCTURE_VIOLATION');
    });
  });
});
