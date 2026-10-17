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
import { constructVCardString, hydrateVCardData, VCardContract, vCardFieldError, CARD_FIELDS, cardFieldsFor, VCARD_SOCIAL_FIELDS, socialProfileUrl, type VCardSocialField } from '../index';
import { QRType, type VCardData } from '@/types';

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

  it('validates individual vCard fields using vCardFieldError', () => {
    // Website field validates scheme and control characters
    expect(vCardFieldError('website', 'javascript:alert(1)')).toBe(
      'Unsafe URL scheme or malicious protocol detected.'
    );
    expect(vCardFieldError('website', 'https://example.com')).toBeUndefined();
    expect(vCardFieldError('website', 'https://example.com\x00')).toBe(
      'Contains invalid control or zero-width characters.'
    );

    // Plain text fields allow colons / scheme-like titles but refuse control characters
    expect(vCardFieldError('title', 'Javascript: The Good Parts')).toBeUndefined();
    expect(vCardFieldError('organization', 'Data: I/O Labs')).toBeUndefined();
    expect(vCardFieldError('firstName', 'About:Us Inc')).toBeUndefined();
    expect(vCardFieldError('phone', '+1 (555) 000-0000')).toBeUndefined();
    expect(vCardFieldError('email', 'user@example.com')).toBeUndefined();

    // Plain text fields refuse control characters
    expect(vCardFieldError('title', 'Software\x00Engineer')).toBe(
      'Contains invalid control or zero-width characters.'
    );
    expect(vCardFieldError('organization', 'Acme\x07Corp')).toBe(
      'Contains invalid control or zero-width characters.'
    );
    expect(vCardFieldError('firstName', 'Jane\x00')).toBe(
      'Contains invalid control or zero-width characters.'
    );

    // Empty or undefined values return undefined
    expect(vCardFieldError('firstName', '')).toBeUndefined();
    expect(vCardFieldError('firstName', undefined)).toBeUndefined();
    expect(CARD_FIELDS.length).toBe(16);
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
  describe('a card with no person name (#1481)', () => {
    it.each([
      ['phone', 'TEL:+15550100', '+15550100'],
      ['email', 'EMAIL:info@example.com', 'info@example.com'],
      ['organisation', 'ORG:Acme Inc', 'Acme Inc'],
    ])('keeps an FN that repeats the %s out of First Name', (_field, line, fn) => {
      const hydrated = hydrateVCardData(['BEGIN:VCARD', 'VERSION:4.0', 'N:;;;;', `FN:${fn}`, line, 'END:VCARD'].join('\r\n'));
      expect(hydrated.firstName).toBe('');
      expect(hydrated.lastName).toBe('');
      expect(constructVCardString(hydrated)).toContain('N:;;;;');
    });

    it('still takes a real name from FN when N is empty', () => {
      const hydrated = hydrateVCardData('BEGIN:VCARD\r\nVERSION:4.0\r\nN:;;;;\r\nFN:Ann Lee\r\nTEL:+15550100\r\nEND:VCARD');
      expect(hydrated).toMatchObject({ firstName: 'Ann', lastName: 'Lee', phone: '+15550100' });
    });
  });
});

describe('Social profiles (#1470)', () => {
  const blankCard = (overrides: Partial<VCardData> = {}): VCardData => ({
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
    x: '',
    linkedin: '',
    instagram: '',
    facebook: '',
    github: '',
    ...overrides,
  });

  const fullSocials = {
    x: 'jane',
    linkedin: 'jane',
    instagram: 'jane',
    facebook: 'jane',
    github: 'jane',
  } as const;

  const expectedProfiles: Record<VCardSocialField, string> = {
    x: 'https://x.com/jane',
    linkedin: 'https://linkedin.com/in/jane',
    instagram: 'https://instagram.com/jane',
    facebook: 'https://facebook.com/jane',
    github: 'https://github.com/jane',
  };

  const socialLineTypes = (text: string): string[] =>
    text
      .split(/\r\n|\n|\r/)
      .map((line) => /^URL;TYPE=([a-z]+):/.exec(line)?.[1])
      .filter((type): type is string => type !== undefined);

  describe('socialProfileUrl', () => {
    it.each([undefined, '', '   ', '\t\n '])('returns null for blank input %j', (value) => {
      for (const field of VCARD_SOCIAL_FIELDS) {
        expect(socialProfileUrl(field, value)).toBeNull();
      }
    });

    it.each(VCARD_SOCIAL_FIELDS)('expands a bare handle and an @handle for %s', (field) => {
      expect(socialProfileUrl(field, 'jane')).toEqual({ url: expectedProfiles[field] });
      expect(socialProfileUrl(field, '@jane')).toEqual({ url: expectedProfiles[field] });
    });

    it('trims surrounding whitespace before reading a handle', () => {
      expect(socialProfileUrl('github', '  @jane  ')).toEqual({ url: 'https://github.com/jane' });
    });

    it('keeps a full profile link on its network and upgrades it to https', () => {
      expect(socialProfileUrl('github', 'http://github.com/jane')).toEqual({ url: 'https://github.com/jane' });
      expect(socialProfileUrl('linkedin', 'linkedin.com/company/acme')).toEqual({
        url: 'https://linkedin.com/company/acme',
      });
      expect(socialProfileUrl('linkedin', 'https://www.linkedin.com/in/jane')).toEqual({
        url: 'https://www.linkedin.com/in/jane',
      });
    });

    it.each([
      ['x', 'https://twitter.com/jane'],
      ['x', 'https://www.x.com/jane'],
      ['facebook', 'https://fb.com/jane'],
      ['facebook', 'https://m.facebook.com/jane'],
      ['facebook', 'https://mobile.facebook.com/jane'],
    ] as const)('accepts the alternate host of %s: %s', (field, typed) => {
      const result = socialProfileUrl(field, typed);
      expect(result?.error).toBeUndefined();
      expect(result?.url).toMatch(/^https:\/\/[^/]+\/jane$/);
    });

    it.each([
      ['github', 'https://example.com/jane'],
      ['github', 'https://github.com.evil.example/jane'],
      ['linkedin', 'https://example.com/x'],
      ['x', 'https://instagram.com/jane'],
    ] as const)('rejects a link that is not on the network host: %s %s', (field, typed) => {
      expect(socialProfileUrl(field, typed)?.error).toEqual(expect.any(String));
    });

    it('rejects a host with no path', () => {
      expect(socialProfileUrl('github', 'https://github.com/')?.error).toEqual(expect.any(String));
      expect(socialProfileUrl('github', 'https://github.com')?.error).toEqual(expect.any(String));
    });

    it('does not read a bare host such as github.com as a user name', () => {
      // `github.com` has no scheme and no slash, so it is read as a handle. Its profile link would
      // be https://github.com/github.com, a user named after the site itself.
      expect(socialProfileUrl('github', 'github.com')?.error).toEqual(expect.any(String));
    });

    it.each(['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'vbscript:msgbox(1)'])(
      'rejects a dangerous scheme: %s',
      (typed) => {
        for (const field of VCARD_SOCIAL_FIELDS) {
          expect(socialProfileUrl(field, typed)?.error).toEqual(expect.any(String));
        }
      },
    );

    it.each(['jane doe', 'ja$ne', 'jane?x', 'jane#x', '@', '@@jane', 'jäne'])(
      'rejects a handle with invalid characters: %j',
      (typed) => {
        expect(socialProfileUrl('github', typed)?.error).toEqual(expect.any(String));
      },
    );

    it.each([
      'https://github.com/jane;x',
      'https://github.com/jane,x',
      'github.com/jane;',
    ])('rejects a link containing ; or , : %s', (typed) => {
      expect(socialProfileUrl('github', typed)?.error).toEqual(expect.any(String));
    });

    it('accepts a 100-character handle and rejects 101 characters', () => {
      const ok = 'a'.repeat(100);
      const tooLong = 'a'.repeat(101);
      expect(socialProfileUrl('github', ok)).toEqual({ url: `https://github.com/${ok}` });
      expect(socialProfileUrl('github', tooLong)?.error).toEqual(expect.any(String));
    });

    it.each([
      ['x', 'jane.doe_1-'],
      ['github', 'https://github.com/jane'],
      ['linkedin', 'https://www.linkedin.com/in/jane-doe'],
      ['instagram', 'instagram.com/jane.doe'],
    ] as const)('is stable: reading its own output for %s %s gives the same url', (field, typed) => {
      const first = socialProfileUrl(field, typed);
      expect(first?.url).toBeDefined();
      expect(socialProfileUrl(field, first?.url)).toEqual(first);
    });

    it.each(['.', '..'])('gives a stable result for the handle %j', (handle) => {
      // A dot handle is a valid handle, but the link it becomes is re-parsed by the URL
      // parser (`https://github.com/..` normalises to the bare host), so reading the output
      // again must give the same url or an error, never a different url.
      const first = socialProfileUrl('github', handle);
      if (first?.url === undefined) {
        expect(first?.error).toEqual(expect.any(String));
        return;
      }
      expect(socialProfileUrl('github', first.url)).toEqual(first);
    });
  });

  describe('vCard output', () => {
    it.each(['2.1', '3.0', '4.0'] as const)('writes one URL;TYPE line per filled social field in %s', (version) => {
      const text = constructVCardString(blankCard({ version, website: 'https://example.com', ...fullSocials }));
      expect(text).toContain('URL;TYPE=x:https://x.com/jane');
      expect(text).toContain('URL;TYPE=linkedin:https://linkedin.com/in/jane');
      expect(text).toContain('URL;TYPE=instagram:https://instagram.com/jane');
      expect(text).toContain('URL;TYPE=facebook:https://facebook.com/jane');
      expect(text).toContain('URL;TYPE=github:https://github.com/jane');
      expect(socialLineTypes(text)).toEqual(['x', 'linkedin', 'instagram', 'facebook', 'github']);
    });

    it.each(['2.1', '3.0', '4.0'] as const)('puts the plain website line before the social lines in %s', (version) => {
      const text = constructVCardString(blankCard({ version, website: 'https://example.com', github: 'jane' }));
      const lines = text.split(/\r\n/);
      const websiteAt = lines.indexOf('URL:https://example.com/');
      const githubAt = lines.indexOf('URL;TYPE=github:https://github.com/jane');
      expect(websiteAt).toBeGreaterThanOrEqual(0);
      expect(githubAt).toBeGreaterThan(websiteAt);
    });

    it('writes social lines in field order regardless of the order the fields were filled', () => {
      const text = constructVCardString(
        blankCard({ github: 'jane', facebook: 'jane', x: 'jane', instagram: 'jane', linkedin: 'jane' }),
      );
      expect(socialLineTypes(text)).toEqual(['x', 'linkedin', 'instagram', 'facebook', 'github']);
    });

    it('writes no social line for blank, whitespace or invalid social values', () => {
      const text = constructVCardString(
        blankCard({ firstName: 'Jane', x: '', linkedin: '   ', github: 'https://example.com/jane' }),
      );
      expect(socialLineTypes(text)).toEqual([]);
      expect(text).not.toMatch(/TYPE=github/);
    });

    it('writes no social line for a card without social values', () => {
      expect(socialLineTypes(constructVCardString(blankCard({ firstName: 'Jane', website: 'https://example.com' })))).toEqual([]);
    });

    it('gives a code when only a social field is filled', () => {
      const text = constructVCardString(blankCard({ github: 'jane' }));
      expect(text).not.toBe('');
      expect(socialLineTypes(text)).toEqual(['github']);
    });

    it('gives no code for a whitespace-only social field', () => {
      expect(constructVCardString(blankCard({ x: '   ' }))).toBe('');
    });

    it('never writes social values into a MECard', () => {
      const text = constructVCardString(
        blankCard({ version: 'mecard', firstName: 'Jane', lastName: 'Doe', website: 'https://example.com', ...fullSocials }),
      );
      expect(text.startsWith('MECARD:')).toBe(true);
      expect(text).not.toContain('jane');
      expect(text).not.toContain('x.com');
      expect(text).not.toContain('github');
      expect(text).toMatch(/URL:https\\:\/\/example\.com\/;/);
    });

    it('gives no code for a MECard whose only filled field is a social profile', () => {
      expect(constructVCardString(blankCard({ version: 'mecard', ...fullSocials }))).toBe('');
    });
  });

  describe('hydration', () => {
    it.each(['2.1', '3.0', '4.0'] as const)('reads each social line back as its profile url in %s', (version) => {
      const text = constructVCardString(
        blankCard({ version, firstName: 'Jane', website: 'https://example.com', linkedin: 'jane', github: '@jane' }),
      );
      const hydrated = hydrateVCardData(text);
      expect(hydrated).toMatchObject({
        version,
        firstName: 'Jane',
        website: 'https://example.com/',
        linkedin: 'https://linkedin.com/in/jane',
        github: 'https://github.com/jane',
      });
      expect(hydrated.x ?? '').toBe('');
      expect(hydrated.instagram ?? '').toBe('');
      expect(hydrated.facebook ?? '').toBe('');
    });

    it('round-trips every social field and keeps the website separate', () => {
      const text = constructVCardString(blankCard({ website: 'https://example.com', ...fullSocials }));
      const hydrated = hydrateVCardData(text);
      for (const field of VCARD_SOCIAL_FIELDS) {
        expect(hydrated[field]).toBe(expectedProfiles[field]);
      }
      expect(hydrated.website).toBe('https://example.com/');
    });

    it('reads a URL;TYPE line with another type, or a type in any case, correctly', () => {
      const hydrated = hydrateVCardData(
        'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Jane\r\nURL;TYPE=WORK:https://example.com/\r\nURL;TYPE=GitHub:https://github.com/jane\r\nEND:VCARD',
      );
      expect(hydrated.website).toBe('https://example.com/');
      expect(hydrated.github).toBe('https://github.com/jane');
    });

    it('gives no social fields when hydrating a MECard', () => {
      const text = constructVCardString(blankCard({ version: 'mecard', firstName: 'Jane', ...fullSocials }));
      const hydrated = hydrateVCardData(text);
      expect(hydrated.version).toBe('mecard');
      for (const field of VCARD_SOCIAL_FIELDS) {
        expect(hydrated[field] ?? '').toBe('');
      }
      const plain = hydrateVCardData('MECARD:N:Lee,Ann;URL:https://example.com;;');
      expect(plain.website).toBe('https://example.com');
      expect(plain).not.toHaveProperty('github');
    });
  });

  describe('field rules', () => {
    it('cardFieldsFor leaves the social fields out of MECard only', () => {
      for (const field of VCARD_SOCIAL_FIELDS) {
        expect(cardFieldsFor('mecard')).not.toContain(field);
        expect(cardFieldsFor('3.0')).toContain(field);
        expect(cardFieldsFor('4.0')).toContain(field);
        expect(cardFieldsFor('2.1')).toContain(field);
      }
      expect(cardFieldsFor('mecard')).toContain('website');
    });

    it('vCardFieldError reports a social field whose link is not on its network', () => {
      expect(vCardFieldError('linkedin', 'https://example.com/x')).toEqual(expect.any(String));
    });

    it('vCardFieldError accepts blank, whitespace and valid social values', () => {
      expect(vCardFieldError('github', undefined)).toBeUndefined();
      expect(vCardFieldError('github', '')).toBeUndefined();
      expect(vCardFieldError('github', '   ')).toBeUndefined();
      expect(vCardFieldError('github', 'jane')).toBeUndefined();
    });

    it('vCardFieldError applies the scheme check only to website and social fields', () => {
      expect(vCardFieldError('firstName', 'javascript:alert(1)')).toBeUndefined();
      expect(vCardFieldError('organization', 'javascript:alert(1)')).toBeUndefined();
      expect(vCardFieldError('website', 'javascript:alert(1)')).toEqual(expect.any(String));
      expect(vCardFieldError('github', 'javascript:alert(1)')).toEqual(expect.any(String));
    });

    it('VCardContract.validate flags a dangerous social URL line', () => {
      const card = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Jane\r\nURL;TYPE=github:javascript:alert(1)\r\nEND:VCARD';
      expect(VCardContract.validate?.(card)).toEqual(['URI_INJECTION_VIOLATION']);
    });

    it('VCardContract.validate passes a safe social URL line', () => {
      const card = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Jane\r\nURL;TYPE=github:https://github.com/jane\r\nEND:VCARD';
      expect(VCardContract.validate?.(card)).toEqual([]);
    });
  });
});
