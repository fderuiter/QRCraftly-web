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

import { DEFAULT_CONFIG } from '@/packages/core/config';
import { escapeCsvCell } from './csvEscape';
import { sanitizeFileStem } from './fileNames';
import {
  bulkValidationType,
  encodeBulkCell,
  hasPayload,
  isContactContentType,
  synthesizeVCardPayload,
  type BulkContentType,
  type BulkContactMapping,
  type CsvRow,
} from '@/packages/qr-payload';
import { analyseLink, type LinkFinding } from '@/packages/link-safety';
import { QRType, type QRConfig } from '@/packages/core/types';
import {
  isDangerousUrl,
} from '@/packages/core/security';

export type PreflightRowStatus = 'valid' | 'empty' | 'unsafe' | 'caution';

export interface PreflightRowDetail {
  /** Data row number as a spreadsheet shows it (blank lines counted, the header not). */
  rowNumber: number;
  /** Primary status category for this row. */
  category: PreflightRowStatus;
  /** Human-readable explanation if row is empty, unsafe, or has caution warning. */
  reason?: string;
  /** The string the row encodes (see `encodeBulkCell`), or the raw cell for an empty row. */
  payload?: string;
}

export interface PreflightReport {
  /** Total number of parsed data rows in the CSV. */
  totalRows: number;
  /** Number of rows with valid, generateable payloads (including caution rows). */
  validCount: number;
  /** Number of rows missing a value in the payload column. */
  emptyCount: number;
  /** Number of rows whose content fails the payload checks, so they are left out. */
  unsafeCount: number;
  /** Number of rows with link caution warnings (e.g. lookalikes, shorteners, IP addresses). */
  cautionCount: number;
  /** Details for all rows in index order. */
  details: PreflightRowDetail[];
  /** Filtered list of problematic details (empty, unsafe, or caution rows). */
  invalidDetails: PreflightRowDetail[];
  /** CsvRows that are valid or caution (safe to include in batch execution). */
  validRows: CsvRow[];
  /** 0-based indices in original rows array corresponding to validRows. */
  validRowIndices: number[];
  /** The encoded payload of each entry in validRows, in the same order. */
  validPayloads: string[];
}

/** Options for {@link categorizeCsvRows}. */
export interface CategorizeOptions {
  /** Whether cells are links, plain text, or contact cards. Defaults to links. */
  contentType?: BulkContentType;
  /** Spreadsheet row number of each row (`CsvTable.rowNumbers`). Defaults to the position + 1. */
  rowNumbers?: readonly number[];
  /** Column mapping for contact card synthesis. */
  contactMapping?: BulkContactMapping;
}

const REGEX_STRICT_NO_G = /[\x00-\x1F\x7F-\x9F]/;
const REGEX_PRESERVE_NO_G = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;
const REGEX_BIDI_NO_G = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

function defaultValidateConfig(config: QRConfig): string[] {
  const violations: string[] = [];
  if (config.borderText && REGEX_STRICT_NO_G.test(config.borderText)) {
    violations.push('Border Text contains invalid control characters');
  }
  if (config.templateHeadline && REGEX_STRICT_NO_G.test(config.templateHeadline)) {
    violations.push('Template Headline contains invalid control characters');
  }
  if (config.value) {
    const isMultiLine = config.type === QRType.VCARD || config.type === QRType.TEXT;
    const hasControl = isMultiLine
      ? REGEX_PRESERVE_NO_G.test(config.value)
      : REGEX_STRICT_NO_G.test(config.value);
    if (hasControl) {
      violations.push('Value contains invalid control characters');
    }
    if (REGEX_BIDI_NO_G.test(config.value)) {
      violations.push('Value contains hidden text-direction characters');
    }
    if (isDangerousUrl(config.value)) {
      violations.push('Unsafe URL scheme or dangerous payload detected');
    }
  }
  return violations;
}

interface PreflightRowRecorder extends Omit<PreflightReport, 'totalRows'> {
  recordRow(
    category: PreflightRowStatus,
    payload: string,
    rowNumber: number,
    row: CsvRow,
    index: number,
    reason?: string
  ): void;
  toReport(totalRows: number): PreflightReport;
}

function createPreflightRowRecorder(): PreflightRowRecorder {
  const details: PreflightRowDetail[] = [];
  const invalidDetails: PreflightRowDetail[] = [];
  const validRows: CsvRow[] = [];
  const validRowIndices: number[] = [];
  const validPayloads: string[] = [];

  const recorder: PreflightRowRecorder = {
    validCount: 0,
    emptyCount: 0,
    unsafeCount: 0,
    cautionCount: 0,
    details,
    invalidDetails,
    validRows,
    validRowIndices,
    validPayloads,
    recordRow(category, payload, rowNumber, row, index, reason) {
      const detail: PreflightRowDetail = {
        rowNumber,
        category,
        payload,
      };
      if (reason !== undefined) {
        detail.reason = reason;
      }
      details.push(detail);

      switch (category) {
        case 'empty':
          recorder.emptyCount += 1;
          invalidDetails.push(detail);
          break;
        case 'unsafe':
          recorder.unsafeCount += 1;
          invalidDetails.push(detail);
          break;
        case 'caution':
          recorder.cautionCount += 1;
          recorder.validCount += 1;
          invalidDetails.push(detail);
          validRows.push(row);
          validRowIndices.push(index);
          validPayloads.push(payload);
          break;
        case 'valid':
          recorder.validCount += 1;
          validRows.push(row);
          validRowIndices.push(index);
          validPayloads.push(payload);
          break;
      }
    },
    toReport(totalRows) {
      return {
        totalRows,
        validCount: recorder.validCount,
        emptyCount: recorder.emptyCount,
        unsafeCount: recorder.unsafeCount,
        cautionCount: recorder.cautionCount,
        details,
        invalidDetails,
        validRows,
        validRowIndices,
        validPayloads,
      };
    },
  };

  return recorder;
}

/**
 * Executes cached QR configuration validation and cached link caution analysis for a payload.
 */
function evaluateValidationAndCaution(
  payload: string,
  cautionUrl: string,
  baseConfig: QRConfig,
  validateFn: (config: QRConfig) => string[],
  validateCache: Map<string, string[]>,
  analyseCache: Map<string, LinkFinding[]>
): { category: 'unsafe' | 'caution' | 'valid'; reason?: string } {
  let violations = validateCache.get(payload);
  if (!violations) {
    violations = validateFn({ ...baseConfig, value: payload });
    validateCache.set(payload, violations);
  }

  if (violations.length > 0) {
    return { category: 'unsafe', reason: violations.join(' ') };
  }

  if (cautionUrl) {
    let findings = analyseCache.get(cautionUrl);
    if (!findings) {
      findings = analyseLink(cautionUrl);
      analyseCache.set(cautionUrl, findings);
    }
    const cautions = findings.filter((f) => f.severity === 'caution');
    if (cautions.length > 0) {
      return {
        category: 'caution',
        reason: cautions.map((f) => f.message).join(' '),
      };
    }
  }

  return { category: 'valid' };
}

/**
 * Validates a row payload against config rules and link caution analysis, recording the resulting
 * row outcome into the preflight recorder.
 */
function evaluateAndRecordValidatedRow(
  recorder: PreflightRowRecorder,
  payload: string,
  cautionUrl: string,
  baseConfig: QRConfig,
  validateFn: (config: QRConfig) => string[],
  validateCache: Map<string, string[]>,
  analyseCache: Map<string, LinkFinding[]>,
  row: CsvRow,
  index: number,
  rowNumber: number
): void {
  const result = evaluateValidationAndCaution(
    payload,
    cautionUrl,
    baseConfig,
    validateFn,
    validateCache,
    analyseCache
  );
  recorder.recordRow(
    result.category,
    payload,
    rowNumber,
    row,
    index,
    result.reason
  );
}

/**
 * Synchronously categorizes parsed CSV rows into Valid, Empty, Unsafe, and Caution buckets.
 * Operates in browser memory without network calls.
 *
 * @param rows CSV data rows.
 * @param payloadColumn Header name of the column containing QR payloads (or empty in contact mode).
 * @param config Active QR configuration.
 * @param customValidator Optional custom validator function for QR configuration.
 * @param options Content type, contact mapping, and spreadsheet row numbers.
 * @returns PreflightReport with detailed categorization metrics and row issues.
 */
export function categorizeCsvRows(
  rows: CsvRow[],
  payloadColumn: string,
  config?: Partial<QRConfig>,
  customValidator?: (config: QRConfig) => string[],
  options: CategorizeOptions = {}
): PreflightReport {
  const { contentType = 'link', rowNumbers, contactMapping } = options;
  const validationType = bulkValidationType(contentType);
  const isContact = isContactContentType(contentType);

  if (!rows || rows.length === 0 || (!payloadColumn && !isContact)) {
    return {
      totalRows: rows ? rows.length : 0,
      validCount: 0,
      emptyCount: 0,
      unsafeCount: 0,
      cautionCount: 0,
      details: [],
      invalidDetails: [],
      validRows: [],
      validRowIndices: [],
      validPayloads: [],
    };
  }

  const recorder = createPreflightRowRecorder();

  const baseConfig: QRConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    value: '',
    type: validationType,
  };

  const validateFn = customValidator ?? defaultValidateConfig;
  const validateCache = new Map<string, string[]>();
  const analyseCache = new Map<string, LinkFinding[]>();
  const mapping: BulkContactMapping = contactMapping ?? (payloadColumn ? { firstName: payloadColumn } : {});

  rows.forEach((row, index) => {
    const rowNumber = rowNumbers?.[index] ?? index + 1;

    // Contact card (vCard) multi-column synthesis workflow
    if (isContact) {
      const hasAnyFieldMapped = Object.values(mapping).some(Boolean);
      if (!hasAnyFieldMapped) {
        recorder.recordRow(
          'empty',
          '',
          rowNumber,
          row,
          index,
          'Missing column mapping for contact fields'
        );
        return;
      }

      const synthesized = synthesizeVCardPayload(row, mapping);
      const trimmedValue = synthesized.payload;

      // 1. Missing payload check
      if (!synthesized.hasAnyData) {
        recorder.recordRow(
          'empty',
          '',
          rowNumber,
          row,
          index,
          'Missing value in mapped contact fields'
        );
        return;
      }

      // 2. Identity validation: first name, last name, or organization required
      if (!synthesized.hasIdentity) {
        recorder.recordRow(
          'unsafe',
          trimmedValue,
          rowNumber,
          row,
          index,
          'Missing required contact identity (first name, last name, or organization)'
        );
        return;
      }

      // 3. Security and format checks (control characters, dangerous URLs, email format)
      if (synthesized.violations.length > 0) {
        recorder.recordRow(
          'unsafe',
          trimmedValue,
          rowNumber,
          row,
          index,
          synthesized.violations.join(' ')
        );
        return;
      }

      // 4. Config & vCard structural validation and caution check
      const websiteUrl = mapping.website ? (row[mapping.website] ?? '').trim() : '';
      evaluateAndRecordValidatedRow(
        recorder,
        trimmedValue,
        websiteUrl,
        baseConfig,
        validateFn,
        validateCache,
        analyseCache,
        row,
        index,
        rowNumber
      );
      return;
    }

    // Single-column link / text workflow
    const rawValue = row[payloadColumn] ?? '';

    // 1. Missing payload check
    if (!hasPayload(row, payloadColumn)) {
      recorder.recordRow(
        'empty',
        rawValue,
        rowNumber,
        row,
        index,
        `Missing value in payload column '${payloadColumn}'`
      );
      return;
    }

    // 2. The same payload checks as the single generator, on the string that will be encoded.
    const trimmedValue = encodeBulkCell(rawValue, contentType);
    evaluateAndRecordValidatedRow(
      recorder,
      trimmedValue,
      trimmedValue,
      baseConfig,
      validateFn,
      validateCache,
      analyseCache,
      row,
      index,
      rowNumber
    );
  });

  return recorder.toReport(rows.length);
}

/**
 * Serializes preflight row details or report findings into an RFC 4180 formatted CSV string.
 *
 * @param reportOrDetails Array of PreflightRowDetail or a PreflightReport object.
 * @returns RFC 4180 formatted CSV string with headers Row, Status, Reason, and Payload.
 */
export function formatPreflightReportCsv(reportOrDetails: PreflightReport | PreflightRowDetail[]): string {
  const details = Array.isArray(reportOrDetails)
    ? reportOrDetails
    : (reportOrDetails.details ?? []);

  const headers = ['Row', 'Status', 'Reason', 'Payload'];
  const rows = details.map((item) =>
    [
      escapeCsvCell(item.rowNumber),
      escapeCsvCell(item.category),
      escapeCsvCell(item.reason ?? ''),
      escapeCsvCell(item.payload ?? ''),
    ].join(',')
  );

  return [headers.join(','), ...rows].join('\r\n');
}

/**
 * Derives a sanitized preflight CSV report file name based on the source CSV file name.
 * Falls back to `qrcraftly-preflight-report.csv` if file name is missing, has no extension,
 * or contains only invalid characters.
 *
 * @param fileName Source file name.
 * @returns Sanitized CSV report file name.
 */
export function preflightReportFileName(fileName?: string): string {
  if (!fileName || !fileName.trim()) return 'qrcraftly-preflight-report.csv';
  const trimmed = fileName.trim();
  const hasExt = /\.[^/.]+$/.test(trimmed);
  if (!hasExt) return 'qrcraftly-preflight-report.csv';
  const rawStem = trimmed.replace(/\.[^/.]+$/, '');
  const stem = sanitizeFileStem(rawStem, '');
  if (!stem || /^_+$/.test(stem)) return 'qrcraftly-preflight-report.csv';
  return `${stem}-preflight-report.csv`;
}
