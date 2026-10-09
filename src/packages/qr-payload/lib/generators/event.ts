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
import { identifyProtocol, parseProtocol } from '../protocol';
import {
  escapeVCardEvent,
  unescapeVCardEvent,
  foldString,
  formatEventDateTime,
  parseEventDateTime,
  parseRFCProperties,
} from '../rfcHelper';

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
  if (parsed && (parsed.scheme === 'http' || parsed.scheme === 'https')) {
    const domain = parsed.path.split('/')[0].toLowerCase().replace(/^www\./, '');
    const isDomain = (d: string) => domain === d || domain.endsWith(`.${d}`);

    if (
      isDomain('calendar.google.com') ||
      (isDomain('google.com') && parsed.path.includes('/calendar/'))
    ) {
      result.provider = CalendarProvider.GOOGLE;
      result.title = parsed.params.get('text') || '';
      const dates = parsed.params.get('dates');
      if (dates) {
        const parts = dates.split('/');
        result.startDate = parseEventDateTime(parts[0] || '').replace(/Z$/i, '');
        result.endDate = parseEventDateTime(parts[1] || '').replace(/Z$/i, '');
      }
      if (parsed.params.get('ctz')) {
        result.timezone = parsed.params.get('ctz')!;
      }
      result.location = parsed.params.get('location') || '';
      result.description = parsed.params.get('details') || '';
      return result;
    }

    if (isDomain('outlook.live.com')) {
      result.provider = CalendarProvider.OUTLOOK;
      result.title = parsed.params.get('subject') || '';
      result.startDate = parseEventDateTime(parsed.params.get('startdt') || '').replace(/Z$/i, '');
      result.endDate = parseEventDateTime(parsed.params.get('enddt') || '').replace(/Z$/i, '');
      if (parsed.params.get('ctz')) {
        result.timezone = parsed.params.get('ctz')!;
      }
      result.location = parsed.params.get('location') || '';
      result.description = parsed.params.get('body') || '';
      return result;
    }

    if (isDomain('outlook.office.com') || isDomain('outlook.office365.com')) {
      result.provider = CalendarProvider.OFFICE365;
      result.title = parsed.params.get('subject') || '';
      result.startDate = parseEventDateTime(parsed.params.get('startdt') || '').replace(/Z$/i, '');
      result.endDate = parseEventDateTime(parsed.params.get('enddt') || '').replace(/Z$/i, '');
      if (parsed.params.get('ctz')) {
        result.timezone = parsed.params.get('ctz')!;
      }
      result.location = parsed.params.get('location') || '';
      result.description = parsed.params.get('body') || '';
      return result;
    }

    if (isDomain('calendar.yahoo.com')) {
      result.provider = CalendarProvider.YAHOO;
      result.title = parsed.params.get('TITLE') || parsed.params.get('title') || '';
      result.startDate = parseEventDateTime(parsed.params.get('ST') || parsed.params.get('st') || '').replace(/Z$/i, '');
      result.endDate = parseEventDateTime(parsed.params.get('ET') || parsed.params.get('et') || '').replace(/Z$/i, '');
      result.location = parsed.params.get('in_loc') || parsed.params.get('location') || '';
      result.description = parsed.params.get('DESC') || parsed.params.get('desc') || '';
      return result;
    }
  }

  if (!/begin:v(event|calendar)/i.test(trimmed)) return result;

  const properties = parseRFCProperties(trimmed);
  properties.forEach(({ key, value, params }) => {
    switch (key) {
      case 'SUMMARY':
        result.title = unescapeVCardEvent(value);
        break;
      case 'DTSTART': {
        const parsed = parseEventDateTime(value, params);
        result.startDate = parsed.replace(/;TZID=[^;:\s\n]+/i, '').replace(/Z$/i, '');
        if (params) {
          const tzidMatch = params.match(/;?TZID=([^;:\s\n]+)/i);
          if (tzidMatch) {
            result.timezone = tzidMatch[1];
          }
        }
        if (value.toUpperCase().endsWith('Z')) {
          result.timezone = 'UTC';
        }
        break;
      }
      case 'DTEND': {
        const parsed = parseEventDateTime(value, params);
        result.endDate = parsed.replace(/;TZID=[^;:\s\n]+/i, '').replace(/Z$/i, '');
        if (!result.timezone) {
          if (params) {
            const tzidMatch = params.match(/;?TZID=([^;:\s\n]+)/i);
            if (tzidMatch) {
              result.timezone = tzidMatch[1];
            }
          }
          if (value.toUpperCase().endsWith('Z')) {
            result.timezone = 'UTC';
          }
        }
        break;
      }
      case 'LOCATION':
        result.location = unescapeVCardEvent(value);
        break;
      case 'DESCRIPTION':
        result.description = unescapeVCardEvent(value);
        break;
    }
  });

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
  const key = [data.title, data.startDate, data.endDate, data.timezone, data.location, data.description]
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

  if (provider === CalendarProvider.OUTLOOK) {
    const params = new URLSearchParams();
    params.set('path', '/calendar/action/compose');
    params.set('rru', 'addevent');
    if (data.title) params.set('subject', data.title);
    if (startFormatted.value) params.set('startdt', startFormatted.value);
    if (effectiveEnd) params.set('enddt', effectiveEnd);
    if (data.timezone) params.set('ctz', data.timezone);
    if (data.location) params.set('location', data.location);
    if (data.description) params.set('body', data.description);
    return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
  }

  if (provider === CalendarProvider.OFFICE365) {
    const params = new URLSearchParams();
    params.set('path', '/calendar/action/compose');
    params.set('rru', 'addevent');
    if (data.title) params.set('subject', data.title);
    if (startFormatted.value) params.set('startdt', startFormatted.value);
    if (effectiveEnd) params.set('enddt', effectiveEnd);
    if (data.timezone) params.set('ctz', data.timezone);
    if (data.location) params.set('location', data.location);
    if (data.description) params.set('body', data.description);
    return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
  }

  if (provider === CalendarProvider.YAHOO) {
    const params = new URLSearchParams();
    params.set('v', '60');
    if (data.title) params.set('TITLE', data.title);
    if (startFormatted.value) params.set('ST', startFormatted.value);
    if (effectiveEnd) params.set('ET', effectiveEnd);
    if (data.description) params.set('DESC', data.description);
    if (data.location) params.set('in_loc', data.location);
    return `https://calendar.yahoo.com/?${params.toString()}`;
  }

  // Standard iCalendar VEVENT block for 'ical' or fallback for unrecognized provider
  const dtstartKey = startFormatted.tzid ? `DTSTART;TZID=${startFormatted.tzid}` : 'DTSTART';
  const dtendKey = endFormatted.tzid ? `DTEND;TZID=${endFormatted.tzid}` : 'DTEND';

  const optional = (key: string, value: string): string[] => (value ? [`${key}:${value}`] : []);

  const parts = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QRCraftly//EN',
    'BEGIN:VEVENT',
    `UID:${escapeVCardEvent(options.uid || deriveEventUid(data))}`,
    `DTSTAMP:${resolveStamp(options.now)}`,
    ...optional('SUMMARY', escapeVCardEvent(data.title)),
    ...optional(dtstartKey, startFormatted.value),
    ...optional(dtendKey, endFormatted.value),
    ...optional('LOCATION', escapeVCardEvent(data.location)),
    ...optional('DESCRIPTION', escapeVCardEvent(data.description)),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return foldString(parts.join('\n'));
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
