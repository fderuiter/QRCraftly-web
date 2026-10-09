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

import { describe, it, expect } from 'vitest';
import { QRType } from '@/types';
import { DEFAULT_CONFIG } from '@/constants';
import {
  validatePayload,
  validateConfig,
  sanitizeConfig,
  constructEventString,
  constructMeetingString,
} from '../index';
import { UNSUPPORTED_SCHEME_PREFIX } from '@/utils/security';
import { parseMeetingUrl } from '@/utils/meetingParsers';

const textViolations = (value: string) => validateConfig({ ...DEFAULT_CONFIG, type: QRType.TEXT, value });

const eventViolations = (description: string) =>
  validatePayload(
    constructEventString({ title: 'Meetup', startDate: '2026-10-10T18:00', endDate: '', location: '', description }),
    QRType.EVENT,
  );

describe('Text keeps line breaks and tabs (#1269)', () => {
  it('sanitizeConfig keeps \\t, \\n and \\r but removes other controls', () => {
    const value = 'Line one\r\nLine two\tTabbed\x00\x07\x85';
    expect(sanitizeConfig({ ...DEFAULT_CONFIG, type: QRType.TEXT, value }).value).toBe('Line one\r\nLine two\tTabbed');
  });

  it('keeps every control out of the design text', () => {
    const clean = sanitizeConfig({ ...DEFAULT_CONFIG, type: QRType.TEXT, value: 'a', borderText: 'Scan\nme' });
    expect(clean.borderText).toBe('Scanme');
  });

  it('accepts a multi-line Text payload', () => {
    expect(textViolations('Name: Ada\nRoom: 12')).toEqual([]);
  });
});

describe('zero-width joiners are text, not hidden characters (#1271)', () => {
  it.each(['I ❤️‍🔥 QR', '👨‍👩‍👧', 'می‌خواهم'])('accepts %s', (value) => {
    expect(textViolations(value)).toEqual([]);
  });

  it.each(['Hello​World', 'Hello⁠World', 'Hello﻿World'])('still refuses hidden characters in %s', (value) => {
    expect(textViolations(value)).toContain('Payload contains invalid control or zero-width characters');
  });

  it('still refuses them in Wi-Fi networks', () => {
    expect(validatePayload('WIFI:T:WPA;S:Home‍Net;P:password1;;', QRType.WIFI)).not.toEqual([]);
  });
});

describe('e-mail addresses follow the HTML grammar (#1273)', () => {
  it.each(["o'brien@example.com", "d'angelo.smith@example.ie", 'info@xn--e1afmkfd.xn--p1ai', 'user@[192.0.2.1]', 'jane.doe+tickets@example.com'])(
    'accepts %s',
    (address) => {
      expect(validatePayload(`mailto:${address}`, QRType.EMAIL)).toEqual([]);
    },
  );

  it.each(['a@', '@b.com', 'a%20b@c.com', 'a@b', 'a@-b.com'])('refuses %s', (address) => {
    expect(validatePayload(`mailto:${address}`, QRType.EMAIL)).toContain('EMAIL_STRUCTURE_VIOLATION');
  });
});

describe('a word before a colon is not a scheme (#1274)', () => {
  it.each(['About: QRCraftly', 'Data: 42', 'File: invoice.pdf', 'Intent: purchase', 'Jar: 3', 'Blob: green'])(
    'accepts Text %s',
    (value) => {
      expect(textViolations(value)).toEqual([]);
    },
  );

  it.each([
    'About: our annual meetup',
    'Topics: AI, Data: trends',
    'Map: https://en.wikipedia.org/wiki/File:Paris_map.png',
  ])('accepts the event description %s', (description) => {
    expect(eventViolations(description)).toEqual([]);
  });

  it.each(['javascript: alert(1)', 'about:blank', 'data:text/html,<b>x</b>', 'data: text/html,<b>x</b>', 'file:///etc/passwd'])(
    'still refuses Text %s',
    (value) => {
      expect(textViolations(value)).toContain('URI_INJECTION_VIOLATION');
    },
  );

  it.each([
    'Join us javascript:alert(1)',
    'Join us\njavascript: alert(1)',
    'See (java\tscript:alert(1))',
    'Open https://example.com then about:blank',
  ])('still refuses the event description %s', (description) => {
    expect(eventViolations(description)).toContain('URI_INJECTION_VIOLATION');
  });
});

describe('schemes without // still meet the link allowlist (#1276)', () => {
  it.each([QRType.URL, QRType.MEETING])('refuses unlisted schemes for %s', (type) => {
    for (const [input, scheme] of [
      ['microsoft-edge:https://example.com', 'microsoft-edge'],
      ['shortcuts:run-shortcut?name=Wipe', 'shortcuts'],
      ['ms-settings:privacy-webcam', 'ms-settings'],
      ['chrome:settings', 'chrome'],
    ]) {
      expect(validatePayload(input, type)).toEqual([`${UNSUPPORTED_SCHEME_PREFIX}${scheme}`]);
    }
  });

  it.each(['https://localhost:3000/', 'localhost:3000', 'example.com:8080/path', 'msteams:/l/meetup-join/x'])(
    'keeps %s valid',
    (value) => {
      expect(validateConfig({ ...DEFAULT_CONFIG, type: QRType.URL, value })).toEqual([]);
    },
  );
});

describe('meeting links without https:// (#1280)', () => {
  it.each([
    ['zoom.us/j/1234567890?pwd=abc', 'zoom'],
    ['teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0', 'teams'],
    ['meet.google.com/abc-defg-hij', 'meet'],
  ])('encodes %s as an https link and detects the service', (url, service) => {
    const encoded = constructMeetingString({ url });
    expect(encoded).toBe(`https://${url}`);
    expect(validatePayload(encoded, QRType.MEETING)).toEqual([]);
    expect(parseMeetingUrl(url).service).toBe(service);
  });

  it('leaves app links and full links unchanged', () => {
    expect(constructMeetingString({ url: 'zoommtg://zoom.us/join?confno=123' })).toBe('zoommtg://zoom.us/join?confno=123');
    expect(constructMeetingString({ url: ' https://zoom.us/j/1 ' })).toBe('https://zoom.us/j/1');
  });
});
