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

/** Most data rows a bulk batch keeps in memory. Rows past this are counted, not stored. */
export const MAX_BULK_CSV_ROWS = 500;

/** Largest CSV text, in UTF-16 code units, the parser accepts (about 2 MB of ASCII). */
export const MAX_BULK_CSV_CHARS = 2 * 1024 * 1024;

/** One data row keyed by header name. */
export type CsvRow = Record<string, string>;

/** Result of parsing a CSV document with a header row. */
export interface CsvTable {
  /** Header names in column order, trimmed, de-duplicated and never empty. */
  headers: string[];
  /** Data rows (at most `maxRows`), keyed by header. Missing cells are `''`. */
  rows: CsvRow[];
  /** Number of non-empty data rows in the document, including any dropped past `maxRows`. */
  totalRows: number;
  /** True when `totalRows` exceeds the rows kept. */
  truncated: boolean;
  /**
   * For each kept row, its 1-based data row number as a spreadsheet shows it: blank lines are
   * counted, the header is not. Use it in messages so "Row 4" is row 4 in Excel too.
   */
  rowNumbers: number[];
  /** The field delimiter used: the one passed in, or the one detected from the header row. */
  delimiter: string;
}

/** Options for {@link parseCsv}. */
export interface ParseCsvOptions {
  /** Field delimiter. Detected from the header row when omitted (see {@link detectDelimiter}). */
  delimiter?: string;
  /** Maximum data rows to keep. Defaults to {@link MAX_BULK_CSV_ROWS}. */
  maxRows?: number;
}

/** Thrown when the CSV text cannot be parsed (unterminated quote, oversize input). */
export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

const QUOTE = '"';

/**
 * Splits CSV text into records of raw fields following RFC 4180: fields may be
 * quoted, `""` inside quotes is a literal quote, and quoted fields may contain
 * delimiters and line breaks. CRLF, LF and lone CR all end a record. Text after a
 * closing quote is kept literally rather than rejected.
 */
function tokenize(text: string, delimiter: string, onRecord: (fields: string[]) => void): void {
  let field = '';
  let fields: string[] = [];
  let inQuotes = false;
  let quoteStartLine = 1;
  let line = 1;
  let i = 0;
  const n = text.length;

  const endRecord = () => {
    fields.push(field);
    onRecord(fields);
    fields = [];
    field = '';
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === QUOTE) {
        if (text[i + 1] === QUOTE) {
          field += QUOTE;
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line += 1;
      field += ch;
      i += 1;
      continue;
    }

    if (ch === QUOTE && field.length === 0) {
      inQuotes = true;
      quoteStartLine = line;
      i += 1;
    } else if (ch === delimiter) {
      fields.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r' || ch === '\n') {
      endRecord();
      line += 1;
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  if (inQuotes) {
    throw new CsvParseError(`Unterminated quoted field starting on line ${quoteStartLine}.`);
  }
  // A trailing line break already closed the last record.
  if (field.length > 0 || fields.length > 0) endRecord();
}

/** Delimiters {@link detectDelimiter} chooses between, in order of preference on a tie. */
const DELIMITER_CANDIDATES = [',', ';', '\t'] as const;

/**
 * Picks the field delimiter from the first non-blank record: whichever of comma, semicolon
 * and tab appears most often outside quotes. Excel saves "CSV" with semicolons in locales
 * that use a decimal comma, and "Text (Tab delimited)" with tabs. Defaults to a comma.
 * @param text CSV text.
 * @returns `,`, `;` or a tab.
 */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITER_CANDIDATES.map((d) => [d, 0]));
  let inQuotes = false;
  let sawContent = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === QUOTE) {
      inQuotes = !inQuotes;
      sawContent = true;
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (sawContent) break;
    } else if (!inQuotes) {
      const count = counts.get(ch);
      if (count !== undefined) counts.set(ch, count + 1);
      else if (ch.trim() !== '') sawContent = true;
    }
  }
  let best: string = DELIMITER_CANDIDATES[0];
  for (const candidate of DELIMITER_CANDIDATES) {
    if ((counts.get(candidate) ?? 0) > (counts.get(best) ?? 0)) best = candidate;
  }
  return best;
}

/**
 * Decodes the bytes of an uploaded CSV or TXT file. UTF-16 is used when the file starts with a
 * UTF-16 byte order mark (Excel's "Unicode Text"), or when it has none but every other byte of
 * its start is zero; anything else is read as UTF-8.
 * @param bytes File contents.
 * @returns The decoded text, without a byte order mark.
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const sample = bytes.subarray(0, Math.min(bytes.length, 512) & ~1);
  if (sample.length >= 4) {
    let evenZeros = 0;
    let oddZeros = 0;
    for (let i = 0; i < sample.length; i += 2) {
      if (sample[i] === 0) evenZeros += 1;
      if (sample[i + 1] === 0) oddZeros += 1;
    }
    const pairs = sample.length / 2;
    if (oddZeros === pairs && evenZeros === 0) return new TextDecoder('utf-16le').decode(bytes);
    if (evenZeros === pairs && oddZeros === 0) return new TextDecoder('utf-16be').decode(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function isBlankRecord(fields: string[]): boolean {
  return fields.every((f) => f.trim() === '');
}

function normalizeHeaders(raw: string[]): string[] {
  const seen = new Set<string>();
  return raw.map((value, index) => {
    const base = value.trim() || `Column ${index + 1}`;
    let name = base;
    let suffix = 2;
    while (seen.has(name)) {
      name = `${base}_${suffix}`;
      suffix += 1;
    }
    seen.add(name);
    return name;
  });
}

/**
 * Parses CSV text whose first non-blank record is the header row. A byte order mark is
 * stripped, blank lines are skipped, and the delimiter is detected unless one is given. Only the first `maxRows`
 * data rows are kept so memory stays bounded; the rest are only counted.
 * @throws {CsvParseError} on an unterminated quoted field or input over {@link MAX_BULK_CSV_CHARS}.
 */
export function parseCsv(text: string, options: ParseCsvOptions = {}): CsvTable {
  if (text.length > MAX_BULK_CSV_CHARS) {
    throw new CsvParseError(`The CSV is too large (limit ${MAX_BULK_CSV_CHARS} characters).`);
  }
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = options.delimiter ?? detectDelimiter(source);
  const maxRows = Math.max(0, options.maxRows ?? MAX_BULK_CSV_ROWS);
  if (delimiter.length !== 1 || delimiter === QUOTE || delimiter === '\r' || delimiter === '\n') {
    throw new CsvParseError('The delimiter must be a single character other than a quote or line break.');
  }

  let headers: string[] | null = null;
  const rows: CsvRow[] = [];
  let totalRows = 0;

  const rowNumbers: number[] = [];
  // Records after the header, blank ones included, so numbers match the spreadsheet's rows.
  let recordsAfterHeader = 0;

  tokenize(source, delimiter, (fields) => {
    if (headers !== null) recordsAfterHeader += 1;
    if (isBlankRecord(fields)) return;
    if (headers === null) {
      headers = normalizeHeaders(fields);
      return;
    }
    totalRows += 1;
    if (rows.length >= maxRows) return;
    // No prototype, so a header such as `__proto__` or `constructor` is an ordinary column.
    const row: CsvRow = Object.create(null);
    headers.forEach((header, index) => {
      row[header] = fields[index] ?? '';
    });
    rows.push(row);
    rowNumbers.push(recordsAfterHeader);
  });

  return { headers: headers ?? [], rows, totalRows, truncated: totalRows > rows.length, rowNumbers, delimiter };
}
