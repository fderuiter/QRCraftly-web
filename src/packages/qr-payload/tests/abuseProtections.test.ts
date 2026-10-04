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
import { validatePayload, describeViolation } from '../index';
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
