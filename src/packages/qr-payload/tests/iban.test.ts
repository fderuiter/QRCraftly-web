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
import { isValidIban } from '../index';

describe('IBAN mod-97 validation utility (isValidIban)', () => {
  it('validates correct IBANs across different countries', () => {
    // Germany (DE, 22 chars)
    expect(isValidIban('DE89370400440532013000')).toBe(true);
    // France (FR, 27 chars)
    expect(isValidIban('FR7630006000011234567890189')).toBe(true);
    // Netherlands (NL, 18 chars)
    expect(isValidIban('NL91ABNA0417164300')).toBe(true);
    // United Kingdom (GB, 22 chars)
    expect(isValidIban('GB29NWBK60161331926819')).toBe(true);
    // Belgium (BE, 16 chars)
    expect(isValidIban('BE68539007547034')).toBe(true);
  });

  it('handles IBANs formatted with spaces or lowercase letters', () => {
    expect(isValidIban('de89 3704 0044 0532 0130 00')).toBe(true);
    expect(isValidIban(' NL91 ABNA 0417 1643 00 ')).toBe(true);
    expect(isValidIban('fr76 3000 6000 0112 3456 7890 189')).toBe(true);
  });

  it('rejects IBANs with invalid checksums', () => {
    // Changed DE89 to DE88
    expect(isValidIban('DE88370400440532013000')).toBe(false);
    // Changed NL91 to NL90
    expect(isValidIban('NL90ABNA0417164300')).toBe(false);
  });

  it('rejects malformed or invalid IBAN formats', () => {
    // Too short (< 15 characters)
    expect(isValidIban('DE8937040044')).toBe(false);

    // Too long (> 34 characters)
    expect(isValidIban('DE89370400440532013000123456789012345')).toBe(false);

    // Invalid country code prefix (non-letters)
    expect(isValidIban('1289370400440532013000')).toBe(false);

    // Contains invalid non-alphanumeric characters
    expect(isValidIban('DE893704004405320130!0')).toBe(false);
    expect(isValidIban('DE89-3704-0044-0532-0130-00')).toBe(false);

    // Empty strings
    expect(isValidIban('')).toBe(false);
    expect(isValidIban('   ')).toBe(false);

    // Non-string input safety
    // @ts-expect-error testing runtime robustness
    expect(isValidIban(null)).toBe(false);
    // @ts-expect-error testing runtime robustness
    expect(isValidIban(undefined)).toBe(false);
  });
});
