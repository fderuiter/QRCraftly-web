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

import { EmailData, QRType, QRGeneratorContract } from '@/types';
import {
  CONTAINMENT_PROFILES,
  identifyProtocol,
  parseProtocol,
  safeDecodeURIComponent,
  splitByUnescapedSemicolons,
} from '../protocol';

/**
 * Percent-encodes a mailto recipient (RFC 6068) so that `?`, `&`, `#`, `%` and
 * whitespace in the address cannot start a query, inject a header or open a
 * fragment. `@` and `+` are left as-is because RFC 6068 allows them unencoded.
 * @param address - The raw recipient address.
 * @returns The encoded recipient for the mailto path.
 */
const encodeMailtoRecipient = (address: string): string => {
  return address
    .split(',')
    .map((recipient) => recipient.trim())
    .filter(Boolean)
    .map((recipient) => encodeURIComponent(recipient).replace(/%40/g, '@').replace(/%2B/gi, '+'))
    .join(',');
};

/** RFC 6068 §5: line breaks in a mailto body are written as CRLF (`%0D%0A`). */
const toCrlf = (text: string): string => text.replace(/\r\n|\r|\n/g, '\r\n');

/** Mail headers QRCraftly writes or reads; anything else in a mailto query is refused. */
const MAILTO_HEADERS = new Set(['to', 'cc', 'bcc', 'subject', 'body']);

/**
 * Constructs the mailto string for Email QR code.
 */
export const constructEmailString = (data: EmailData): string => {
  if (!data) return 'mailto:?subject=&body=';

  const params: string[] = [];

  const cc = data.cc?.trim();
  if (cc) {
    params.push(`cc=${encodeURIComponent(cc)}`);
  }

  const bcc = data.bcc?.trim();
  if (bcc) {
    params.push(`bcc=${encodeURIComponent(bcc)}`);
  }

  params.push(`subject=${encodeURIComponent(data.subject || '')}`);
  params.push(`body=${encodeURIComponent(toCrlf(data.body || ''))}`);

  return `mailto:${encodeMailtoRecipient(data.email || '')}?${params.join('&')}`;
};

/**
 * Hydrates EmailData from a raw string.
 */
export const hydrateEmailData = (raw: string): EmailData => {
  const result: EmailData = {
    email: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
  };

  const parsed = parseProtocol(raw);
  if (!parsed) return result;

  if (parsed.scheme === 'matmsg') {
    result.email = parsed.path;
    result.subject = parsed.params.get('SUB') || '';
    result.body = parsed.params.get('BODY') || '';
    return result;
  }

  if (parsed.scheme === 'mailto') {
    // Header names are case-insensitive and `to=` adds recipients (RFC 6068 §2), so both are
    // folded into the To field.
    result.email = [safeDecodeURIComponent(parsed.path), parsed.params.get('to') || '']
      .flatMap((list) => list.split(','))
      .map((recipient) => recipient.trim())
      .filter(Boolean)
      .join(',');
    result.cc = parsed.params.get('cc') || '';
    result.bcc = parsed.params.get('bcc') || '';
    result.subject = parsed.params.get('subject') || '';
    result.body = (parsed.params.get('body') || '').replace(/\r\n?/g, '\n');
  }

  return result;
};

export const EmailContract: QRGeneratorContract<EmailData> = {
  type: QRType.EMAIL,
  construct: constructEmailString,
  hydrate: hydrateEmailData,
  matches: (raw: string) => identifyProtocol(raw) === QRType.EMAIL,
  validate: (raw: string) => {
    const violations: string[] = [];
    const trimmed = raw.trim();
    if (!trimmed) {
      violations.push('EMAIL_STRUCTURE_VIOLATION');
      return violations;
    }

    const parsed = parseProtocol(trimmed);
    if (!parsed) {
      // Fallback for raw email addresses
      if (!CONTAINMENT_PROFILES.EMAIL.test(trimmed)) {
        violations.push('EMAIL_STRUCTURE_VIOLATION');
      }
      return violations;
    }

    // Check scheme validity
    if (parsed.scheme !== 'mailto' && parsed.scheme !== 'matmsg') {
      violations.push('EMAIL_STRUCTURE_VIOLATION');
      return violations;
    }

    // Validate email address (mailto recipients are percent-encoded, RFC 6068)
    const recipients =
      parsed.scheme === 'mailto' ? hydrateEmailData(trimmed).email.split(',') : [parsed.path];
    if (!recipients.some(Boolean) || recipients.some((recipient) => !CONTAINMENT_PROFILES.EMAIL.test(recipient))) {
      violations.push('EMAIL_STRUCTURE_VIOLATION');
    }
    if (parsed.scheme === 'mailto') {
      const { cc, bcc } = hydrateEmailData(trimmed);
      const copies = [cc, bcc].flatMap((list) => (list || '').split(',')).map((address) => address.trim()).filter(Boolean);
      if (copies.some((address) => !CONTAINMENT_PROFILES.EMAIL.test(address))) {
        violations.push('EMAIL_STRUCTURE_VIOLATION');
      }
    }

    // Deep metadata delimiter validation
    if (parsed.scheme === 'matmsg') {
      const content = trimmed.substring(7);
      const segments = splitByUnescapedSemicolons(content);
      while (segments.length > 0 && segments[segments.length - 1].trim() === '') {
        segments.pop();
      }

      const KNOWN_KEYS = new Set(['TO', 'SUB', 'BODY']);
      for (const segment of segments) {
        const colonIndex = segment.indexOf(':');
        if (colonIndex <= 0) {
          violations.push('DELIMITER_VIOLATION');
          break;
        }
        const key = segment.substring(0, colonIndex).toUpperCase();
        if (!KNOWN_KEYS.has(key)) {
          violations.push('DELIMITER_VIOLATION');
          break;
        }
      }
    } else if (parsed.scheme === 'mailto') {
      const queryIdx = trimmed.indexOf('?');
      if (queryIdx !== -1) {
        const query = trimmed.substring(queryIdx + 1);
        // Second '?' in query indicates unescaped delimiter
        if (query.includes('?')) {
          violations.push('DELIMITER_VIOLATION');
        } else {
          // A header other than to, cc, bcc, subject or body, or an empty one, means an `&` in a
          // value was not encoded.
          const pairs = query.split('&');
          const unknownHeader = pairs.some((pair) => {
            const eq = pair.indexOf('=');
            const header = safeDecodeURIComponent(eq === -1 ? pair : pair.substring(0, eq)).toLowerCase();
            return !MAILTO_HEADERS.has(header);
          });
          if (unknownHeader) {
            violations.push('DELIMITER_VIOLATION');
          }
        }
      }
    }

    // Deduplicate violations
    return Array.from(new Set(violations));
  },
};
