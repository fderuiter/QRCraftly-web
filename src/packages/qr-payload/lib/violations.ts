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

import { UNSUPPORTED_SCHEME_PREFIX } from '@/utils/security';

const VIOLATION_MESSAGES: Record<string, string> = {
  URI_INJECTION_VIOLATION: 'Unsafe URL scheme or malicious protocol detected.',
  URL_STRUCTURE_VIOLATION: 'Malformed URL structure.',
  EMAIL_STRUCTURE_VIOLATION: 'Invalid email address structure.',
  LATITUDE_OUT_OF_BOUNDS_VIOLATION: 'Latitude must remain between -90 and 90 degrees.',
  LONGITUDE_OUT_OF_BOUNDS_VIOLATION: 'Longitude must remain between -180 and 180 degrees.',
  EVENT_MISSING_SUMMARY: 'Event title/summary is required.',
  EVENT_MISSING_START: 'Event start date/time is required.',
  EVENT_CHRONOLOGICAL_VIOLATION: 'Event end date/time cannot be before start date/time.',
  EVENT_INVALID_DATE_VIOLATION: 'Event start or end date/time is not a valid date.',
  DELIMITER_VIOLATION:
    'Part of this email code is not encoded: a "?", "&" or ";" ends a field early, or it has a field other than To, Cc, Bcc, Subject and Body.',
  PAYMENT_AMOUNT_VIOLATION: 'The payment amount must be a plain number, within the decimal places its network allows.',
  SMS_PHONE_STRUCTURE_VIOLATION: 'SMS phone number contains invalid characters, letters, or line-breaks.',
};

/**
 * Turns a violation code from `validatePayload` / `validateConfig` into a sentence for the person
 * making the code. Unknown codes are returned unchanged (several validators already return prose).
 * @param code - A violation code or message.
 * @returns A plain-language message.
 */
export const describeViolation = (code: string): string => {
  if (code.startsWith(UNSUPPORTED_SCHEME_PREFIX)) {
    const scheme = code.slice(UNSUPPORTED_SCHEME_PREFIX.length);
    return `Links that start with "${scheme}:" can't be used in this code type. Use a web, email, phone or meeting link.`;
  }
  return VIOLATION_MESSAGES[code] ?? code;
};
