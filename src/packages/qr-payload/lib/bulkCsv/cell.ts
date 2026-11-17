/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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

import { QRType } from '@/packages/core/types';
import { normalizeUrl } from '@/packages/core/url';

/**
 * How a batch reads its payload cells. `link` treats every cell as a web address and normalises
 * it exactly like the single Link generator (`example.com` becomes `https://example.com/`, a
 * space becomes `%20`). `text` encodes each cell as typed, which keeps e-mail addresses, vCards,
 * Wi-Fi strings and line breaks intact. `vcard` (or `contact`) synthesizes a multi-column vCard contact card.
 */
export type BulkContentType = 'link' | 'text' | 'vcard' | 'contact';

/**
 * The exact string a batch encodes for one payload cell. The preview, the preflight checks and
 * the ZIP all use it, so the code that ships is the code that was checked and shown.
 * @param cell Raw cell from the payload column.
 * @param contentType Whether cells are links, plain text, or contact cards.
 * @returns The string to encode; `''` for a blank cell.
 */
export function encodeBulkCell(cell: string, contentType: BulkContentType = 'link'): string {
  const trimmed = cell.trim();
  if (trimmed === '') return '';
  if (contentType === 'text' || contentType === 'vcard' || contentType === 'contact') return trimmed;
  return normalizeUrl(trimmed);
}

/**
 * The payload type whose checks a batch row must pass: the Link generator's for links, the
 * Text generator's for plain text, and the vCard generator's for contact cards.
 * @param contentType Whether cells are links, plain text, or contact cards.
 */
export function bulkValidationType(contentType: BulkContentType = 'link'): QRType {
  if (contentType === 'text') return QRType.TEXT;
  if (contentType === 'vcard' || contentType === 'contact') return QRType.VCARD;
  return QRType.URL;
}
