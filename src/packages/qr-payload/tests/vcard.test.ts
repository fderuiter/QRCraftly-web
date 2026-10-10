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
import { constructVCardString, hydrateVCardData, VCardContract } from '../index';
import { QRType } from '@/types';

describe('VCard generator', () => {
  it('constructs and hydrates successfully', () => {
    const data = {
      version: '3.0' as const,
      firstName: 'John',
      lastName: 'Doe',
      organization: 'Acme Corp',
      title: 'CEO',
      phone: '123456789',
      email: 'john@example.com',
      website: 'https://example.com',
      street: '123 Main St',
      city: 'Anytown',
      zip: '12345',
      country: 'USA',
    };
    const str = constructVCardString(data);
    const hydrated = hydrateVCardData(str);
    // website gets a trailing slash due to normalization
    expect(hydrated).toEqual({ ...data, website: 'https://example.com/' });
  });

  it('handles empty values or non-vcard strings', () => {
    expect(hydrateVCardData('random')).toEqual({
      version: '3.0',
      firstName: '',
      lastName: '',
      organization: '',
      title: '',
      phone: '',
      email: '',
      website: '',
      street: '',
      city: '',
      zip: '',
      country: '',
    });
  });

  it('handles invalid lines', () => {
    const raw = `BEGIN:VCARD\nINVALID\nEND:VCARD`;
    expect(hydrateVCardData(raw).firstName).toBe('');
  });

  it('handles empty parts in N and ADR', () => {
    const raw = `BEGIN:VCARD\nN:;\nADR:;;\nEND:VCARD`;
    const hydrated = hydrateVCardData(raw);
    expect(hydrated.lastName).toBe('');
    expect(hydrated.firstName).toBe('');
    expect(hydrated.street).toBe('');
    expect(hydrated.city).toBe('');
    expect(hydrated.zip).toBe('');
    expect(hydrated.country).toBe('');
  });

  it('handles undefined fields during escaping', () => {
    const data = {
      firstName: undefined as unknown as string,
      lastName: undefined as unknown as string,
      organization: '',
      title: '',
      phone: '',
      email: '',
      website: '',
      street: '',
      city: '',
      zip: '',
      country: '',
    };
    // An empty card builds no code, so the generator shows its sample (#1272).
    expect(constructVCardString(data)).toBe('');
    expect(constructVCardString({ ...data, phone: '+1 555 0100' })).toContain('N:;;;;');
  });

  it('normalizes newlines, preserves tabs, and preserves control characters', () => {
    const data = {
      firstName: 'Clean\x00Text\x07With\x1BControl\x7FChars',
      lastName: 'Line 1\r\nLine 2',
      organization: 'Line 1\rLine 2',
      title: 'Win\r\nMac\rUnix\n',
      phone: 'Line\t1\nLine\t2',
      email: '',
      website: '',
      street: '',
      city: '',
      zip: '',
      country: '',
    };
    const str = constructVCardString(data);
    expect(str).toContain('Clean\x00Text\x07With\x1BControl\x7FChars');
    expect(str).toContain('Line 1\\nLine 2');
    expect(str).toContain('Win\\nMac\\nUnix\\n');
    expect(str).toContain('Line\t1\\nLine\t2');
  });

  it('bypasses backslash escaping for semicolons and commas inside URL parameters', () => {
    const data = {
      firstName: 'Jane',
      lastName: 'Smith',
      organization: 'Tech Corp',
      title: 'Engineer',
      phone: '123456789',
      email: 'jane@example.com',
      website: 'https://example.com/search?category=dev,qa&filter=active;enabled',
      street: '123 Main St',
      city: 'Anytown',
      zip: '12345',
      country: 'USA',
    };
    const str = constructVCardString(data);
    expect(str).toContain('URL:https://example.com/search?category=dev,qa&filter=active;enabled');
    expect(str).not.toContain(
      'URL:https://example.com/search?category=dev\\,qa&filter=active\\;enabled'
    );

    const hydrated = hydrateVCardData(str);
    expect(hydrated.website).toBe(
      'https://example.com/search?category=dev,qa&filter=active;enabled'
    );
  });

  it('uses CRLF line breaks exclusively for vCard output lines', () => {
    const data = {
      firstName: 'John',
      lastName: 'Doe',
      organization: 'Acme Corp',
      title: 'CEO',
      phone: '123',
      email: 'john@example.com',
      website: 'https://example.com',
      street: '123 Main St',
      city: 'Anytown',
      zip: '12345',
      country: 'USA',
    };
    const str = constructVCardString(data);
    expect(str).toContain('\r\n');
    const lines = str.split(/\r?\n/);
    expect(lines.length).toBeGreaterThan(1);
  });

  it('preserves multi-byte characters and emojis across vCard folding and hydration', () => {
    const data = {
      firstName: '日本語👨‍👩‍👧‍👦',
      lastName: 'テスト🔥',
      organization: 'グローバル企業 🌐',
      title: 'リードエンジニア 🚀',
      phone: '123456789',
      email: 'user@example.com',
      website: 'https://example.com',
      street:
        '東京都千代田区1-1-1 住所が非常に長くてラインフォールディングのテストを実行します 🏢',
      city: 'Tokyo',
      zip: '100-0001',
      country: 'Japan',
    };
    const str = constructVCardString(data);
    const hydrated = hydrateVCardData(str);
    expect(hydrated.firstName).toBe('日本語👨‍👩‍👧‍👦');
    expect(hydrated.lastName).toBe('テスト🔥');
    expect(hydrated.organization).toBe('グローバル企業 🌐');
    expect(hydrated.title).toBe('リードエンジニア 🚀');
    expect(hydrated.street).toBe(
      '東京都千代田区1-1-1 住所が非常に長くてラインフォールディングのテストを実行します 🏢'
    );
  });

  it('implements VCardContract correctly and validates dangerous URLs', () => {
    expect(VCardContract.type).toBe(QRType.VCARD);
    expect(VCardContract.matches('BEGIN:VCARD')).toBe(true);
    expect(VCardContract.matches('OTHER')).toBe(false);

    // No URL, should be empty violations
    expect(VCardContract.validate?.('BEGIN:VCARD\nEND:VCARD')).toEqual([]);

    // Safe URL, should be empty violations
    expect(VCardContract.validate?.('BEGIN:VCARD\nURL:https://example.com\nEND:VCARD')).toEqual([]);

    // Dangerous URL, should have URI_INJECTION_VIOLATION
    expect(VCardContract.validate?.('BEGIN:VCARD\nURL:javascript:alert(1)\nEND:VCARD')).toEqual([
      'URI_INJECTION_VIOLATION',
    ]);

    // Dangerous URL with parameters, should have URI_INJECTION_VIOLATION
    expect(
      VCardContract.validate?.('BEGIN:VCARD\nURL;TYPE=WORK:javascript:alert(1)\nEND:VCARD')
    ).toEqual(['URI_INJECTION_VIOLATION']);

    // Safe URL with parameters, should have no violations
    expect(
      VCardContract.validate?.('BEGIN:VCARD\nURL;TYPE=WORK:https://example.com\nEND:VCARD')
    ).toEqual([]);

    // URL with parameter but no colon, should have no violations
    expect(VCardContract.validate?.('BEGIN:VCARD\nURL;TYPE=WORK\nEND:VCARD')).toEqual([]);

    // MECard contract matching and URL validation
    expect(VCardContract.matches('MECARD:N:Doe,John;')).toBe(true);
    expect(VCardContract.validate?.('MECARD:N:Doe,John;URL:javascript:alert(1);')).toEqual([
      'URI_INJECTION_VIOLATION',
    ]);
    expect(VCardContract.validate?.('MECARD:N:Doe,John;URL:https://example.com;')).toEqual([]);
  });

  it('supports vCard 2.1, 3.0, and 4.0 versions', () => {
    const baseData = {
      firstName: 'Jane',
      lastName: 'Smith',
      organization: 'Tech Corp',
      title: 'Architect',
      phone: '+15551234567',
      email: 'jane@tech.example',
      website: 'https://tech.example',
      street: '456 Tech Blvd',
      city: 'Innovate',
      zip: '90210',
      country: 'USA',
    };

    // vCard 2.1
    const v21Str = constructVCardString({ ...baseData, version: '2.1' });
    expect(v21Str).toContain('VERSION:2.1');
    const hydrated21 = hydrateVCardData(v21Str);
    expect(hydrated21.version).toBe('2.1');
    expect(hydrated21.firstName).toBe('Jane');
    expect(hydrated21.lastName).toBe('Smith');

    // vCard 3.0
    const v30Str = constructVCardString({ ...baseData, version: '3.0' });
    expect(v30Str).toContain('VERSION:3.0');
    const hydrated30 = hydrateVCardData(v30Str);
    expect(hydrated30.version).toBe('3.0');

    // vCard 4.0
    const v40Str = constructVCardString({ ...baseData, version: '4.0' });
    expect(v40Str).toContain('VERSION:4.0');
    const hydrated40 = hydrateVCardData(v40Str);
    expect(hydrated40.version).toBe('4.0');
  });

  it('supports MECard format construction, hydration, and special character escaping', () => {
    const mecardData = {
      version: 'mecard' as const,
      firstName: 'John, Jr.',
      lastName: 'Doe; III',
      organization: 'Acme: Corp',
      title: 'VP, Engineering',
      phone: '+15559876543',
      email: 'johndoe@example.com',
      website: 'https://example.com/contact?id=123',
      street: '789 Main St, Suite 100',
      city: 'Metropolis',
      zip: '10001',
      country: 'USA',
    };

    const mecardStr = constructVCardString(mecardData);
    expect(mecardStr.startsWith('MECARD:')).toBe(true);
    expect(mecardStr).toContain('N:Doe\\; III,John\\, Jr.;');
    expect(mecardStr).toContain('ORG:Acme\\: Corp;');
    expect(mecardStr).toContain('TIL:VP\\, Engineering;');

    const hydrated = hydrateVCardData(mecardStr);
    expect(hydrated.version).toBe('mecard');
    expect(hydrated.firstName).toBe('John, Jr.');
    expect(hydrated.lastName).toBe('Doe; III');
    expect(hydrated.organization).toBe('Acme: Corp');
    expect(hydrated.title).toBe('VP, Engineering');
    expect(hydrated.phone).toBe('+15559876543');
    expect(hydrated.email).toBe('johndoe@example.com');
    expect(hydrated.website).toBe('https://example.com/contact?id=123');
    expect(hydrated.street).toBe('789 Main St, Suite 100');
    expect(hydrated.city).toBe('Metropolis');
    expect(hydrated.zip).toBe('10001');
    expect(hydrated.country).toBe('USA');
  });

  it('omits empty or whitespace-only optional property lines in vCard format', () => {
    const partialData = {
      version: '3.0' as const,
      firstName: 'Alice',
      lastName: 'Smith',
      organization: '   ',
      title: '',
      phone: '   ',
      email: '',
      website: '',
      street: '   ',
      city: '',
      zip: '',
      country: '   ',
    };

    const str = constructVCardString(partialData);

    expect(str).toContain('BEGIN:VCARD');
    expect(str).toContain('VERSION:3.0');
    expect(str).toContain('N:Smith;Alice;;;');
    expect(str).toContain('FN:Alice Smith');
    expect(str).toContain('END:VCARD');

    expect(str).not.toContain('ORG:');
    expect(str).not.toContain('TITLE:');
    expect(str).not.toContain('TEL:');
    expect(str).not.toContain('EMAIL:');
    expect(str).not.toContain('URL:');
    expect(str).not.toContain('ADR:');

    const hydrated = hydrateVCardData(str);
    expect(hydrated.firstName).toBe('Alice');
    expect(hydrated.lastName).toBe('Smith');
    expect(hydrated.organization).toBe('');
    expect(hydrated.phone).toBe('');
  });

  it('emits ADR line in vCard format when at least one address component is populated', () => {
    const partialAddressData = {
      version: '3.0' as const,
      firstName: 'Bob',
      lastName: 'Jones',
      organization: '',
      title: '',
      phone: '',
      email: '',
      website: '',
      street: '',
      city: 'Metropolis',
      zip: '',
      country: '',
    };

    const str = constructVCardString(partialAddressData);
    expect(str).toContain('ADR:;;;Metropolis;;;');

    const hydrated = hydrateVCardData(str);
    expect(hydrated.city).toBe('Metropolis');
    expect(hydrated.street).toBe('');
  });

  it('omits empty optional property lines in MECard format while preserving structural tags', () => {
    const partialMecard = {
      version: 'mecard' as const,
      firstName: 'Charlie',
      lastName: 'Brown',
      organization: '  ',
      title: '',
      phone: '+15550001111',
      email: '  ',
      website: '',
      street: '',
      city: '',
      zip: '',
      country: '',
    };

    const str = constructVCardString(partialMecard);

    expect(str.startsWith('MECARD:')).toBe(true);
    expect(str.endsWith(';')).toBe(true);
    expect(str).toContain('N:Brown,Charlie;');
    expect(str).toContain('TEL:+15550001111;');

    expect(str).not.toContain('ORG:');
    expect(str).not.toContain('TIL:');
    expect(str).not.toContain('EMAIL:');
    expect(str).not.toContain('URL:');
    expect(str).not.toContain('ADR:');

    const hydrated = hydrateVCardData(str);
    expect(hydrated.version).toBe('mecard');
    expect(hydrated.firstName).toBe('Charlie');
    expect(hydrated.lastName).toBe('Brown');
    expect(hydrated.phone).toBe('+15550001111');
    expect(hydrated.organization).toBe('');
  });

  describe('MECARD address (#1367)', () => {
    const card = {
      version: 'mecard' as const,
      firstName: 'Ann',
      lastName: 'Lee',
      organization: '',
      title: '',
      phone: '',
      email: '',
      website: '',
      street: '1 Main St, Apt 2',
      city: 'Springfield',
      zip: '',
      country: 'US',
    };

    it('writes one readable line without stray commas for empty fields', () => {
      const mecard = constructVCardString(card);
      expect(mecard).toContain('ADR:1 Main St\\, Apt 2, Springfield, US;');
      expect(mecard).not.toMatch(/ADR:,|,,/);
    });

    it('reads the one-line form back into its fields', () => {
      const hydrated = hydrateVCardData(constructVCardString({ ...card, zip: '12345' }));
      expect(hydrated).toMatchObject({ street: '1 Main St, Apt 2', city: 'Springfield', zip: '12345', country: 'US' });
    });

    it('still reads the positional DoCoMo form', () => {
      const hydrated = hydrateVCardData('MECARD:N:Lee,Ann;ADR:,,1 Main,Springfield,IL,62701,US;;');
      expect(hydrated).toMatchObject({ street: '1 Main', city: 'Springfield', zip: '62701', country: 'US' });
    });
  });
});
