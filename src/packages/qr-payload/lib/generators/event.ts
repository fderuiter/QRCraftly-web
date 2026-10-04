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

import { EventData, QRType, QRGeneratorContract } from '@/types';
import { isDangerousUrl } from '@/utils/security';
import { SafeUrlPipeline } from '@/utils/url';
import { identifyProtocol } from '../protocol';
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

  if (!raw || typeof raw !== 'string' || !/begin:v(event|calendar)/i.test(raw)) return result;

  const properties = parseRFCProperties(raw);
  properties.forEach(({ key, value, params }) => {
    switch (key) {
      case 'SUMMARY':
        result.title = unescapeVCardEvent(value);
        break;
      case 'DTSTART':
        result.startDate = parseEventDateTime(value, params);
        break;
      case 'DTEND':
        result.endDate = parseEventDateTime(value, params);
        break;
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
  const key = [data.title, data.startDate, data.endDate, data.location, data.description]
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
  const startFormatted = formatEventDateTime(data.startDate);
  const endFormatted = formatEventDateTime(data.endDate);

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

    // Strip control characters to align with SafeUrlPipeline's treatment of control chars inside URLs.
    const cleanDesc = decodedDesc.replace(SafeUrlPipeline.REGEX_CONTROL_CHARS, '');
    const cleanLoc = decodedLoc.replace(SafeUrlPipeline.REGEX_CONTROL_CHARS, '');

    const extractUris = (text: string): string[] => {
      const uris: string[] = [];
      const tokens = text.split(/\s+/);

      for (const token of tokens) {
        if (!token) continue;

        let searchIndex = 0;
        while (true) {
          const colonIndex = token.indexOf(':', searchIndex);
          if (colonIndex === -1) break;

          let startOfScheme = colonIndex;
          while (startOfScheme > searchIndex) {
            const char = token[startOfScheme - 1];
            if (/[a-zA-Z0-9+.-]/.test(char)) {
              startOfScheme--;
            } else {
              break;
            }
          }

          if (startOfScheme < colonIndex && /[a-zA-Z]/.test(token[startOfScheme])) {
            const uri = token.substring(startOfScheme);
            uris.push(uri);
          }

          searchIndex = colonIndex + 1;
        }
      }
      return uris;
    };

    const urls = [...extractUris(cleanDesc), ...extractUris(cleanLoc)];

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
