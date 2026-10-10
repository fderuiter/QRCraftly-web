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

import { type UrlData, QRType, type QRGeneratorContract } from '@/types';
import { validateUrlAndInject } from '@/utils/security';
import { normalizeUrl } from '@/utils/url';
import { identifyProtocol, parseProtocol, CONTAINMENT_PROFILES } from '../protocol';

/**
 * Constructs the URL QR code string.
 * Currently just returns the raw URL as normalization happens in the input or renderer.
 */
export const constructUrlString = (data: UrlData): string => {
  if (!data) return '';
  return normalizeUrl(data.url || '');
};

/**
 * Hydrates UrlData from a raw string.
 */
export const hydrateUrlData = (raw: string): UrlData => {
  return { url: raw || '' };
};

/**
 * Contract for URL payload serialization and validation.
 */
export const UrlContract: QRGeneratorContract<UrlData> = {
  type: QRType.URL,
  construct: constructUrlString,
  hydrate: hydrateUrlData,
  matches: (raw: string) => {
    const identified = identifyProtocol(raw);
    if (identified === QRType.URL) return true;
    const parsed = parseProtocol(raw);
    return parsed !== null && (parsed.scheme === 'http' || parsed.scheme === 'https');
  },
  validate: (raw: string) => {
    return validateUrlAndInject(raw, CONTAINMENT_PROFILES.URL);
  },
};
