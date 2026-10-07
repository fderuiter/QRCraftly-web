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

import { VCardData, QRType, QRGeneratorContract } from '@/types';
import { normalizeUrl } from '@/utils/url';
import { isDangerousUrl } from '@/utils/security';
import { identifyProtocol } from '../protocol';
import {
  escapeVCardEvent,
  unescapeVCardEvent,
  foldString,
  splitCompoundField,
  parseRFCProperties,
} from '../rfcHelper';

/**
 * Escapes special characters for MECard format.
 */
export const escapeMECard = (str: string | undefined): string => {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/([:;,])/g, '\\$1');
};

/**
 * Unescapes special characters in MECard format.
 */
export const unescapeMECard = (str: string | undefined): string => {
  if (!str) return '';
  return str.replace(/\\([\\:;,nN])/g, (_match, ch: string) =>
    ch === 'n' || ch === 'N' ? '\n' : ch
  );
};

/**
 * Hydrates VCardData from a raw string (vCard or MECard format).
 */
export const hydrateVCardData = (raw: string): VCardData => {
  const result: VCardData = {
    version: '3.0',
    firstName: '',
    lastName: '',
    organization: '',
    title: '',
    phone: '',
    email: '',
    website: '',
    street: '',
    city: '',
    zip: '',
    country: '',
  };

  if (!raw || typeof raw !== 'string') return result;

  const trimmed = raw.trim();

  if (/^mecard:/i.test(trimmed)) {
    result.version = 'mecard';
    const content = trimmed.substring(7);
    const segments = splitCompoundField(content, ';');

    segments.forEach((segment) => {
      const colonIndex = segment.indexOf(':');
      if (colonIndex <= 0) return;

      const key = segment.substring(0, colonIndex).toUpperCase();
      const val = segment.substring(colonIndex + 1);

      switch (key) {
        case 'N': {
          const nParts = splitCompoundField(val, ',');
          result.lastName = unescapeMECard(nParts[0] || '');
          result.firstName = unescapeMECard(nParts[1] || '');
          break;
        }
        case 'ORG':
          result.organization = unescapeMECard(val);
          break;
        case 'TIL':
        case 'TITLE':
          result.title = unescapeMECard(val);
          break;
        case 'TEL':
          result.phone = unescapeMECard(val);
          break;
        case 'EMAIL':
          result.email = unescapeMECard(val);
          break;
        case 'URL':
          result.website = unescapeMECard(val);
          break;
        case 'ADR': {
          const cleanVal = val.replace(/;/g, ',');
          const adrParts = splitCompoundField(cleanVal, ',');
          result.street = unescapeMECard(adrParts[2] || '');
          result.city = unescapeMECard(adrParts[3] || '');
          result.zip = unescapeMECard(adrParts[5] || '');
          result.country = unescapeMECard(adrParts[6] || '');
          break;
        }
      }
    });

    return result;
  }

  if (!/begin:vcard/i.test(raw)) return result;

  const properties = parseRFCProperties(raw);

  properties.forEach(({ key, value }) => {
    switch (key) {
      case 'VERSION': {
        const v = value.trim();
        if (v === '2.1' || v === '3.0' || v === '4.0') {
          result.version = v;
        }
        break;
      }
      case 'N': {
        const nParts = splitCompoundField(value, ';');
        result.lastName = unescapeVCardEvent(nParts[0] || '');
        result.firstName = unescapeVCardEvent(nParts[1] || '');
        break;
      }
      case 'ORG':
        result.organization = unescapeVCardEvent(value);
        break;
      case 'TITLE':
        result.title = unescapeVCardEvent(value);
        break;
      case 'TEL':
        result.phone = unescapeVCardEvent(value);
        break;
      case 'EMAIL':
        result.email = unescapeVCardEvent(value);
        break;
      case 'URL':
        result.website = unescapeVCardEvent(value);
        break;
      case 'ADR': {
        const adrParts = splitCompoundField(value, ';');
        result.street = unescapeVCardEvent(adrParts[2] || '');
        result.city = unescapeVCardEvent(adrParts[3] || '');
        result.zip = unescapeVCardEvent(adrParts[5] || '');
        result.country = unescapeVCardEvent(adrParts[6] || '');
        break;
      }
    }
  });

  return result;
};

const isPopulated = (str: string | undefined): boolean => Boolean(str && str.trim().length > 0);

/**
 * Constructs the contact payload string (vCard 2.1, 3.0, 4.0, or MECard).
 */
export const constructVCardString = (data: VCardData): string => {
  if (!data) return '';
  const version = data.version || '3.0';

  if (version === 'mecard') {
    const lastName = escapeMECard(data.lastName);
    const firstName = escapeMECard(data.firstName);
    const org = escapeMECard(data.organization);
    const title = escapeMECard(data.title);
    const phone = escapeMECard(data.phone);
    const email = escapeMECard(data.email);
    const normalizedWebsite = normalizeUrl(data.website);
    const website = escapeMECard(normalizedWebsite);
    const street = escapeMECard(data.street);
    const city = escapeMECard(data.city);
    const zip = escapeMECard(data.zip);
    const country = escapeMECard(data.country);

    const parts: string[] = [
      'MECARD:',
      `N:${lastName},${firstName};`,
    ];

    if (isPopulated(org)) parts.push(`ORG:${org};`);
    if (isPopulated(title)) parts.push(`TIL:${title};`);
    if (isPopulated(phone)) parts.push(`TEL:${phone};`);
    if (isPopulated(email)) parts.push(`EMAIL:${email};`);
    if (isPopulated(website)) parts.push(`URL:${website};`);

    if (isPopulated(street) || isPopulated(city) || isPopulated(zip) || isPopulated(country)) {
      parts.push(`ADR:,,${street},${city},,${zip},${country};`);
    }

    parts.push(';');
    return parts.join('');
  }

  const lastName = escapeVCardEvent(data.lastName);
  const firstName = escapeVCardEvent(data.firstName);
  const org = escapeVCardEvent(data.organization);
  const title = escapeVCardEvent(data.title);
  const phone = escapeVCardEvent(data.phone);
  const email = escapeVCardEvent(data.email);

  // Normalize URL first to handle spaces/protocols
  const normalizedWebsite = normalizeUrl(data.website);
  const website = normalizedWebsite;

  const street = escapeVCardEvent(data.street);
  const city = escapeVCardEvent(data.city);
  const zip = escapeVCardEvent(data.zip);
  const country = escapeVCardEvent(data.country);

  const parts: string[] = [
    'BEGIN:VCARD',
    `VERSION:${version}`,
    `N:${lastName};${firstName};;;`,
    `FN:${firstName} ${lastName}`,
  ];

  if (isPopulated(org)) parts.push(`ORG:${org}`);
  if (isPopulated(title)) parts.push(`TITLE:${title}`);
  if (isPopulated(phone)) parts.push(`TEL:${phone}`);
  if (isPopulated(email)) parts.push(`EMAIL:${email}`);
  if (isPopulated(website)) parts.push(`URL:${website}`);

  if (isPopulated(street) || isPopulated(city) || isPopulated(zip) || isPopulated(country)) {
    parts.push(`ADR:;;${street};${city};;${zip};${country}`);
  }

  parts.push('END:VCARD');

  return foldString(parts.join('\r\n'));
};

export const VCardContract: QRGeneratorContract<VCardData> = {
  type: QRType.VCARD,
  construct: constructVCardString,
  hydrate: hydrateVCardData,
  matches: (raw: string) => identifyProtocol(raw) === QRType.VCARD,
  validate: (raw: string) => {
    const violations: string[] = [];
    if (!raw) return violations;

    const trimmed = raw.trim();
    if (/^mecard:/i.test(trimmed)) {
      const content = trimmed.substring(7);
      const parts = splitCompoundField(content, ';');
      for (const part of parts) {
        const colonIdx = part.indexOf(':');
        if (colonIdx > 0) {
          const key = part.substring(0, colonIdx).toUpperCase();
          if (key === 'URL') {
            const val = unescapeMECard(part.substring(colonIdx + 1)).trim();
            if (isDangerousUrl(val)) {
              violations.push('URI_INJECTION_VIOLATION');
              break;
            }
          }
        }
      }
    } else {
      const properties = parseRFCProperties(raw);
      for (const { key, value } of properties) {
        if (key === 'URL') {
          const vcardUrl = value.trim();
          if (isDangerousUrl(vcardUrl)) {
            violations.push('URI_INJECTION_VIOLATION');
            break;
          }
        }
      }
    }
    return violations;
  },
};
