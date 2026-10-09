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
import { SmsContract, constructSmsString, hydrateSmsData, constructPhoneString } from '../index';

describe('Sms generator', () => {
  it('constructs and hydrates successfully', () => {
    const data = {
      number: '+1234567890',
      message: 'Hello, this is a test!',
    };
    const str = constructSmsString(data);
    const hydrated = hydrateSmsData(str);
    expect(hydrated).toEqual(data);
  });

  it('constructs and hydrates without message', () => {
    const data = {
      number: '+1234567890',
      message: '',
    };
    const str = constructSmsString(data);
    const hydrated = hydrateSmsData(str);
    expect(hydrated).toEqual(data);
  });

  it('hydrates older smsto format with body', () => {
    const hydrated = hydrateSmsData('smsto:+1234567890:Hello');
    expect(hydrated).toEqual({ number: '+1234567890', message: 'Hello' });
  });

  it('hydrates older smsto format without body', () => {
    const hydrated = hydrateSmsData('smsto:+1234567890');
    expect(hydrated).toEqual({ number: '+1234567890', message: '' });
  });

  it('returns default for unknown', () => {
    expect(hydrateSmsData('random')).toEqual({ number: '', message: '' });
  });

  describe('Isolated SMS Multi-Recipient Support (Requirement 1 & 3)', () => {
    it('accepts semicolon-separated numbers and preserves semicolons', () => {
      const data = {
        number: '+15550000000;+15551111111;+15552222222',
        message: 'Alert Broadcast',
      };
      const str = constructSmsString(data);
      expect(str).toBe('sms:+15550000000;+15551111111;+15552222222?body=Alert%20Broadcast');
      const hydrated = hydrateSmsData(str);
      expect(hydrated).toEqual(data);
    });

    it('accepts comma-separated numbers and preserves commas', () => {
      const data = {
        number: '+15550000000,+15551111111',
        message: 'Routing test',
      };
      const str = constructSmsString(data);
      expect(str).toBe('sms:+15550000000,+15551111111?body=Routing%20test');
      const hydrated = hydrateSmsData(str);
      expect(hydrated).toEqual(data);
    });
  });

  describe('Global validation logic comparison (Requirement 2)', () => {
    it('standard telephone generator strips semicolons and commas by default', () => {
      const phoneData = {
        number: '+15550000000;+15551111111,123',
      };
      const str = constructPhoneString(phoneData);
      // Semicolons are stripped; a comma is a dial pause, so it is kept (#1277)
      expect(str).toBe('tel:+15550000000+15551111111,123');
    });
  });

  describe('SMS Phone Number Input Validation Rules', () => {
    it('accepts numbers with whitelisted symbols, semicolons, and commas', () => {
      const validUri = 'sms:+1(555)-123-4567;+1.555.987.6543,123#*?body=hello';
      const violations = SmsContract.validate?.(validUri);
      expect(violations).toEqual([]);
    });

    it('rejects numbers containing letters', () => {
      const invalidUri = 'sms:+15550000000;+1555abc1111?body=hello';
      const violations = SmsContract.validate?.(invalidUri);
      expect(violations).toContain('SMS_PHONE_STRUCTURE_VIOLATION');
    });

    it('rejects numbers containing non-whitelisted symbols', () => {
      const invalidUri = 'sms:+15550000000%+15551111111?body=hello';
      const violations = SmsContract.validate?.(invalidUri);
      expect(violations).toContain('SMS_PHONE_STRUCTURE_VIOLATION');
    });

    it('rejects numbers containing line-break control characters', () => {
      const invalidUri = 'sms:+15550000000;\n+15551111111?body=hello';
      const violations = SmsContract.validate?.(invalidUri);
      expect(violations).toContain('SMS_PHONE_STRUCTURE_VIOLATION');
    });
  });
});
