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

const REGEX_ESCAPE_VCARD = /([;,])/g;
const REGEX_UNESCAPE_VCARD = /\\([\\;,nN])/g;

/**
 * Escapes special characters and formats newlines for vCard and VEvent properties.
 * @param str - The raw field value string, which can be undefined.
 * @returns The escaped vCard/VEvent property string.
 */
export const escapeVCardEvent = (str: string | undefined): string => {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(REGEX_ESCAPE_VCARD, '\\$1');
};

/**
 * Unescapes formatting and special characters in vCard or VEvent fields.
 * @param str - The escaped vCard/VEvent property string, which can be undefined.
 * @returns The restored raw field value string.
 */
export const unescapeVCardEvent = (str: string | undefined): string => {
  if (!str) return '';
  // One left-to-right scan: every escape sequence is consumed exactly once, so an escaped
  // backslash followed by `n` (e.g. `dir\\new`) is not misread as a newline.
  return str.replace(REGEX_UNESCAPE_VCARD, (_match, ch: string) =>
    ch === 'n' || ch === 'N' ? '\n' : ch
  );
};

const encoder = new TextEncoder();

/**
 * Folds long lines to a safe maximum length (typically 75 octets) per RFC 5545 / RFC 6350.
 * Long lines are folded by inserting a carriage return-line feed (CRLF) sequence immediately followed by a single space.
 * @param str - The unfolded string payload.
 * @param maxLength - The maximum octet length before folding (default 75).
 * @returns The folded string payload with standard CRLF line endings.
 */
export const foldString = (str: string, maxLength: number = 75): string => {
  if (!str) return '';
  const rawLines = str.split(/\r\n|\n|\r/);
  const foldedLines: string[] = [];

  for (const line of rawLines) {
    if (encoder.encode(line).byteLength <= maxLength) {
      foldedLines.push(line);
      continue;
    }

    let currentLine = '';
    let currentBytes = 0;
    let isFirstChunk = true;

    for (const symbol of line) {
      const symbolBytes = encoder.encode(symbol).byteLength;
      const maxAllowed = isFirstChunk ? maxLength : Math.max(1, maxLength - 1);

      if (currentBytes + symbolBytes > maxAllowed) {
        if (currentLine.length > 0) {
          foldedLines.push(currentLine);
        }
        currentLine = ' ' + symbol;
        currentBytes = 1 + symbolBytes;
        isFirstChunk = false;
      } else {
        currentLine += symbol;
        currentBytes += symbolBytes;
      }
    }

    if (currentLine.length > 0) {
      foldedLines.push(currentLine);
    }
  }

  return foldedLines.join('\r\n');
};

/**
 * Unfolds folded lines (removing CRLF/LF/CR followed by a single space or tab) prior to parsing.
 * @param str - The folded string payload.
 * @returns The unfolded string payload.
 */
export const unfoldString = (str: string): string => {
  if (!str) return '';
  return str.replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, '');
};

/**
 * Splits a compound field by a delimiter (like ';'), correctly ignoring escaped delimiters.
 * Accurately handles cases where delimiters are preceded by escaped backslashes (counting backslashes to check if active).
 * @param str - The compound field string.
 * @param delimiter - The delimiter character (default ';').
 * @returns An array of parsed field components.
 */
export const splitCompoundField = (str: string, delimiter: string = ';'): string[] => {
  const parts: string[] = [];
  let current = '';
  let i = 0;
  while (i < str.length) {
    if (str.startsWith(delimiter, i)) {
      let backslashCount = 0;
      let j = i - 1;
      while (j >= 0 && str.charAt(j) === '\\') {
        backslashCount++;
        j--;
      }
      if (backslashCount % 2 === 0) {
        parts.push(current);
        current = '';
        i += delimiter.length;
        continue;
      }
    }
    current += str.charAt(i);
    i++;
  }
  parts.push(current);
  return parts;
};

export interface FormattedDateTime {
  value: string;
  tzid?: string;
  /** True when the value is an RFC 5545 DATE (an all-day event), not a DATE-TIME. */
  isDate?: boolean;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** True when the numbers name a real calendar date and clock time. */
const isRealDateTime = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): boolean => {
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d &&
    t.getUTCHours() === h && t.getUTCMinutes() === mi && t.getUTCSeconds() === s
  );
};

/** Formats an instant as an RFC 5545 UTC DATE-TIME (`20250101T120000Z`). */
const formatUtcDateTime = (date: Date): string =>
  `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Formats an ISO datetime string (from datetime-local) into iCalendar local datetime.
 * Handles UTC indicators ('Z') and timezone offsets properly. A date with no time
 * (`2025-12-25`) becomes an RFC 5545 DATE. A wall-clock time with no offset is reformatted
 * digit for digit, never through the browser's time zone, so a time in the browser's DST gap
 * does not move (#1281).
 * @param dateString - The raw ISO date-time string.
 * @returns Formatted value and timezone identifier (if present). The value is empty when the
 * string is not a date.
 */
export const formatEventDateTime = (
  dateString: string | undefined,
  timezone?: string
): FormattedDateTime => {
  if (!dateString) return { value: '' };

  let cleanDateString = dateString.trim();
  let tzid: string | undefined = timezone;

  // Extract TZID parameter if present (e.g. "2025-01-01T12:30;TZID=America/New_York")
  const tzidMatch = cleanDateString.match(/;TZID=([^;:\s\n]+)/i);
  if (tzidMatch) {
    if (!tzid) tzid = tzidMatch[1];
    cleanDateString = cleanDateString.replace(/;TZID=[^;:\s\n]+/i, '');
  }

  const dateOnly = DATE_ONLY.exec(cleanDateString);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    if (!isRealDateTime(Number(y), Number(mo), Number(d))) return { value: '' };
    return { value: `${y}${mo}${d}`, isDate: true };
  }

  const isExplicitUtc = tzid === 'UTC';
  const wall = WALL_CLOCK.exec(cleanDateString);
  if (wall) {
    const [, y, mo, d, h, mi, sec = '00'] = wall;
    if (!isRealDateTime(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(sec))) {
      return { value: '' };
    }
    const value = `${y}${mo}${d}T${h}${mi}${sec}`;
    return isExplicitUtc ? { value: `${value}Z` } : { value, tzid };
  }

  const hasOffset = /(?:Z|[-+]\d{2}:?\d{2})$/i.test(cleanDateString);
  const date = new Date(cleanDateString);
  if (!hasOffset || Number.isNaN(date.getTime())) {
    // Never emit the raw string: it would reach DTSTART/DTEND unescaped, so a newline in it
    // could add properties to the event (#1160). `EventContract.validate` reports the bad date.
    return { value: '' };
  }

  return { value: formatUtcDateTime(date) };
};

/** The wall-clock fields of an instant in an IANA time zone. Throws on an unknown zone. */
const wallClockParts = (instant: number, timeZone: string): number[] => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return [get('year'), get('month'), get('day'), get('hour'), get('minute'), get('second')];
};

/** How far a zone's wall clock is ahead of UTC at an instant, in milliseconds. */
const zoneOffset = (instant: number, timeZone: string): number => {
  const [y, mo, d, h, mi, s] = wallClockParts(instant, timeZone);
  return Date.UTC(y, mo - 1, d, h, mi, s) - instant;
};

/**
 * Converts a wall-clock DATE-TIME in an IANA zone to UTC, so an event can be written without a
 * VTIMEZONE block (RFC 5545 §3.2.19 requires one for every TZID).
 * @param value - A floating DATE-TIME such as `20250310T090000`.
 * @param timeZone - The IANA zone, such as `America/New_York`.
 * @returns The UTC DATE-TIME (`20250310T130000Z`), or `null` for an unknown zone.
 */
export const wallClockToUtc = (value: string, timeZone: string): string | null => {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    // Two passes settle the offset on the far side of a DST change.
    const first = wall - zoneOffset(wall, timeZone);
    return formatUtcDateTime(new Date(wall - zoneOffset(first, timeZone)));
  } catch {
    return null;
  }
};

/**
 * Shows a UTC DATE-TIME as wall-clock time in an IANA zone, for a datetime-local field.
 * @param value - A UTC DATE-TIME such as `20250310T130000Z`.
 * @param timeZone - The IANA zone.
 * @returns `YYYY-MM-DDTHH:MM`, or `null` for an unknown zone or a value that is not UTC.
 */
export const utcToWallClock = (value: string, timeZone: string): string | null => {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i.exec(value);
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
  try {
    const [wy, wmo, wd, wh, wmi] = wallClockParts(Date.UTC(y, mo - 1, d, h, mi, s), timeZone);
    return `${wy}-${pad2(wmo)}-${pad2(wd)}T${pad2(wh)}:${pad2(wmi)}`;
  } catch {
    return null;
  }
};

/**
 * Moves an RFC 5545 DATE (`20251225`) by whole days. All-day DTEND is exclusive, so the form's
 * last day is one day before it.
 * @param value - The DATE value, or a `YYYY-MM-DD` date.
 * @param days - Days to add (negative to go back).
 * @returns The moved date as `YYYY-MM-DD`, or an empty string for a value that is not a date.
 */
export const shiftDate = (value: string, days: number): string => {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value);
  if (!match) return '';
  const t = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
};

/**
 * Parses an iCalendar DATE-TIME string into a standard ISO format, preserving UTC or TZID designations.
 * @param value - The raw DATE-TIME value (e.g., "20250101T123000Z" or "20250101T123000")
 * @param keyParams - Optional parameter prefix (e.g., ";TZID=America/New_York")
 * @returns A standard ISO-8601 string suitable for datetime-local input, preserving timezone indicators.
 */
export const parseEventDateTime = (value: string, keyParams?: string): string => {
  if (!value) return '';

  let tzid = '';
  if (keyParams) {
    const tzidMatch = keyParams.match(/;?TZID=([^;:\s\n]+)/i);
    if (tzidMatch) {
      tzid = tzidMatch[1];
    }
  }

  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) {
    return `${date[1]}-${date[2]}-${date[3]}`;
  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/i);
  if (match) {
    const [_, year, month, day, hours, minutes, _seconds, z] = match;
    const baseIso = `${year}-${month}-${day}T${hours}:${minutes}`;
    if (z) {
      return `${baseIso}Z`;
    }
    if (tzid) {
      return `${baseIso};TZID=${tzid}`;
    }
    return baseIso;
  }
  return value;
};

export interface RFCProperty {
  key: string;
  value: string;
  params: string;
}

export function parseRFCProperties(raw: string): RFCProperty[] {
  const unfolded = unfoldString(raw);
  const lines = unfolded.split(/\r\n|\n|\r/);
  const properties: RFCProperty[] = [];

  for (const line of lines) {
    const splitIndex = line.indexOf(':');
    if (splitIndex <= 0) continue;

    const fullKey = line.substring(0, splitIndex);
    const name = fullKey.split(';')[0];
    // Drop a property group (`item1.EMAIL`, as Apple Contacts writes it, RFC 6350 §3.3).
    const key = name.replace(/^[A-Za-z0-9-]+\./, '').toUpperCase();
    const value = line.substring(splitIndex + 1);
    const params = fullKey.substring(name.length);

    properties.push({ key, value, params });
  }

  return properties;
}
