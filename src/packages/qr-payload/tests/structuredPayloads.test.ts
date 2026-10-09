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
import { CalendarProvider, QRType, SocialPlatform } from '@/types';
import {
  constructEmailString,
  constructEventString,
  constructLocationString,
  constructPhoneString,
  constructVCardString,
  coordinateError,
  describeViolation,
  droppedPhoneCharacters,
  formatEventDateTime,
  hydrateEmailData,
  hydrateEventData,
  hydrateLocationData,
  hydratePhoneData,
  hydrateSmsData,
  hydrateSocialData,
  hydrateVCardData,
  identifyProtocol,
  validatePayload,
} from '../index';

const roundTrip = <T>(hydrate: (raw: string) => T, construct: (data: T) => string, raw: string): string =>
  construct(hydrate(raw));

describe('Location coordinates (#1270)', () => {
  it.each([
    ['52,5200', '13,4050', 'geo:52.52,13.405'],
    ['40.7128N', '74.0060W', 'geo:40.7128,-74.006'],
    ['33.8688° S', '151.2093° E', 'geo:-33.8688,151.2093'],
    ['0.0000005', '0.0000001', 'geo:0.0000005,0.0000001'],
    ['-0.0', '0', 'geo:0,0'],
  ])('reads %s, %s as %s', (latitude, longitude, expected) => {
    expect(constructLocationString({ latitude, longitude })).toBe(expected);
  });

  it.each([['12abc'], ['40.7128E'], ['-40N'], ['1e5'], ['40..1']])('refuses %s', (latitude) => {
    expect(constructLocationString({ latitude, longitude: '1' })).toBe('');
    expect(coordinateError(latitude, 'latitude')).toMatch(/Latitude must be a number/);
  });

  it('explains out-of-range and accepts empty or valid values', () => {
    expect(coordinateError('95', 'latitude')).toBe('Latitude must be between -90 and 90 degrees.');
    expect(coordinateError('181W', 'longitude')).toBe('Longitude must be between -180 and 180 degrees.');
    expect(coordinateError('', 'latitude')).toBeNull();
    expect(coordinateError('74.0060 W', 'longitude')).toBeNull();
  });

  it('still reports out-of-bounds codes', () => {
    expect(validatePayload('geo:95,10', QRType.LOCATION)).toContain('LATITUDE_OUT_OF_BOUNDS_VIOLATION');
  });
});

describe('Geo URIs the form cannot show stay Text (#1282)', () => {
  it.each([['geo:0,0?q=1600+Amphitheatre+Pkwy'], ['geo:37.78,-122.4;u=35'], ['geo:1,2,30']])('%s', (raw) => {
    expect(identifyProtocol(raw)).toBe(QRType.TEXT);
    expect(hydrateLocationData(raw)).toEqual({ latitude: '', longitude: '' });
  });

  it('a plain geo URI is a location and round-trips', () => {
    expect(identifyProtocol('geo:37.7749,-122.4194')).toBe(QRType.LOCATION);
    expect(roundTrip(hydrateLocationData, constructLocationString, 'geo:37.7749,-122.4194')).toBe('geo:37.7749,-122.4194');
  });
});

describe('Phone extensions and pauses (#1277)', () => {
  it.each([
    ['+1 555 123 4567 x89', 'tel:+15551234567;ext=89'],
    ['+44 20 7946 0958 ext 12', 'tel:+442079460958;ext=12'],
    ['+1 555 123 4567 ext. 89', 'tel:+15551234567;ext=89'],
    ['+1 555 123 4567 extension 89', 'tel:+15551234567;ext=89'],
    ['+15551234567;ext=89', 'tel:+15551234567;ext=89'],
    ['+1 (555) 123-4567,,89#', 'tel:+1(555)123-4567,,89%23'],
  ])('%s -> %s', (number, expected) => {
    expect(constructPhoneString({ number })).toBe(expected);
  });

  it('round-trips a scanned extension through the form', () => {
    const hydrated = hydratePhoneData('tel:+15551234567;ext=89');
    expect(hydrated.number).toBe('+15551234567 ext. 89');
    expect(constructPhoneString(hydrated)).toBe('tel:+15551234567;ext=89');
  });

  it('lists the characters a code leaves out', () => {
    expect(droppedPhoneCharacters('+1 555 CALL NOW')).toEqual(['C', 'A', 'L', 'N', 'O', 'W']);
    expect(droppedPhoneCharacters('+1 555 123 4567 ext. 89')).toEqual([]);
    expect(droppedPhoneCharacters('+15550001;+15550002', true)).toEqual([]);
  });
});

describe('mailto and sms queries (#1284, #1367)', () => {
  it('reads header names case-insensitively', () => {
    const data = hydrateEmailData('mailto:a@example.com?Subject=Hello&Body=There&Cc=c@example.com');
    expect(data).toMatchObject({ subject: 'Hello', body: 'There', cc: 'c@example.com' });
  });

  it('keeps + as a plus', () => {
    expect(hydrateEmailData('mailto:a@example.com?subject=C++%20rocks&body=1+1=2')).toMatchObject({
      subject: 'C++ rocks',
      body: '1+1=2',
    });
    expect(hydrateSmsData('sms:+15551234567?body=1+1=2').message).toBe('1+1=2');
  });

  it('accepts to=, cc= and several recipients', () => {
    expect(validatePayload('mailto:a@example.com?cc=b@example.com&subject=Hi', QRType.EMAIL)).toEqual([]);
    const raw = 'mailto:a@example.com,b@example.com?to=c@example.com&subject=Hi';
    expect(validatePayload(raw, QRType.EMAIL)).toEqual([]);
    const data = hydrateEmailData(raw);
    expect(data.email).toBe('a@example.com,b@example.com,c@example.com');
    expect(constructEmailString(data)).toBe('mailto:a@example.com,b@example.com,c@example.com?subject=Hi&body=');
  });

  it('checks Cc and Bcc as addresses', () => {
    expect(validatePayload('mailto:a@example.com?cc=not%20an%20email', QRType.EMAIL)).toContain('EMAIL_STRUCTURE_VIOLATION');
    expect(validatePayload('mailto:a@example.com?bcc=b@example.com,nope', QRType.EMAIL)).toContain('EMAIL_STRUCTURE_VIOLATION');
  });

  it('still refuses an unencoded & and explains it', () => {
    const violations = validatePayload('mailto:a@example.com?subject=Tom&Jerry', QRType.EMAIL);
    expect(violations).toContain('DELIMITER_VIOLATION');
    expect(describeViolation('DELIMITER_VIOLATION')).not.toBe('DELIMITER_VIOLATION');
  });

  it('writes body line breaks as CRLF and reads them back as one line break', () => {
    const raw = constructEmailString({ email: 'a@example.com', subject: 'Hi', body: 'line1\nline2' });
    expect(raw).toBe('mailto:a@example.com?subject=Hi&body=line1%0D%0Aline2');
    expect(hydrateEmailData(raw).body).toBe('line1\nline2');
  });
});

describe('Social links (#1282, #1363)', () => {
  it.each([
    ['https://www.instagram.com/p/C1abcDEF/'],
    ['https://x.com/jack/status/20'],
    ['https://twitter.com/intent/tweet?text=hi'],
    ['https://vm.tiktok.com/ZMabc/'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://github.com/fderuiter/QRCraftly-web/issues/1'],
    ['https://www.facebook.com/sharer.php'],
    ['https://linkedin.com/company/acme'],
    ['https://instagram.com/jack?igsh=abc'],
  ])('%s stays a Website code', (raw) => {
    expect(identifyProtocol(raw)).toBe(QRType.URL);
    expect(hydrateSocialData(raw).handle).toBe('');
  });

  it.each([
    ['https://www.instagram.com/jack/', SocialPlatform.INSTAGRAM, 'jack'],
    ['https://m.facebook.com/zuck', SocialPlatform.FACEBOOK, 'zuck'],
    ['https://mobile.twitter.com/jack', SocialPlatform.TWITTER, 'jack'],
    ['https://www.youtube.com/@mkbhd', SocialPlatform.YOUTUBE, 'mkbhd'],
    ['https://www.linkedin.com/in/jane-doe', SocialPlatform.LINKEDIN, 'jane-doe'],
    ['https://github.com/fderuiter', SocialPlatform.GITHUB, 'fderuiter'],
  ])('%s is a profile', (raw, platform, handle) => {
    expect(identifyProtocol(raw)).toBe(QRType.SOCIAL);
    expect(hydrateSocialData(raw)).toEqual({ platform, handle });
  });
});

describe('Calendar links (#1363)', () => {
  it.each([
    ['https://outlook.office.com/mail/inbox'],
    ['https://calendar.google.com/calendar/u/0/r'],
    ['https://www.google.com/calendar/about'],
    ['https://calendar.yahoo.com/'],
  ])('%s stays a Website code', (raw) => {
    expect(identifyProtocol(raw)).toBe(QRType.URL);
  });
});

describe('vCard hydration (#1282) and output (#1367)', () => {
  it('reads grouped properties from Apple Contacts', () => {
    const raw = 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;Jane;;;\r\nitem1.EMAIL;type=INTERNET:jane@example.com\r\nitem2.URL:https://example.com\r\nEND:VCARD';
    expect(hydrateVCardData(raw)).toMatchObject({ email: 'jane@example.com', website: 'https://example.com' });
  });

  it('checks grouped URLs for dangerous schemes', () => {
    const raw = 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;Jane;;;\r\nitem1.URL:javascript:alert(1)\r\nEND:VCARD';
    expect(validatePayload(raw, QRType.VCARD)).toContain('URI_INJECTION_VIOLATION');
  });

  it('takes the name from FN when there is no N', () => {
    const data = hydrateVCardData('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Mary Ann Smith\r\nEND:VCARD');
    expect(data).toMatchObject({ firstName: 'Mary Ann', lastName: 'Smith' });
  });

  it('reads structured ORG and URI TEL values', () => {
    const data = hydrateVCardData('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:A B\r\nORG:Acme;\r\nTEL;VALUE=uri:tel:+1-555-0100\r\nEND:VCARD');
    expect(data.organization).toBe('Acme');
    expect(data.phone).toBe('+1-555-0100');
    expect(constructVCardString(data)).toContain('\r\nORG:Acme\r\n');
  });

  it('never writes an empty FN', () => {
    const base = hydrateVCardData('');
    expect(constructVCardString({ ...base, version: '4.0', organization: 'Acme' })).toContain('\r\nFN:Acme\r\n');
    expect(constructVCardString({ ...base, version: '3.0', firstName: 'Jane' })).toContain('\r\nFN:Jane\r\n');
  });

  it('writes vCard 2.1 with CHARSET for non-ASCII text and 2.1 escaping', () => {
    const base = hydrateVCardData('');
    const raw = constructVCardString({ ...base, version: '2.1', firstName: 'José', lastName: 'Smith, Jr.' });
    expect(raw).toContain('\r\nFN;CHARSET=UTF-8:José Smith, Jr.\r\n');
    expect(raw).toContain('\r\nN;CHARSET=UTF-8:Smith, Jr.;José;;;\r\n');
  });
});

describe('Calendar dates (#1281, #1364)', () => {
  const allDay = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Christmas\r\nDTSTART;VALUE=DATE:20251225\r\nDTEND;VALUE=DATE:20251226\r\nEND:VEVENT\r\nEND:VCALENDAR';

  it('validates a scanned all-day event and keeps it all-day after an edit', () => {
    expect(validatePayload(allDay, QRType.EVENT)).toEqual([]);
    const data = hydrateEventData(allDay);
    expect(data).toMatchObject({ allDay: true, startDate: '2025-12-25', endDate: '2025-12-25' });
    const rebuilt = constructEventString({ ...data, title: 'Xmas' });
    expect(rebuilt).toContain('DTSTART;VALUE=DATE:20251225');
    expect(rebuilt).toContain('DTEND;VALUE=DATE:20251226');
    expect(validatePayload(rebuilt, QRType.EVENT)).toEqual([]);
  });

  it('writes all-day web-calendar links with an exclusive end', () => {
    const data = { title: 'Trip', startDate: '2025-12-24', endDate: '2025-12-26', location: '', description: '', allDay: true };
    const google = constructEventString({ ...data, provider: CalendarProvider.GOOGLE });
    expect(google).toContain('dates=20251224%2F20251227');
    expect(hydrateEventData(google)).toMatchObject({ allDay: true, startDate: '2025-12-24', endDate: '2025-12-26' });
    const outlook = constructEventString({ ...data, provider: CalendarProvider.OUTLOOK });
    expect(outlook).toContain('startdt=2025-12-24&enddt=2025-12-27&allday=true');
    expect(hydrateEventData(outlook)).toMatchObject({ allDay: true, startDate: '2025-12-24', endDate: '2025-12-26' });
  });

  it('reformats wall-clock times without the browser zone', () => {
    // 02:30 on 2025-03-09 does not exist in New York, but it is still the time that was typed.
    expect(formatEventDateTime('2025-03-09T02:30').value).toBe('20250309T023000');
    expect(formatEventDateTime('2025-02-30T10:00').value).toBe('');
    expect(formatEventDateTime('2025-12-25')).toEqual({ value: '20251225', isDate: true });
  });

  it('never writes a TZID without a VTIMEZONE, and round-trips the zone', () => {
    const data = { title: 'Call', startDate: '2025-03-10T09:00', endDate: '2025-03-10T10:00', timezone: 'Europe/Paris', location: '', description: '' };
    const raw = constructEventString(data);
    expect(raw).not.toContain('TZID=');
    expect(raw).toContain('DTSTART:20250310T080000Z');
    expect(hydrateEventData(raw)).toEqual(data);
  });

  it('sends zoned times to Outlook and Yahoo as UTC', () => {
    const data = { title: 'Call', startDate: '2025-07-01T09:00', endDate: '', timezone: 'America/Chicago', location: '', description: '' };
    const outlook = constructEventString({ ...data, provider: CalendarProvider.OFFICE365 });
    expect(outlook).toContain('startdt=2025-07-01T14%3A00%3A00Z');
    expect(hydrateEventData(outlook)).toMatchObject({ startDate: '2025-07-01T09:00', timezone: 'America/Chicago' });
    expect(constructEventString({ ...data, provider: CalendarProvider.YAHOO })).toContain('ST=20250701T140000Z');
  });
});
