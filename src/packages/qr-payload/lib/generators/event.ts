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

import { EventData, QRType, QRGeneratorContract, CalendarProvider } from '@/types';
import { isDangerousUrl } from '@/utils/security';
import { SafeUrlPipeline } from '@/utils/url';
import { calendarLinkProvider, identifyProtocol, parseProtocol } from '../protocol';
import {
  type FormattedDateTime,
  escapeVCardEvent,
  unescapeVCardEvent,
  foldString,
  formatEventDateTime,
  parseEventDateTime,
  parseRFCProperties,
  shiftDate,
  utcToWallClock,
  wallClockToUtc,
} from '../rfcHelper';

/** True for an 8-digit web-calendar date (`20251225`), which marks an all-day event. */
const isCompactDate = (value: string | undefined): boolean => /^\d{8}$/.test(value || '');

/**
 * Reads the start and end of an Outlook or Office 365 compose link. `allday=true` links carry
 * `YYYY-MM-DD` dates with an exclusive end.
 */
const hydrateOutlookDates = (params: Map<string, string>): Pick<EventData, 'startDate' | 'endDate' | 'allDay'> => {
  const start = params.get('startdt') || '';
  const end = params.get('enddt') || '';
  if (params.get('allday') === 'true' && /^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return { allDay: true, startDate: start, endDate: end ? shiftDate(end, -1) : '' };
  }
  const zone = params.get('ctz') || '';
  const read = (value: string): string => {
    const compact = value.replace(/[-:]/g, '');
    if (/Z$/i.test(compact) && zone && zone !== 'UTC') {
      const wall = utcToWallClock(compact, zone);
      if (wall) return wall;
    }
    return parseEventDateTime(compact).replace(/Z$/i, '');
  };
  return { startDate: read(start), endDate: read(end) };
};

/**
 * Hydrates EventData from a raw string.
 */
export const hydrateEventData = (raw: string): EventData => {
  const result: EventData = {
    title: '',
    startDate: '',
    endDate: '',
    location: '',
    description: '',
  };

  if (!raw || typeof raw !== 'string') return result;
  const trimmed = raw.trim();

  // Check if raw is a web calendar URL
  const parsed = parseProtocol(trimmed);
  const calendar = parsed ? calendarLinkProvider(parsed) : null;
  if (parsed && calendar) {
    if (calendar === CalendarProvider.GOOGLE) {
      result.provider = CalendarProvider.GOOGLE;
      result.title = parsed.params.get('text') || '';
      const dates = parsed.params.get('dates');
      if (dates) {
        const parts = dates.split('/');
        if (isCompactDate(parts[0])) {
          // Google all-day ranges end the day after the last day.
          result.allDay = true;
          result.startDate = parseEventDateTime(parts[0]);
          result.endDate = isCompactDate(parts[1]) ? shiftDate(parts[1], -1) : '';
        } else {
          result.startDate = parseEventDateTime(parts[0] || '').replace(/Z$/i, '');
          result.endDate = parseEventDateTime(parts[1] || '').replace(/Z$/i, '');
        }
      }
      if (parsed.params.get('ctz')) {
        result.timezone = parsed.params.get('ctz')!;
      }
      result.location = parsed.params.get('location') || '';
      result.description = parsed.params.get('details') || '';
      return result;
    }

    if (calendar === CalendarProvider.OUTLOOK) {
      result.provider = CalendarProvider.OUTLOOK;
      result.title = parsed.params.get('subject') || '';
      Object.assign(result, hydrateOutlookDates(parsed.params));
      if (parsed.params.get('ctz')) {
        result.timezone = parsed.params.get('ctz')!;
      }
      result.location = parsed.params.get('location') || '';
      result.description = parsed.params.get('body') || '';
      return result;
    }

    if (calendar === CalendarProvider.OFFICE365) {
      result.provider = CalendarProvider.OFFICE365;
      result.title = parsed.params.get('subject') || '';
      Object.assign(result, hydrateOutlookDates(parsed.params));
      if (parsed.params.get('ctz')) {
        result.timezone = parsed.params.get('ctz')!;
      }
      result.location = parsed.params.get('location') || '';
      result.description = parsed.params.get('body') || '';
      return result;
    }

    if (calendar === CalendarProvider.YAHOO) {
      result.provider = CalendarProvider.YAHOO;
      result.title = parsed.params.get('TITLE') || parsed.params.get('title') || '';
      const start = parsed.params.get('ST') || parsed.params.get('st') || '';
      const end = parsed.params.get('ET') || parsed.params.get('et') || '';
      if ((parsed.params.get('DUR') || parsed.params.get('dur')) === 'allday' && isCompactDate(start)) {
        result.allDay = true;
        result.startDate = parseEventDateTime(start);
        result.endDate = isCompactDate(end) ? shiftDate(end, -1) : '';
      } else {
        result.startDate = parseEventDateTime(start).replace(/Z$/i, '');
        result.endDate = parseEventDateTime(end).replace(/Z$/i, '');
        if (/Z$/i.test(start)) result.timezone = 'UTC';
      }
      result.location = parsed.params.get('in_loc') || parsed.params.get('location') || '';
      result.description = parsed.params.get('DESC') || parsed.params.get('desc') || '';
      return result;
    }
  }

  if (!/begin:v(event|calendar)/i.test(trimmed)) return result;

  const properties = parseRFCProperties(trimmed);
  let start: { value: string; params: string } | undefined;
  let end: { value: string; params: string } | undefined;
  let calendarZone = '';
  properties.forEach(({ key, value, params }) => {
    switch (key) {
      case 'SUMMARY':
        result.title = unescapeVCardEvent(value);
        break;
      case 'DTSTART':
        start = { value, params };
        break;
      case 'DTEND':
        end = { value, params };
        break;
      case 'X-WR-TIMEZONE':
        calendarZone = value.trim();
        break;
      case 'LOCATION':
        result.location = unescapeVCardEvent(value);
        break;
      case 'DESCRIPTION':
        result.description = unescapeVCardEvent(value);
        break;
    }
  });

  const tzidOf = (params: string): string => params.match(/;?TZID=([^;:\s\n]+)/i)?.[1] ?? '';

  if (start && (/VALUE=DATE(?!-)/i.test(start.params) || /^\d{8}$/.test(start.value))) {
    // An all-day event: DTEND is the day after the last day (RFC 5545 §3.6.1).
    result.allDay = true;
    result.startDate = parseEventDateTime(start.value);
    result.endDate = end && /^\d{8}$/.test(end.value) ? shiftDate(end.value, -1) : '';
    return result;
  }

  // A UTC time from a calendar that names its zone (as QRCraftly writes events) is shown in that
  // zone, so editing a scanned event keeps the zone the organiser chose.
  const readTime = (prop: { value: string; params: string } | undefined): string => {
    if (!prop) return '';
    if (/Z$/i.test(prop.value) && calendarZone && calendarZone !== 'UTC') {
      const wall = utcToWallClock(prop.value, calendarZone);
      if (wall) return wall;
    }
    return parseEventDateTime(prop.value, prop.params).replace(/;TZID=[^;:\s\n]+/i, '').replace(/Z$/i, '');
  };

  result.startDate = readTime(start);
  result.endDate = readTime(end);
  for (const prop of [start, end]) {
    if (!prop || result.timezone) continue;
    if (/Z$/i.test(prop.value)) {
      result.timezone = calendarZone && utcToWallClock(prop.value, calendarZone) ? calendarZone : 'UTC';
    } else if (tzidOf(prop.params)) {
      result.timezone = tzidOf(prop.params);
    }
  }

  return result;
};

/**
 * Options for {@link constructEventString}. Both are injectable so tests can pin the output.
 */
interface EventConstructOptions {
  /** Clock used for DTSTAMP. Defaults to the time the first event was built in this session. */
  now?: Date;
  /** Overrides the content-derived UID. */
  uid?: string;
}

/**
 * 32-bit FNV-1a hash of a string, as 8 lowercase hex digits.
 */
const fnv1a = (input: string, seed: number): string => {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/**
 * Builds a stable RFC 5545 UID from the event content, without any network or random source.
 * The same event always gets the same UID, so re-scanning updates the calendar entry
 * instead of duplicating it.
 */
const deriveEventUid = (data: EventData): string => {
  const key = [data.title, data.startDate, data.endDate, data.timezone, data.location, data.description, ...(data.allDay ? ['all-day'] : [])]
    .map((part) => part || '')
    .join('\u001f');
  return `${fnv1a(key, 0x811c9dc5)}${fnv1a(key, 0x01000193)}@qrcraftly.com`;
};

/**
 * Formats a Date as an RFC 5545 UTC DATE-TIME (e.g. 20250101T120000Z).
 */
const formatUtcStamp = (date: Date): string => {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};

// DTSTAMP is fixed for the session so that building the same event twice gives the
// same payload (the input panel compares constructed values to detect external edits).
let sessionStamp: string | undefined;

const resolveStamp = (now: Date | undefined): string => {
  if (now) return formatUtcStamp(now);
  if (!sessionStamp) sessionStamp = formatUtcStamp(new Date());
  return sessionStamp;
};

/**
 * Constructs an iCalendar VEVENT payload.
 * Includes the RFC 5545 required UID and DTSTAMP properties, and leaves out
 * properties whose value would be empty (some calendar apps reject `DTEND:`).
 */
export const constructEventString = (
  data: EventData,
  options: EventConstructOptions = {}
): string => {
  if (!data) return '';

  const provider = (data.provider || CalendarProvider.ICAL).toLowerCase();
  if (data.allDay) return constructAllDayEvent(data, provider, options);

  const startFormatted = formatEventDateTime(data.startDate, data.timezone);
  const endFormatted = formatEventDateTime(data.endDate, data.timezone);
  const effectiveEnd = endFormatted.value || startFormatted.value;

  if (provider === CalendarProvider.GOOGLE) {
    const params = new URLSearchParams();
    params.set('action', 'TEMPLATE');
    if (data.title) params.set('text', data.title);
    if (startFormatted.value) {
      params.set('dates', `${startFormatted.value}/${effectiveEnd}`);
    }
    if (data.timezone) params.set('ctz', data.timezone);
    if (data.location) params.set('location', data.location);
    if (data.description) params.set('details', data.description);
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  // Outlook documents extended ISO times; a zoned time is sent as UTC because Outlook has no
  // zone parameter (`ctz` is kept only so editing the scanned code restores the zone).
  if (provider === CalendarProvider.OUTLOOK || provider === CalendarProvider.OFFICE365) {
    const host = provider === CalendarProvider.OUTLOOK ? 'outlook.live.com' : 'outlook.office.com';
    const params = new URLSearchParams();
    params.set('path', '/calendar/action/compose');
    params.set('rru', 'addevent');
    if (data.title) params.set('subject', data.title);
    const startIso = toExtendedIso(toUtcValue(startFormatted));
    const endIso = toExtendedIso(toUtcValue(endFormatted)) || startIso;
    if (startIso) params.set('startdt', startIso);
    if (endIso) params.set('enddt', endIso);
    if (data.timezone) params.set('ctz', data.timezone);
    if (data.location) params.set('location', data.location);
    if (data.description) params.set('body', data.description);
    return `https://${host}/calendar/0/deeplink/compose?${params.toString()}`;
  }

  if (provider === CalendarProvider.YAHOO) {
    const params = new URLSearchParams();
    params.set('v', '60');
    if (data.title) params.set('TITLE', data.title);
    // Yahoo has no zone parameter, so a zoned time is sent as UTC.
    const yahooStart = toUtcValue(startFormatted);
    const yahooEnd = toUtcValue(endFormatted) || yahooStart;
    if (yahooStart) params.set('ST', yahooStart);
    if (yahooEnd) params.set('ET', yahooEnd);
    if (data.description) params.set('DESC', data.description);
    if (data.location) params.set('in_loc', data.location);
    return `https://calendar.yahoo.com/?${params.toString()}`;
  }

  // Standard iCalendar VEVENT block for 'ical' or fallback for unrecognized provider. A TZID
  // needs a VTIMEZONE block (RFC 5545 §3.2.19), so zoned times are written in UTC instead and the
  // zone is kept in X-WR-TIMEZONE for display and for editing the scanned code later.
  const zone = startFormatted.tzid || endFormatted.tzid;
  const startValue = toUtcValue(startFormatted);
  const endValue = toUtcValue(endFormatted);
  const zoneHeader = zone && startValue.endsWith('Z') ? [`X-WR-TIMEZONE:${zone}`] : [];

  return buildCalendar(data, options, zoneHeader, [
    ...optional('DTSTART', startValue),
    ...optional('DTEND', endValue),
  ]);
};

/** A zoned wall-clock time as UTC (`…Z`); floating and UTC times are returned as they are. */
const toUtcValue = (formatted: FormattedDateTime): string =>
  formatted.tzid ? (wallClockToUtc(formatted.value, formatted.tzid) ?? formatted.value) : formatted.value;

/** `20261015T100000Z` as `2026-10-15T10:00:00Z`. */
const toExtendedIso = (value: string): string =>
  value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');

const optional = (key: string, value: string): string[] => (value ? [`${key}:${value}`] : []);

/** Wraps event properties in a VCALENDAR with the required UID and DTSTAMP. */
const buildCalendar = (
  data: EventData,
  options: EventConstructOptions,
  calendarHeaders: string[],
  dates: string[]
): string => {
  const parts = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QRCraftly//EN',
    ...calendarHeaders,
    'BEGIN:VEVENT',
    `UID:${escapeVCardEvent(options.uid || deriveEventUid(data))}`,
    `DTSTAMP:${resolveStamp(options.now)}`,
    ...optional('SUMMARY', escapeVCardEvent(data.title)),
    ...dates,
    ...optional('LOCATION', escapeVCardEvent(data.location)),
    ...optional('DESCRIPTION', escapeVCardEvent(data.description)),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return foldString(parts.join('\n'));
};

/**
 * Builds an all-day event. Dates are written as DATE values with an exclusive end (the day after
 * the last day), as RFC 5545 and the web calendars expect.
 */
const constructAllDayEvent = (data: EventData, provider: string, options: EventConstructOptions): string => {
  const start = formatEventDateTime(data.startDate);
  const last = formatEventDateTime(data.endDate);
  const startDate = start.isDate ? data.startDate.trim() : '';
  const endDate = last.isDate ? shiftDate(data.endDate.trim(), 1) : '';
  const compact = (iso: string): string => iso.replace(/-/g, '');

  if (provider === CalendarProvider.GOOGLE) {
    const params = new URLSearchParams();
    params.set('action', 'TEMPLATE');
    if (data.title) params.set('text', data.title);
    if (startDate) params.set('dates', `${compact(startDate)}/${compact(endDate || shiftDate(startDate, 1))}`);
    if (data.location) params.set('location', data.location);
    if (data.description) params.set('details', data.description);
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  if (provider === CalendarProvider.OUTLOOK || provider === CalendarProvider.OFFICE365) {
    const host = provider === CalendarProvider.OUTLOOK ? 'outlook.live.com' : 'outlook.office.com';
    const params = new URLSearchParams();
    params.set('path', '/calendar/action/compose');
    params.set('rru', 'addevent');
    if (data.title) params.set('subject', data.title);
    if (startDate) params.set('startdt', startDate);
    if (startDate) params.set('enddt', endDate || shiftDate(startDate, 1));
    params.set('allday', 'true');
    if (data.location) params.set('location', data.location);
    if (data.description) params.set('body', data.description);
    return `https://${host}/calendar/0/deeplink/compose?${params.toString()}`;
  }

  if (provider === CalendarProvider.YAHOO) {
    const params = new URLSearchParams();
    params.set('v', '60');
    if (data.title) params.set('TITLE', data.title);
    if (startDate) params.set('ST', compact(startDate));
    if (endDate) params.set('ET', compact(endDate));
    params.set('DUR', 'allday');
    if (data.description) params.set('DESC', data.description);
    if (data.location) params.set('in_loc', data.location);
    return `https://calendar.yahoo.com/?${params.toString()}`;
  }

  return buildCalendar(data, options, [], [
    ...optional('DTSTART;VALUE=DATE', compact(startDate)),
    ...optional('DTEND;VALUE=DATE', compact(endDate)),
  ]);
};

export const EventContract: QRGeneratorContract<EventData> = {
  type: QRType.EVENT,
  construct: constructEventString,
  hydrate: hydrateEventData,
  matches: (raw: string) => identifyProtocol(raw) === QRType.EVENT,
  validate: (raw: string) => {
    const violations: string[] = [];
    const data = hydrateEventData(raw);

    // 1. Check for URI Injection Violations using isDangerousUrl
    // Decode characters up to ten levels deep first to ensure obfuscated protocols are caught.
    const decodedDesc = SafeUrlPipeline.decodeObfuscation(data.description || '');
    const decodedLoc = SafeUrlPipeline.decodeObfuscation(data.location || '');

    // Line breaks separate words; other control characters are dropped, as a URL parser does.
    const clean = (text: string) =>
      text.replace(/[\r\n]+/g, ' ').replace(SafeUrlPipeline.REGEX_CONTROL_CHARS, '');

    // Every scheme-like word, with the rest of the text after it, so `isDangerousUrl` sees what
    // follows the colon ("About: us" is prose, "javascript: alert(1)" is not). A colon inside
    // an http(s) link's path ("/wiki/File:Map.png") is part of that link, not a new scheme (#1274).
    const extractUris = (text: string): string[] => {
      const uris: string[] = [];
      const schemePattern = /[a-zA-Z][a-zA-Z0-9+.-]*:/g;
      let insideLinkUntil = -1;
      for (const match of text.matchAll(schemePattern)) {
        const start = match.index;
        if (start < insideLinkUntil) continue;
        const rest = text.slice(start);
        if (/^https?:\/\//i.test(rest)) {
          const end = rest.search(/\s/);
          insideLinkUntil = end === -1 ? text.length : start + end;
          continue;
        }
        uris.push(rest);
      }
      return uris;
    };

    const urls = [...extractUris(clean(decodedDesc)), ...extractUris(clean(decodedLoc))];

    for (const u of urls) {
      if (isDangerousUrl(u)) {
        violations.push('URI_INJECTION_VIOLATION');
        break;
      }
    }

    // 2. Check for Missing Fields (EVENT_MISSING_SUMMARY, EVENT_MISSING_START)
    if (!data.title || !data.title.trim()) {
      violations.push('EVENT_MISSING_SUMMARY');
    }
    if (!data.startDate || !data.startDate.trim()) {
      violations.push('EVENT_MISSING_START');
    }

    // 2b. Dates that do not parse are rejected rather than written into DTSTART/DTEND (#1160)
    const unreadable = [data.startDate, data.endDate].some(
      (value) => value && value.trim() && formatEventDateTime(value).value === ''
    );
    if (unreadable) {
      violations.push('EVENT_INVALID_DATE_VIOLATION');
    }

    // 3. Check for Chronological Consistency (EVENT_CHRONOLOGICAL_VIOLATION)
    if (data.startDate && data.endDate) {
      const cleanStart = data.startDate.replace(/;TZID=[^;:\s\n]+/i, '');
      const cleanEnd = data.endDate.replace(/;TZID=[^;:\s\n]+/i, '');
      const startSecs = new Date(cleanStart).getTime();
      const endSecs = new Date(cleanEnd).getTime();
      if (!Number.isNaN(startSecs) && !Number.isNaN(endSecs)) {
        if (endSecs < startSecs) {
          violations.push('EVENT_CHRONOLOGICAL_VIOLATION');
        }
      }
    }

    return violations;
  },
};
