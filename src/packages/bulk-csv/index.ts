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

/**
 * Bulk CSV batch engine: dependency-free building blocks for the Bulk CSV Batch
 * generator. Everything runs in memory in the browser and makes no network requests.
 *
 * - RFC 4180 CSV parser with a header row and a bounded row count.
 * - Minimal ZIP writer (stored entries, CRC-32, UTF-8 names).
 * - Cross-platform file name helpers for the archive entries.
 * - Column detection and the row the live preview encodes.
 */

export {
  parseCsv,
  detectDelimiter,
  decodeCsvBytes,
  CsvParseError,
  MAX_BULK_CSV_ROWS,
  MAX_BULK_CSV_CHARS,
  type CsvRow,
  type CsvTable,
  type ParseCsvOptions,
} from './lib/csv';
export { createZip, type ZipEntry, type CreateZipOptions } from './lib/zip';
export { sanitizeFileStem, allocateFileName } from './lib/fileNames';
export {
  previewRow,
  pickColumn,
  PAYLOAD_COLUMN_WORDS,
  FILENAME_COLUMN_WORDS,
  type BulkCsvPreview,
} from './lib/preview';
export { encodeBulkCell, type BulkContentType } from './lib/payload';
export { SAMPLE_CSV_TEMPLATE } from './lib/template';
export {
  categorizeCsvRows,
  type CategorizeOptions,
  type PreflightReport,
  type PreflightRowDetail,
  type PreflightRowStatus,
} from './lib/categorize';
