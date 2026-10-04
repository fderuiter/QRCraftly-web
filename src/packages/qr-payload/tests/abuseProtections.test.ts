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
import { QRType } from '@/types';
import { validatePayload, validateConfig, sanitizeConfig, describeViolation } from '../index';
import { DEFAULT_CONFIG } from '@/constants';
import { UNSUPPORTED_SCHEME_PREFIX } from '@/utils/security';

describe('dangerous schemes are refused in every QR type (#1153)', () => {
  it.each([QRType.TEXT, QRType.PHONE, QRType.WIFI, QRType.SOCIAL, QRType.URL, QRType.MEETING])(
    'rejects javascript: and data: payloads for %s',
    (type) => {
      expect(validatePayload('javascript:alert(1)', type)).toContain('URI_INJECTION_VIOLATION');
      expect(validatePayload('data:text/html,<script>alert(1)</script>', type)).toContain('URI_INJECTION_VIOLATION');
      expect(validatePayload('  JaVa\tScript:alert(1)', type)).toContain('URI_INJECTION_VIOLATION');
    },
  );

  it('lets text that only mentions a scheme mid-sentence through', () => {
    expect(validatePayload('Never click javascript:alert(1) links', QRType.TEXT)).toEqual([]);
    expect(validatePayload('Hello, world', QRType.TEXT)).toEqual([]);
  });

  it.each(['intent:', 'itms-services:', 'ms-msdt:', 'search-ms:', 'ms-officecmd:', 'jar:', 'view-source:'])(
    'blocks %s globally',
    (scheme) => {
      expect(validatePayload(`${scheme}//x`, QRType.TEXT)).toContain('URI_INJECTION_VIOLATION');
    },
  );
});

describe('URL and Meeting use a scheme allowlist (#1153)', () => {
  it.each([QRType.URL, QRType.MEETING])('rejects OS-handler schemes for %s and names the scheme', (type) => {
    const intent = validatePayload('intent://x#Intent;scheme=http;end', type);
    expect(intent).toEqual(['URI_INJECTION_VIOLATION']);

    const other = validatePayload('smb://server/share', type);
    expect(other).toEqual([`${UNSUPPORTED_SCHEME_PREFIX}smb`]);
    expect(describeViolation(other[0])).toContain('"smb:"');

    expect(validatePayload('itms-services://?action=download-manifest&url=https://e.example/m.plist', type)).toEqual([
      'URI_INJECTION_VIOLATION',
    ]);
  });

  it.each([QRType.URL, QRType.MEETING])('accepts web, mail, phone and meeting schemes for %s', (type) => {
    for (const ok of [
      'https://example.com/',
      'http://example.com/path?x=1',
      'mailto:a@example.com',
      'tel:+15551234567',
      'zoommtg://zoom.us/join?confno=123',
      'msteams://teams.microsoft.com/l/meetup-join/x',
      'webex://meet/abc',
      'geo:40.7,-74.0',
    ]) {
      expect(validatePayload(ok, type), ok).toEqual([]);
    }
  });

  it('does not treat host:port input as a scheme', () => {
    expect(validatePayload('https://localhost:3000/', QRType.URL)).toEqual([]);
  });
});

describe('describeViolation', () => {
  it('maps known codes and passes unknown ones through', () => {
    expect(describeViolation('URI_INJECTION_VIOLATION')).toMatch(/Unsafe URL scheme/);
    expect(describeViolation('Custom message')).toBe('Custom message');
  });
});

describe('event dates (#1160)', () => {
  const vevent = (start: string) => `BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Launch\nDTSTART:${start}\nEND:VEVENT\nEND:VCALENDAR`;

  it('rejects a date that does not parse instead of passing it through', () => {
    expect(validatePayload(vevent('not-a-date'), QRType.EVENT)).toContain('EVENT_INVALID_DATE_VIOLATION');
    expect(describeViolation('EVENT_INVALID_DATE_VIOLATION')).toMatch(/not a valid date/);
  });

  it('accepts a valid date', () => {
    expect(validatePayload(vevent('20261003T100000Z'), QRType.EVENT)).not.toContain('EVENT_INVALID_DATE_VIOLATION');
  });
});

describe('text-direction controls (#1160)', () => {
  const rlo = String.fromCharCode(0x202e);
  const isolate = String.fromCharCode(0x2066);
  const arabic = String.fromCharCode(0x0645, 0x0631, 0x062d, 0x0628, 0x0627);

  it.each([
    [QRType.WIFI, `WIFI:T:WPA;S:Cafe${rlo}gpj;P:secret;;`],
    [QRType.PHONE, `tel:+1555${rlo}0100`],
    [QRType.SMS, `sms:+1555${isolate}0100?body=Hi`],
  ])('refuses them in %s payloads', (type, payload) => {
    expect(validatePayload(payload, type).join(' ')).toMatch(/text-direction/);
  });

  it('keeps real right-to-left text, and allows the controls where text needs them', () => {
    expect(validatePayload(`WIFI:T:WPA;S:${arabic};P:secret;;`, QRType.WIFI)).toEqual([]);
    expect(validatePayload(`${arabic} ${rlo}text`, QRType.TEXT)).toEqual([]);
  });

  it('refuses them in border and template text, and strips them on sanitising', () => {
    const config = { ...DEFAULT_CONFIG, borderText: `Scan${rlo}me`, templateHeadline: `Hi${isolate}`, value: 'https://example.com' };
    expect(validateConfig(config).join(' ')).toMatch(/Border Text contains hidden text-direction/);
    expect(validateConfig(config).join(' ')).toMatch(/Template Headline contains hidden text-direction/);
    const clean = sanitizeConfig(config);
    expect(clean.borderText).toBe('Scanme');
    expect(clean.templateHeadline).toBe('Hi');
    expect(sanitizeConfig({ ...config, type: QRType.WIFI, value: `WIFI:S:a${rlo}b;;` }).value).toBe('WIFI:S:ab;;');
  });
});
