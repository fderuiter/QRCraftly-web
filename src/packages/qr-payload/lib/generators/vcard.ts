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
 * Hydrates VCardData from a raw string.
 */
export const hydrateVCardData = (raw: string): VCardData => {
  const result: VCardData = {
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
    photo: '',
  };

  if (!raw || typeof raw !== 'string' || !/begin:vcard/i.test(raw)) return result;

  const properties = parseRFCProperties(raw);

  properties.forEach(({ key, value, params }) => {
    switch (key) {
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
      case 'PHOTO': {
        const trimmedVal = value.trim();
        if (!trimmedVal) {
          result.photo = '';
          break;
        }

        // Validate ENCODING parameter if present
        const encodingMatch = params.match(/ENCODING=([^;:]+)/i);
        if (encodingMatch) {
          const enc = encodingMatch[1].toLowerCase();
          if (enc !== 'b' && enc !== 'base64') {
            result.photo = '';
            break;
          }
        }

        if (
          trimmedVal.startsWith('data:image/') ||
          trimmedVal.startsWith('http://') ||
          trimmedVal.startsWith('https://')
        ) {
          result.photo = trimmedVal;
        } else if (/^[A-Za-z0-9+/=]+$/.test(trimmedVal)) {
          let imgType = 'jpeg';
          if (/TYPE=PNG/i.test(params)) {
            imgType = 'png';
          }
          result.photo = `data:image/${imgType};base64,${trimmedVal}`;
        } else {
          result.photo = '';
        }
        break;
      }
    }
  });

  return result;
};

/**
 * Constructs the vCard 3.0 string.
 */
export const constructVCardString = (data: VCardData): string => {
  if (!data) return '';
  const lastName = escapeVCardEvent(data.lastName);
  const firstName = escapeVCardEvent(data.firstName);
  // Normalize URL first to handle spaces/protocols
  const normalizedWebsite = normalizeUrl(data.website);
  const website = normalizedWebsite;

  const parts = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${lastName};${firstName};;;`,
    `FN:${firstName} ${lastName}`,
    `ORG:${escapeVCardEvent(data.organization)}`,
    `TITLE:${escapeVCardEvent(data.title)}`,
    `TEL:${escapeVCardEvent(data.phone)}`,
    `EMAIL:${escapeVCardEvent(data.email)}`,
    `URL:${website}`,
    `ADR:;;${escapeVCardEvent(data.street)};${escapeVCardEvent(data.city)};;${escapeVCardEvent(data.zip)};${escapeVCardEvent(data.country)}`,
  ];

  if (data.photo) {
    const trimmedPhoto = data.photo.trim();
    if (trimmedPhoto) {
      let photoType = 'JPEG';
      let rawBase64 = trimmedPhoto;

      if (trimmedPhoto.startsWith('data:image/')) {
        if (trimmedPhoto.startsWith('data:image/png')) {
          photoType = 'PNG';
        }
        rawBase64 = trimmedPhoto.replace(/^data:image\/[^;]+;base64,/, '').trim();
      }

      if (rawBase64) {
        parts.push(`PHOTO;TYPE=${photoType};ENCODING=b:${rawBase64}`);
      }
    }
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
    return violations;
  },
};
