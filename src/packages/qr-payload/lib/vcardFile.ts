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

import type { VCardData } from './types';
import { CARD_FIELDS, hydrateVCardData } from './generators/vcard';

/** The largest contact file read: a card with an embedded photo is rarely past a few hundred KB. */
export const MAX_VCARD_FILE_BYTES = 1024 * 1024;

/** Why a contact file could not fill the form. */
export type VCardFileError = 'too-large' | 'not-a-vcard' | 'empty';

/** The contact fields read from a file, or why there are none. */
export type VCardFileResult = { ok: true; fields: Omit<VCardData, 'version'> } | { ok: false; error: VCardFileError };

/** Plain-language messages for each error, for the form's alert. */
export const VCARD_FILE_ERROR_MESSAGES: Readonly<Record<VCardFileError, string>> = {
  'too-large': 'That file is larger than 1 MB, so it was not read. Choose a single contact card (.vcf).',
  'not-a-vcard': 'That file is not a contact card. Choose a .vcf or .vcard file.',
  empty: 'That contact card has no name, phone, email or address to fill in.',
};

const QUOTED_PRINTABLE = /;(?:ENCODING=)?QUOTED-PRINTABLE\b/i;

/**
 * Decodes a vCard 2.1 quoted-printable value (UTF-8 bytes as `=XX`) into text.
 * @param value - The encoded value, soft line breaks already joined.
 * @returns The text, with line breaks written as the `\n` escape the card parser reads.
 */
const decodeQuotedPrintable = (value: string): string => {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const hex = value[i] === '=' ? value.slice(i + 1, i + 3) : '';
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(value[i]));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes)).replace(/\r\n|\r|\n/g, '\\n');
};

/**
 * Rewrites vCard 2.1 quoted-printable lines as plain ones: joins their soft line breaks (a line
 * ending in `=`) and decodes them, so the shared card parser reads them like any other line.
 * @param card - One card's text.
 * @returns The card with no quoted-printable lines left.
 */
const decodeQuotedPrintableLines = (card: string): string => {
  const lines = card.split(/\r\n|\n|\r/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const colon = line.indexOf(':');
    if (colon <= 0 || !QUOTED_PRINTABLE.test(line.slice(0, colon))) {
      out.push(line);
      continue;
    }
    while (line.endsWith('=') && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i];
    const params = line.slice(0, colon).replace(/;(?:ENCODING=)?QUOTED-PRINTABLE\b/gi, '').replace(/;CHARSET=[^;:]*/gi, '');
    out.push(`${params}:${decodeQuotedPrintable(line.slice(colon + 1))}`);
  }
  return out.join('\n');
};

/**
 * Reads the first contact card of a `.vcf` or `.vcard` file's text (vCard 2.1, 3.0 or 4.0) into
 * the form's fields. It runs in the browser; nothing is sent anywhere. The form keeps its own
 * card format, so `version` is not read. An embedded photo is dropped: the form takes a photo link.
 * @param text - The file's text.
 * @returns The fields, or why the file cannot fill the form.
 */
export const readVCardFile = (text: string): VCardFileResult => {
  const source = text.replace(/^\uFEFF/, '');
  const start = source.search(/^BEGIN:VCARD\s*$/im);
  if (start === -1) return { ok: false, error: 'not-a-vcard' };
  const rest = source.slice(start);
  const end = rest.search(/^END:VCARD\s*$/im);
  const card = end === -1 ? rest : rest.slice(0, end);

  const { version: _version, ...fields } = hydrateVCardData(decodeQuotedPrintableLines(card));
  if (fields.photo && !/^https?:\/\//i.test(fields.photo)) fields.photo = '';
  const hasContent = CARD_FIELDS.some((field) => (fields[field] ?? '').trim().length > 0);
  return hasContent ? { ok: true, fields } : { ok: false, error: 'empty' };
};
