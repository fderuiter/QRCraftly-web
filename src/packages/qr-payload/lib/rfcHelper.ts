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
}

/**
 * Formats an ISO datetime string (from datetime-local) into iCalendar local datetime.
 * Handles UTC indicators ('Z') and timezone offsets properly.
 * @param dateString - The raw ISO date-time string.
 * @returns Formatted value and timezone identifier (if present). The value is empty when the
 * string is not a date.
 */
export const formatEventDateTime = (dateString: string | undefined): FormattedDateTime => {
  if (!dateString) return { value: '' };

  let cleanDateString = dateString;
  let tzid: string | undefined;

  // Extract TZID parameter if present (e.g. "2025-01-01T12:30;TZID=America/New_York")
  const tzidMatch = cleanDateString.match(/;TZID=([^;:\s\n]+)/i);
  if (tzidMatch) {
    tzid = tzidMatch[1];
    cleanDateString = cleanDateString.replace(/;TZID=[^;:\s\n]+/i, '');
  }

  const hasUTCIndicator = cleanDateString.toUpperCase().endsWith('Z');
  const hasOffset = /[-+]\d{2}:?\d{2}$/.test(cleanDateString);

  const date = new Date(cleanDateString);
  if (Number.isNaN(date.getTime())) {
    // Never emit the raw string: it would reach DTSTART/DTEND unescaped, so a newline in it
    // could add properties to the event (#1160). `EventContract.validate` reports the bad date.
    return { value: '' };
  }

  let formatted = '';
  if (hasUTCIndicator || hasOffset) {
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    formatted = `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  } else {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    formatted = `${year}${month}${day}T${hours}${minutes}${seconds}`;
  }

  return { value: formatted, tzid };
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
    const key = fullKey.split(';')[0].toUpperCase();
    const value = line.substring(splitIndex + 1);
    const params = fullKey.substring(key.length);

    properties.push({ key, value, params });
  }

  return properties;
}
