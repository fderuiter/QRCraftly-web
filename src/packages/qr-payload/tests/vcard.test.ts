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
import { constructVCardString, hydrateVCardData, VCardContract, unfoldString } from '../index';
import { QRType } from '@/types';

describe('VCard generator', () => {
  it('constructs and hydrates successfully', () => {
    const data = {
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
      photo: '',
    };
    const str = constructVCardString(data);
    const hydrated = hydrateVCardData(str);
    // website gets a trailing slash due to normalization
    expect(hydrated).toEqual({ ...data, website: 'https://example.com/' });
  });

  it('handles empty values or non-vcard strings', () => {
    expect(hydrateVCardData('random')).toEqual({
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
      photo: '',
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
    const str = constructVCardString(data);
    expect(str).toContain('N:;;;;');
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
  });

  describe('PHOTO serialization and hydration', () => {
    it('serializes and hydrates JPEG base64 photos correctly', () => {
      const sampleBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const data = {
        firstName: 'Alice',
        lastName: 'Smith',
        organization: 'Tech Corp',
        title: 'Developer',
        phone: '555-0100',
        email: 'alice@example.com',
        website: 'https://example.com',
        street: '456 Tech Way',
        city: 'Silicon Valley',
        zip: '94000',
        country: 'USA',
        photo: `data:image/jpeg;base64,${sampleBase64}`,
      };

      const vcardStr = constructVCardString(data);
      expect(vcardStr).toContain('PHOTO;TYPE=JPEG;ENCODING=b:');
      expect(unfoldString(vcardStr)).toContain(sampleBase64);

      const hydrated = hydrateVCardData(vcardStr);
      expect(hydrated.photo).toBe(`data:image/jpeg;base64,${sampleBase64}`);
      expect(hydrated.firstName).toBe('Alice');
    });

    it('serializes and hydrates PNG base64 photos correctly', () => {
      const sampleBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const data = {
        firstName: 'Bob',
        lastName: 'Jones',
        organization: '',
        title: '',
        phone: '',
        email: '',
        website: '',
        street: '',
        city: '',
        zip: '',
        country: '',
        photo: `data:image/png;base64,${sampleBase64}`,
      };

      const vcardStr = constructVCardString(data);
      expect(vcardStr).toContain('PHOTO;TYPE=PNG;ENCODING=b:');

      const hydrated = hydrateVCardData(vcardStr);
      expect(hydrated.photo).toBe(`data:image/png;base64,${sampleBase64}`);
    });

    it('handles raw base64 string in photo field during construct', () => {
      const sampleBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const data = {
        firstName: 'Charlie',
        lastName: 'Brown',
        organization: '',
        title: '',
        phone: '',
        email: '',
        website: '',
        street: '',
        city: '',
        zip: '',
        country: '',
        photo: sampleBase64,
      };

      const vcardStr = constructVCardString(data);
      expect(vcardStr).toContain('PHOTO;TYPE=JPEG;ENCODING=b:');
      const hydrated = hydrateVCardData(vcardStr);
      expect(hydrated.photo).toBe(`data:image/jpeg;base64,${sampleBase64}`);
    });

    it('hydrates PHOTO with HTTP URL', () => {
      const raw = `BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;John;;;\r\nPHOTO;VALUE=uri:https://example.com/photo.jpg\r\nEND:VCARD`;
      const hydrated = hydrateVCardData(raw);
      expect(hydrated.photo).toBe('https://example.com/photo.jpg');
    });

    it('returns empty photo string for invalid encoding parameters or non-base64 photo data', () => {
      const invalidParamVCard = `BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;John;;;\r\nPHOTO;TYPE=JPEG;ENCODING=UNKNOWN:notvalid\r\nEND:VCARD`;
      expect(hydrateVCardData(invalidParamVCard).photo).toBe('');

      const invalidDataVCard = `BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;John;;;\r\nPHOTO;TYPE=JPEG;ENCODING=b:Invalid Base64 With Special Chars! #$%^&*\r\nEND:VCARD`;
      expect(hydrateVCardData(invalidDataVCard).photo).toBe('');
    });
  });
});
