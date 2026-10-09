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

import { PhoneData, QRType, QRGeneratorContract } from '@/types';
import { parseProtocol, identifyProtocol, encodeDialString, safeDecodeURIComponent } from '../protocol';
import { cleanPhoneNumber } from '@/utils/security';

// An extension at the end of the number: `x89`, `ext 89`, `ext. 89`, `extension 89` or `;ext=89`.
const EXTENSION_PATTERN = /(?:;ext=|\s*(?:ext(?:ension)?\.?|x)\s?:?)\s?(\d{1,10})\s*$/i;

// What a dial string keeps: digits, `+`, `*`, `#`, visual separators, `,` pauses and spaces.
const KEPT_IN_NUMBER = /[0-9+*#\-().,\s]/;

/**
 * Splits an extension off the end of a typed phone number, so its digits are not run into the
 * number (`+1 555 123 4567 x89` must not dial `+1555123456789`).
 * @param input - The typed number.
 * @returns The number and the extension digits (empty when there is none).
 */
export const splitPhoneExtension = (input: string): { number: string; extension: string } => {
  const match = EXTENSION_PATTERN.exec(input);
  if (!match || match.index === 0) return { number: input, extension: '' };
  return { number: input.substring(0, match.index), extension: match[1] };
};

/**
 * Lists the characters a phone code leaves out of the typed number, so the form can say so
 * instead of silently dialling something else.
 * @param input - The typed number.
 * @param allowSeparators - Whether `;` is kept (SMS codes use it between several numbers).
 * @returns Each dropped character once, in the order typed.
 */
export const droppedPhoneCharacters = (input: string, allowSeparators = false): string[] => {
  const { number } = allowSeparators ? { number: input } : splitPhoneExtension(input);
  const dropped = Array.from(number).filter((ch) => !KEPT_IN_NUMBER.test(ch) && !(allowSeparators && ch === ';'));
  return Array.from(new Set(dropped));
};

/**
 * Constructs the tel string for Phone QR code. An extension is written as RFC 3966 `;ext=`, and
 * `,` pauses are kept.
 */
export const constructPhoneString = (data: PhoneData): string => {
  if (!data) return 'tel:';
  const { number, extension } = splitPhoneExtension(data.number || '');
  // `;` would start a URI parameter here, so only the `,` pause survives from the preserve set.
  const cleanNumber = cleanPhoneNumber(number, true).replace(/;/g, '');
  const ext = extension && cleanNumber ? `;ext=${extension}` : '';
  // nosemgrep: enforce-cleanphonenumber
  return `tel:${encodeDialString(cleanNumber)}${ext}`;
};

/**
 * Hydrates PhoneData from a raw string. A `;ext=` parameter becomes ` ext. NN` in the field.
 */
export const hydratePhoneData = (raw: string): PhoneData => {
  const parsed = parseProtocol(raw);
  if (parsed && parsed.scheme === 'tel') {
    const path = safeDecodeURIComponent(parsed.path);
    const ext = /;ext=(\d{1,10})$/i.exec(path);
    return { number: ext ? `${path.substring(0, ext.index)} ext. ${ext[1]}` : path };
  }
  return { number: '' };
};

export const PhoneContract: QRGeneratorContract<PhoneData> = {
  type: QRType.PHONE,
  construct: constructPhoneString,
  hydrate: hydratePhoneData,
  matches: (raw: string) => identifyProtocol(raw) === QRType.PHONE,
  validate: () => [],
};
