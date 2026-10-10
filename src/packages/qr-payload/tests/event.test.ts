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
import { constructEventString, hydrateEventData, EventContract, identifyProtocol } from '../index';
import { QRType, CalendarProvider } from '@/types';

describe('Event generator', () => {
  it('constructs and hydrates successfully', () => {
    const data = {
      title: 'Meeting',
      startDate: '2025-01-01T12:30',
      endDate: '2025-01-01T13:30',
      location: 'Room 1',
      description: 'Important meeting\nBe there',
    };
    const str = constructEventString(data);
    const hydrated = hydrateEventData(str);
    expect(hydrated).toEqual(data);
  });

  it('hydrates with missing fields', () => {
    const raw = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:Meeting\nEND:VEVENT\nEND:VCALENDAR`;
    const hydrated = hydrateEventData(raw);
    expect(hydrated.title).toBe('Meeting');
  });

  it('returns default for invalid data', () => {
    expect(hydrateEventData('random')).toEqual({
      title: '',
      startDate: '',
      endDate: '',
      location: '',
      description: '',
    });
  });

  it('parses unescaped fields or unknown fields', () => {
    const raw = `BEGIN:VEVENT\nINVALID:;;;\nEND:VEVENT`;
    const hydrated = hydrateEventData(raw);
    expect(hydrated.title).toBe('');
  });

  it('handles empty parts in EVENT', () => {
    const raw = `BEGIN:VEVENT\nSUMMARY:\nDTSTART:\nDTEND:\nLOCATION:\nDESCRIPTION:\nEND:VEVENT`;
    const hydrated = hydrateEventData(raw);
    expect(hydrated.title).toBe('');
    expect(hydrated.startDate).toBe('');
    expect(hydrated.endDate).toBe('');
    expect(hydrated.location).toBe('');
    expect(hydrated.description).toBe('');
  });

  it('handles lines with only colon', () => {
    const raw = `BEGIN:VEVENT\n:value\nEND:VEVENT`;
    const hydrated = hydrateEventData(raw);
    expect(hydrated.title).toBe('');
  });

  it('handles invalid date formats in EVENT', () => {
    const raw = `BEGIN:VEVENT\nDTSTART:invalid-date\nDTEND:not-a-date\nEND:VEVENT`;
    const hydrated = hydrateEventData(raw);
    expect(hydrated.startDate).toBe('invalid-date');
    expect(hydrated.endDate).toBe('not-a-date');
  });

  it('handles invalid dates when constructing event string', () => {
    const data = {
      title: 'Meeting',
      startDate: 'invalid-date',
      endDate: 'not-a-date',
      location: '',
      description: '',
    };
    const str = constructEventString(data);
    // An unreadable date is left out, never written through as raw text (#1160).
    expect(str).not.toContain('DTSTART');
    expect(str).not.toContain('DTEND');
    expect(str).not.toContain('invalid');
    expect(str).not.toContain('NaN');
  });

  it('builds no code when nothing is typed (#1272)', () => {
    const data = {
      title: undefined as unknown as string,
      startDate: undefined as unknown as string,
      endDate: undefined as unknown as string,
      location: '  ',
      description: undefined as unknown as string,
    };
    expect(constructEventString(data)).toBe('');
  });

  it('handles undefined fields during escaping', () => {
    const data = {
      title: 'Standup',
      startDate: undefined as unknown as string,
      endDate: undefined as unknown as string,
      location: undefined as unknown as string,
      description: undefined as unknown as string,
    };
    const str = constructEventString(data);
    // Empty properties are omitted (RFC 5545); UID and DTSTAMP are always present
    expect(str).toContain('UID:');
    expect(str).toContain('DTSTAMP:');
    expect(str).toContain('SUMMARY:Standup');
    expect(str).not.toContain('DTSTART');
    expect(str).not.toContain('DTEND');
    expect(str).not.toContain('LOCATION:');
    expect(str).not.toContain('DESCRIPTION:');
  });

  it('implements EventContract correctly', () => {
    expect(EventContract.type).toBe(QRType.EVENT);
    expect(EventContract.matches('BEGIN:VEVENT')).toBe(true);
    expect(EventContract.matches('OTHER')).toBe(false);

    // Valid payload should have no violations
    const validRaw = 'BEGIN:VEVENT\nSUMMARY:Launch Party\nDTSTART:20260501T183000\nEND:VEVENT';
    expect(EventContract.validate?.(validRaw)).toEqual([]);

    // Missing summary and start date should trigger violations
    expect(EventContract.validate?.('BEGIN:VEVENT')).toEqual([
      'EVENT_MISSING_SUMMARY',
      'EVENT_MISSING_START',
    ]);

    // Chronological violation (end before start)
    const invalidChrono =
      'BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20260501T183000\nDTEND:20260501T173000\nEND:VEVENT';
    expect(EventContract.validate?.(invalidChrono)).toEqual(['EVENT_CHRONOLOGICAL_VIOLATION']);

    // Dangerous URL injection in location or description
    const dangerousUrlLoc =
      'BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20260501T183000\nLOCATION:javascript:alert(1)\nEND:VEVENT';
    expect(EventContract.validate?.(dangerousUrlLoc)).toEqual(['URI_INJECTION_VIOLATION']);

    // Safe URL in location or description (should not trigger any violation)
    const safeUrlLoc =
      'BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20260501T183000\nLOCATION:https://example.com\nDESCRIPTION:Check out https://google.com\nEND:VEVENT';
    expect(EventContract.validate?.(safeUrlLoc)).toEqual([]);

    // URL-like description (exactly a URL) to cover isUrlLike(data.description)
    const urlDesc =
      'BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20260501T183000\nDESCRIPTION:https://example.com\nEND:VEVENT';
    expect(EventContract.validate?.(urlDesc)).toEqual([]);

    // Valid event with both start and end dates (DTEND >= DTSTART)
    const validChronoWithEnd =
      'BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20260501T183000\nDTEND:20260501T193000\nEND:VEVENT';
    expect(EventContract.validate?.(validChronoWithEnd)).toEqual([]);

    // Unreadable dates are rejected, and are not mistaken for a chronology problem (#1160)
    const invalidChronoDates =
      'BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:invalid\nDTEND:invalid\nEND:VEVENT';
    expect(EventContract.validate?.(invalidChronoDates)).toEqual(['EVENT_INVALID_DATE_VIOLATION']);
  });

  it('rejects various obfuscated and embedded malicious protocol payloads in location and description', () => {
    // 1. Double-URL encoded javascript payload
    const rawDoubleEncoded =
      'BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20260501T183000\nLOCATION:%25%36%61%25%36%31%25%37%36%25%36%31%25%37%33%25%36%33%25%37%32%25%36%39%25%37%30%25%37%34%3Aalert(1)\nEND:VEVENT';
    expect(EventContract.validate?.(rawDoubleEncoded)).toEqual(['URI_INJECTION_VIOLATION']);

    // 2. JavaScript payload embedded inside markdown link
    const rawMarkdown =
      'BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20260501T183000\nDESCRIPTION:Join the meeting [here](javascript:alert(1))\nEND:VEVENT';
    expect(EventContract.validate?.(rawMarkdown)).toEqual(['URI_INJECTION_VIOLATION']);

    // 3. HTML tag with dangerous data scheme URL
    const rawHtml =
      'BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20260501T183000\nLOCATION:<a href="data:text/html,evil">Click</a>\nEND:VEVENT';
    expect(EventContract.validate?.(rawHtml)).toEqual(['URI_INJECTION_VIOLATION']);

    // 4. Multiple levels of HTML entities & URL encoding
    const rawHtmlEntityEncoded =
      'BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20260501T183000\nDESCRIPTION:&#x6a;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;:alert(1)\nEND:VEVENT';
    expect(EventContract.validate?.(rawHtmlEntityEncoded)).toEqual(['URI_INJECTION_VIOLATION']);

    // 5. Control/Invisible character obfuscation within javascript protocol
    const rawControlChar =
      'BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20260501T183000\nLOCATION:java\u200Bscript:alert(1)\nEND:VEVENT';
    expect(EventContract.validate?.(rawControlChar)).toEqual(['URI_INJECTION_VIOLATION']);

    // 6. Safe text containing colons but no dangerous URLs should pass
    const rawSafeColons =
      'BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20260501T183000\nLOCATION:Room: 404, Building: B, Time: 2 PM\nDESCRIPTION:Visit us: http://example.com/map\nEND:VEVENT';
    expect(EventContract.validate?.(rawSafeColons)).toEqual([]);
  });

  it('constructs event with regional timezone parameters (TZID)', () => {
    const dataWithTzid = {
      title: 'Meeting',
      startDate: '2025-01-01T12:30;TZID=America/New_York',
      endDate: '2025-01-01T13:30;TZID=America/New_York',
      location: 'Room 1',
      description: 'Important meeting',
    };
    const str = constructEventString(dataWithTzid);
    // A TZID needs a VTIMEZONE block, so zoned times are written in UTC (#1281)
    expect(str).not.toContain('TZID=');
    expect(str).toContain('X-WR-TIMEZONE:America/New_York');
    expect(str).toContain('DTSTART:20250101T173000Z');
    expect(str).toContain('DTEND:20250101T183000Z');
  });

  describe('Timezone selection', () => {
    it('constructs and hydrates event with explicit regional timezone property', () => {
      const data = {
        title: 'Team Sync',
        startDate: '2025-06-15T09:00',
        endDate: '2025-06-15T10:00',
        timezone: 'America/New_York',
        location: 'Conference Room A',
        description: 'Quarterly review',
      };
      const str = constructEventString(data);
      expect(str).toContain('X-WR-TIMEZONE:America/New_York');
      expect(str).toContain('DTSTART:20250615T130000Z');
      expect(str).toContain('DTEND:20250615T140000Z');

      const hydrated = hydrateEventData(str);
      expect(hydrated).toEqual(data);
    });

    it('constructs and hydrates event with explicit UTC timezone property', () => {
      const data = {
        title: 'Global All-Hands',
        startDate: '2025-06-15T14:00',
        endDate: '2025-06-15T15:00',
        timezone: 'UTC',
        location: 'Online',
        description: 'Company updates',
      };
      const str = constructEventString(data);
      expect(str).toContain('DTSTART:20250615T140000Z');
      expect(str).toContain('DTEND:20250615T150000Z');
      expect(str).not.toContain('TZID=');

      const hydrated = hydrateEventData(str);
      expect(hydrated).toEqual(data);
    });

    it('updates UID hash when timezone is changed', () => {
      const baseData = {
        title: 'Conference',
        startDate: '2025-09-01T09:00',
        endDate: '2025-09-01T17:00',
        location: 'Convention Center',
        description: 'Tech summit',
      };

      const strNoTz = constructEventString(baseData, { now: new Date('2025-01-01T00:00:00Z') });
      const strNy = constructEventString({ ...baseData, timezone: 'America/New_York' }, { now: new Date('2025-01-01T00:00:00Z') });
      const strTokyo = constructEventString({ ...baseData, timezone: 'Asia/Tokyo' }, { now: new Date('2025-01-01T00:00:00Z') });

      const extractUid = (payload: string) => payload.match(/UID:(.+)/)?.[1];

      const uidNoTz = extractUid(strNoTz);
      const uidNy = extractUid(strNy);
      const uidTokyo = extractUid(strTokyo);

      expect(uidNoTz).toBeDefined();
      expect(uidNy).toBeDefined();
      expect(uidTokyo).toBeDefined();

      expect(uidNy).not.toBe(uidNoTz);
      expect(uidTokyo).not.toBe(uidNy);

      // Same timezone yields identical UID
      const strNyRepeat = constructEventString({ ...baseData, timezone: 'America/New_York' }, { now: new Date('2025-01-01T00:00:00Z') });
      expect(extractUid(strNyRepeat)).toBe(uidNy);
    });
  });

  describe('Web calendar providers', () => {
    it('constructs and hydrates Google Calendar URLs', () => {
      const data = {
        title: 'Launch Party',
        startDate: '2026-10-15T10:00',
        endDate: '2026-10-15T12:00',
        location: 'San Francisco, CA',
        description: 'Launch event details',
        provider: CalendarProvider.GOOGLE,
      };
      const url = constructEventString(data);
      expect(url).toContain('https://calendar.google.com/calendar/render?');
      expect(url).toContain('action=TEMPLATE');
      expect(url).toContain('text=Launch+Party');
      expect(url).toContain('dates=20261015T100000');
      expect(url).toContain('location=San+Francisco%2C+CA');
      expect(url).toContain('details=Launch+event+details');

      const hydrated = hydrateEventData(url);
      expect(hydrated).toEqual(data);
    });

    it('constructs and hydrates Outlook Web URLs', () => {
      const data = {
        title: 'Weekly Sync',
        startDate: '2026-10-15T10:00',
        endDate: '2026-10-15T11:00',
        location: 'Conference Room B',
        description: 'Team update',
        provider: CalendarProvider.OUTLOOK,
      };
      const url = constructEventString(data);
      expect(url).toContain('https://outlook.live.com/calendar/0/deeplink/compose?');
      expect(url).toContain('rru=addevent');
      expect(url).toContain('subject=Weekly+Sync');
      expect(url).toContain('startdt=2026-10-15T10%3A00%3A00');
      expect(url).toContain('enddt=2026-10-15T11%3A00%3A00');
      expect(url).toContain('body=Team+update');

      const hydrated = hydrateEventData(url);
      expect(hydrated).toEqual(data);
    });

    it('constructs and hydrates Office 365 URLs', () => {
      const data = {
        title: 'Board Meeting',
        startDate: '2026-10-15T09:00',
        endDate: '2026-10-15T10:00',
        location: 'Executive Suite',
        description: 'Q3 Financials',
        provider: CalendarProvider.OFFICE365,
      };
      const url = constructEventString(data);
      expect(url).toContain('https://outlook.office.com/calendar/0/deeplink/compose?');
      expect(url).toContain('subject=Board+Meeting');

      const hydrated = hydrateEventData(url);
      expect(hydrated).toEqual(data);
    });

    it('constructs and hydrates Yahoo Calendar URLs', () => {
      const data = {
        title: 'Tech Webinar',
        startDate: '2026-10-15T14:00',
        endDate: '2026-10-15T15:00',
        location: 'Online',
        description: 'Live QA Session',
        provider: CalendarProvider.YAHOO,
      };
      const url = constructEventString(data);
      expect(url).toContain('https://calendar.yahoo.com/?');
      expect(url).toContain('v=60');
      expect(url).toContain('TITLE=Tech+Webinar');
      expect(url).toContain('ST=20261015T140000');
      expect(url).toContain('ET=20261015T150000');
      expect(url).toContain('in_loc=Online');
      expect(url).toContain('DESC=Live+QA+Session');

      const hydrated = hydrateEventData(url);
      expect(hydrated).toEqual(data);
    });

    it('handles missing end dates across provider parameters', () => {
      const baseData = {
        title: 'All-day Keynote',
        startDate: '2026-10-15T10:00',
        endDate: '',
        location: 'Auditorium',
        description: 'Keynote presentation',
      };

      const googleUrl = constructEventString({ ...baseData, provider: CalendarProvider.GOOGLE });
      expect(googleUrl).toContain('dates=20261015T100000%2F20261015T100000');

      const outlookUrl = constructEventString({ ...baseData, provider: CalendarProvider.OUTLOOK });
      expect(outlookUrl).toContain('startdt=2026-10-15T10%3A00%3A00');
      expect(outlookUrl).toContain('enddt=2026-10-15T10%3A00%3A00');

      const officeUrl = constructEventString({ ...baseData, provider: CalendarProvider.OFFICE365 });
      expect(officeUrl).toContain('startdt=2026-10-15T10%3A00%3A00');
      expect(officeUrl).toContain('enddt=2026-10-15T10%3A00%3A00');

      const yahooUrl = constructEventString({ ...baseData, provider: CalendarProvider.YAHOO });
      expect(yahooUrl).toContain('ST=20261015T100000');
      expect(yahooUrl).toContain('ET=20261015T100000');
    });

    it('safely falls back to iCal if an invalid provider string arrives', () => {
      const data = {
        title: 'Fallback Test',
        startDate: '2026-10-15T10:00',
        endDate: '2026-10-15T12:00',
        location: 'Main Hall',
        description: 'Testing invalid provider fallback',
        provider: 'invalid-provider-name',
      };

      const payload = constructEventString(data);
      expect(payload).toContain('BEGIN:VCALENDAR');
      expect(payload).toContain('BEGIN:VEVENT');
      expect(payload).toContain('SUMMARY:Fallback Test');
      expect(payload).not.toContain('https://');
    });

    it('identifies web calendar URLs as QRType.EVENT via identifyProtocol and EventContract.matches', () => {
      const googleUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Party&dates=20261015T100000/20261015T120000';
      const outlookUrl = 'https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=Sync';
      const officeUrl = 'https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=Sync';
      const yahooUrl = 'https://calendar.yahoo.com/?v=60&TITLE=Webinar&ST=20261015T140000';

      expect(identifyProtocol(googleUrl)).toBe(QRType.EVENT);
      expect(identifyProtocol(outlookUrl)).toBe(QRType.EVENT);
      expect(identifyProtocol(officeUrl)).toBe(QRType.EVENT);
      expect(identifyProtocol(yahooUrl)).toBe(QRType.EVENT);

      expect(EventContract.matches(googleUrl)).toBe(true);
      expect(EventContract.matches(outlookUrl)).toBe(true);
      expect(EventContract.matches(officeUrl)).toBe(true);
      expect(EventContract.matches(yahooUrl)).toBe(true);
    });

    it('validates web calendar URLs correctly via EventContract.validate', () => {
      const googleUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Party&dates=20261015T100000/20261015T120000&location=Main+Hall&details=Fun+time';
      expect(EventContract.validate?.(googleUrl)).toEqual([]);

      const dangerousGoogleUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Party&dates=20261015T100000/20261015T120000&location=javascript:alert(1)';
      expect(EventContract.validate?.(dangerousGoogleUrl)).toEqual(['URI_INJECTION_VIOLATION']);
    });
  });
});
