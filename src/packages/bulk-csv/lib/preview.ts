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

import { CsvParseError, MAX_BULK_CSV_ROWS, parseCsv, type CsvRow } from './csv';
import { encodeBulkCell, type BulkContentType } from './payload';

/** Header words that usually mark the QR content column. */
export const PAYLOAD_COLUMN_WORDS: readonly string[] = ['url', 'urls', 'uri', 'link', 'links', 'href', 'website', 'payload', 'data', 'qr', 'content'];
/** Header words that usually mark a per-row file name column. */
export const FILENAME_COLUMN_WORDS: readonly string[] = ['name', 'filename', 'file', 'id', 'label', 'title', 'sku'];

/** Splits a header into lowercase words: `Video URL`, `video_url` and `videoUrl` all give `video`, `url`. */
function headerWords(header: string): string[] {
  return header
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Picks the first column whose header contains one of `words` as a whole word, so `Video URL`
 * counts as a link column and not as an `id` column. Falls back to the first column that is not
 * `exclude`, then to `exclude` itself when it is the only column.
 * @param columns Header names.
 * @param words Preferred header words, lowercase.
 * @param exclude A column already used for something else, such as the payload column.
 * @returns The chosen column, or `''` when there are no columns.
 */
export function pickColumn(columns: string[], words: readonly string[], exclude = ''): string {
  const candidates = columns.filter((col) => col !== exclude);
  const match = candidates.find((col) => headerWords(col).some((word) => words.includes(word)));
  return match ?? candidates[0] ?? columns[0] ?? '';
}

/**
 * True when the row has a non-blank value in the payload column.
 * @param row Parsed row.
 * @param payloadColumn Payload column header.
 * @returns Whether the row would produce a QR code.
 */
export function hasPayload(row: CsvRow, payloadColumn: string): boolean {
  const value = row[payloadColumn];
  return typeof value === 'string' && value.trim() !== '';
}

/** The row the live preview encodes. */
export interface BulkCsvPreview {
  /** What the preview encodes for the first row that has a payload: the same string as its code in the ZIP. */
  payload: string;
  /** That row's data row number as a spreadsheet shows it (blank lines counted, the header not). */
  rowNumber: number;
  /** Number of data rows used for the batch. */
  rowCount: number;
}

/**
 * Finds what the live preview should encode: the first data row that has a payload, encoded
 * exactly as the ZIP encodes it, not the whole CSV. Uses `payloadColumn`, or the column the
 * input would pick.
 * @param csvContent Raw CSV text.
 * @param payloadColumn Selected payload column, or `''` for the default.
 * @param contentType Whether cells are links or plain text.
 * @returns The preview row, or null when the CSV is empty, unreadable or has no payloads.
 */
export function previewRow(csvContent: string, payloadColumn: string, contentType: BulkContentType = 'link'): BulkCsvPreview | null {
  if (!csvContent) return null;
  let table;
  try {
    table = parseCsv(csvContent, { maxRows: MAX_BULK_CSV_ROWS });
  } catch (err) {
    if (err instanceof CsvParseError) return null;
    throw err;
  }
  const column = table.headers.includes(payloadColumn) ? payloadColumn : pickColumn(table.headers, PAYLOAD_COLUMN_WORDS);
  if (!column) return null;
  const index = table.rows.findIndex((row) => hasPayload(row, column));
  if (index === -1) return null;
  return {
    payload: encodeBulkCell(table.rows[index][column], contentType),
    rowNumber: table.rowNumbers[index],
    rowCount: table.rows.length,
  };
}
