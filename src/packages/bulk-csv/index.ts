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
 * Bulk CSV batch engine: the building blocks of the Bulk CSV Batch generator. Everything
 * runs in memory in the browser and makes no network requests. It builds on core (the ZIP
 * writer), qr-payload (the CSV parser, cell encoding and preview row, re-exported here),
 * link-safety and wasm-runtime (the Excel reader).
 *
 * - Cross-platform file name helpers for the archive entries, and the error log.
 * - The batch loop that draws each checked row into a ZIP entry, with the drawing supplied by the caller.
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
  previewRow,
  pickColumn,
  hasPayload,
  PAYLOAD_COLUMN_WORDS,
  FILENAME_COLUMN_WORDS,
  type BulkCsvPreview,
  encodeBulkCell,
  type BulkContentType,
} from '@/packages/qr-payload';
export { formatErrorLogCsv, type ErrorLogItem } from './lib/errorLog';
export { createZip, type ZipEntry, type CreateZipOptions } from '@/packages/core/zip';
export { sanitizeFileStem, allocateFileName, errorLogFileName } from './lib/fileNames';
export { parseExcelToCsv } from './lib/excel';
export { SAMPLE_CSV_TEMPLATE } from './lib/template';
export { escapeCsvCell } from './lib/csvEscape';
export {
  categorizeCsvRows,
  formatPreflightReportCsv,
  preflightReportFileName,
  type CategorizeOptions,
  type PreflightReport,
  type PreflightRowDetail,
  type PreflightRowStatus,
} from './lib/categorize';
export {
  runBatch,
  batchRows,
  batchZipName,
  batchPngSize,
  skippedFromReport,
  type BatchRow,
  type BatchFormat,
  type BatchResult,
  type RunBatchOptions,
  type SkippedRow,
} from './lib/batch';
