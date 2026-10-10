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
 * Escapes a vCard 2.1 value: `\` and `;` are escaped (not `,`), and line breaks become spaces
 * because 2.1 has no `\n` escape (it would need quoted-printable).
 */
const escapeVCard21 = (str: string | undefined): string => {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, ' ').replace(/;/g, '\\;');
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
  let formattedName = '';

  properties.forEach(({ key, value, params }) => {
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
      case 'FN':
        formattedName = unescapeVCardEvent(value).trim();
        break;
      case 'ORG':
        // ORG is structured (name;unit;unit), so `Acme;` is just "Acme".
        result.organization = splitCompoundField(value, ';')
          .map((unit) => unescapeVCardEvent(unit).trim())
          .filter(Boolean)
          .join(', ');
        break;
      case 'TITLE':
        result.title = unescapeVCardEvent(value);
        break;
      case 'TEL': {
        const phone = unescapeVCardEvent(value);
        // vCard 4.0 writes `TEL;VALUE=uri:tel:+1-555-0100`.
        result.phone = /VALUE=uri/i.test(params) ? phone.replace(/^tel:/i, '') : phone;
        break;
      }
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

  // vCard 4.0 makes N optional; take the name from FN when N gave none.
  if (!result.firstName && !result.lastName && formattedName) {
    const space = formattedName.lastIndexOf(' ');
    result.firstName = space === -1 ? formattedName : formattedName.substring(0, space).trim();
    result.lastName = space === -1 ? '' : formattedName.substring(space + 1);
  }

  return result;
};

const isPopulated = (str: string | undefined): boolean => Boolean(str && str.trim().length > 0);

/** The fields a visitor types; a card with none of them filled in is empty. */
const CARD_FIELDS = ['firstName', 'lastName', 'organization', 'title', 'phone', 'email', 'website', 'street', 'city', 'zip', 'country'] as const satisfies readonly (keyof VCardData)[];

/**
 * Constructs the contact payload string (vCard 2.1, 3.0, 4.0, or MECard).
 */
export const constructVCardString = (data: VCardData): string => {
  // An empty card gives no code, so the generator shows its sample state (#1272).
  if (!data || !CARD_FIELDS.some((field) => isPopulated(data[field]))) return '';
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

  // vCard 2.1 escapes only `;`, has no `\n` escape, and needs CHARSET for non-ASCII text.
  const is21 = version === '2.1';
  const escape = is21 ? escapeVCard21 : escapeVCardEvent;
  const prop = (name: string, value: string): string =>
    is21 && /[^\x00-\x7F]/.test(value) ? `${name};CHARSET=UTF-8:${value}` : `${name}:${value}`;

  const lastName = escape(data.lastName);
  const firstName = escape(data.firstName);
  const org = escape(data.organization);
  const title = escape(data.title);
  const phone = escape(data.phone);
  const email = escape(data.email);

  // Normalize URL first to handle spaces/protocols
  const normalizedWebsite = normalizeUrl(data.website);
  const website = normalizedWebsite;

  const street = escape(data.street);
  const city = escape(data.city);
  const zip = escape(data.zip);
  const country = escape(data.country);

  // FN must not be empty (RFC 6350 §6.2.1), so a card with no name is named after its
  // organisation, email or phone.
  const formattedName =
    [firstName, lastName].filter(isPopulated).join(' ') || [org, email, phone].find(isPopulated) || '';

  const parts: string[] = [
    'BEGIN:VCARD',
    `VERSION:${version}`,
    prop('N', `${lastName};${firstName};;;`),
    prop('FN', formattedName),
  ];

  if (isPopulated(org)) parts.push(prop('ORG', org));
  if (isPopulated(title)) parts.push(prop('TITLE', title));
  if (isPopulated(phone)) parts.push(prop('TEL', phone));
  if (isPopulated(email)) parts.push(prop('EMAIL', email));
  if (isPopulated(website)) parts.push(`URL:${website}`);

  if (isPopulated(street) || isPopulated(city) || isPopulated(zip) || isPopulated(country)) {
    parts.push(prop('ADR', `;;${street};${city};;${zip};${country}`));
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
