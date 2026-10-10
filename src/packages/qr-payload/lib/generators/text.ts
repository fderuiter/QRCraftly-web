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

import { type TextData, QRType, type QRGeneratorContract } from '@/types';
import { identifyProtocol } from '../protocol';

/**
 * Constructs the plain text QR code string.
 */
export const constructTextString = (data: TextData): string => {
  if (!data) return '';
  return data.text || '';
};

/**
 * Hydrates TextData from a raw string.
 */
export const hydrateTextData = (raw: string): TextData => {
  return { text: raw || '' };
};

export const TextContract: QRGeneratorContract<TextData> = {
  type: QRType.TEXT,
  construct: constructTextString,
  hydrate: hydrateTextData,
  matches: (raw: string) => identifyProtocol(raw) === QRType.TEXT,
  validate: () => [],
};
