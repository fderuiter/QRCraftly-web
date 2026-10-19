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
export const PAYLOAD_COLUMN_WORDS: readonly string[] = [
  'url',
  'urls',
  'uri',
  'link',
  'links',
  'href',
  'website',
  'payload',
  'data',
  'qr',
  'content',
  'promo_link',
  'customer_url',
  'target',
  'destination',
  'campaign',
  'redirect',
  'endpoint',
  'promo',
];
/** Header words that usually mark a per-row file name column. */
export const FILENAME_COLUMN_WORDS: readonly string[] = ['name', 'filename', 'file', 'id', 'label', 'title', 'sku'];

/** Regex pattern to detect candidate cells containing URLs, URIs, or structured QR payloads. */
const PAYLOAD_CELL_PATTERN = /^(https?:\/\/|www\.|mailto:|tel:|sms:|wifi:|geo:|vcard|BEGIN:VCARD)|:\/\//i;

/**
 * Checks sample rows for URL or payload characteristics.
 */
function isPayloadCell(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return PAYLOAD_CELL_PATTERN.test(trimmed) || /\.[a-z]{2,}(\/|\?|#|$)/i.test(trimmed);
}

/** Splits a header into lowercase words and normalized tokens. */
function headerWords(header: string): string[] {
  const normalized = header.toLowerCase().trim();
  const rawClean = normalized.replace(/[^\p{L}\p{N}]+/gu, '');
  const rawUnderscore = normalized.replace(/[^\p{L}\p{N}]+/gu, '_');
  const splitWords = header
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  const set = new Set<string>();
  if (normalized) set.add(normalized);
  if (rawClean) set.add(rawClean);
  if (rawUnderscore) set.add(rawUnderscore);
  for (const word of splitWords) {
    set.add(word);
  }
  return Array.from(set);
}

/** Options for column selection heuristics. */
export interface PickColumnOptions {
  exclude?: string;
  rows?: CsvRow[];
  kind?: 'payload' | 'filename';
}

/**
 * Picks the column whose header matches the highest-priority word in `words`.
 * If headers do not match known keywords and sample `rows` are provided, does fallback inspection
 * of cell values according to `kind` ('payload' | 'filename').
 * Falls back to the first column that is not `exclude`, then to `exclude` itself when it is the only column.
 * @param columns Header names.
 * @param words Preferred header words in priority order, lowercase.
 * @param excludeOrOptions Excluded column name or options object with exclude, rows, and kind.
 * @param rowsArg Sample data rows for fallback cell inspection when excludeOrOptions is string.
 * @param kindArg Column kind for fallback cell inspection when excludeOrOptions is string.
 * @returns The chosen column, or `''` when there are no columns.
 */
export function pickColumn(
  columns: string[],
  words: readonly string[],
  excludeOrOptions: string | PickColumnOptions = '',
  rowsArg: CsvRow[] = [],
  kindArg?: 'payload' | 'filename'
): string {
  const options: PickColumnOptions =
    typeof excludeOrOptions === 'object' && excludeOrOptions !== null
      ? excludeOrOptions
      : { exclude: excludeOrOptions, rows: rowsArg, kind: kindArg };

  const exclude = options.exclude ?? '';
  const rows = options.rows ?? [];
  const kind =
    options.kind ??
    (words.some((w) => PAYLOAD_COLUMN_WORDS.includes(w))
      ? 'payload'
      : words.some((w) => FILENAME_COLUMN_WORDS.includes(w))
        ? 'filename'
        : undefined);

  const candidates = columns.filter((col) => col !== exclude);
  if (candidates.length === 0) return columns[0] ?? '';

  let bestCandidate: string | null = null;
  let bestWordIndex = Infinity;

  for (const col of candidates) {
    const tokens = headerWords(col);
    for (const token of tokens) {
      const index = words.indexOf(token);
      if (index !== -1 && index < bestWordIndex) {
        bestWordIndex = index;
        bestCandidate = col;
      }
    }
  }

  if (bestCandidate !== null) {
    return bestCandidate;
  }

  if (rows.length > 0 && candidates.length > 0) {
    const sampleRows = rows.slice(0, 10);
    if (kind === 'payload') {
      let bestCandidate = candidates[0];
      let maxPayloadMatches = -1;
      for (const col of candidates) {
        let matches = 0;
        for (const row of sampleRows) {
          const val = row[col];
          if (typeof val === 'string' && isPayloadCell(val)) {
            matches++;
          }
        }
        if (matches > maxPayloadMatches) {
          maxPayloadMatches = matches;
          bestCandidate = col;
        }
      }
      if (maxPayloadMatches > 0) {
        return bestCandidate;
      }
    } else if (kind === 'filename') {
      let bestCandidate = candidates[0];
      let maxFilenameScore = -1;
      for (const col of candidates) {
        let score = 0;
        for (const row of sampleRows) {
          const val = row[col];
          if (typeof val === 'string' && val.trim() !== '' && !isPayloadCell(val)) {
            score++;
          }
        }
        if (score > maxFilenameScore) {
          maxFilenameScore = score;
          bestCandidate = col;
        }
      }
      if (maxFilenameScore > 0) {
        return bestCandidate;
      }
    }
  }

  return candidates[0] ?? columns[0] ?? '';
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
  const column = table.headers.includes(payloadColumn)
    ? payloadColumn
    : pickColumn(table.headers, PAYLOAD_COLUMN_WORDS, { exclude: '', rows: table.rows, kind: 'payload' });
  if (!column) return null;
  const index = table.rows.findIndex((row) => hasPayload(row, column));
  if (index === -1) return null;
  return {
    payload: encodeBulkCell(table.rows[index][column], contentType),
    rowNumber: table.rowNumbers[index],
    rowCount: table.rows.length,
  };
}
