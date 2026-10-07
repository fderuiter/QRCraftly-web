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

import { DEFAULT_CONFIG } from '@/constants';
import { type CsvRow } from './csv';
import { hasPayload } from './preview';
import { analyseLink, type LinkFinding } from '@/packages/link-safety';
import { QRConfig, QRType } from '@/types';
import {
  isDangerousUrl,
  REGEX_STRICT_CONTROL_CHARS,
  REGEX_BIDI_CONTROL_CHARS,
} from '@/utils/security';

export type PreflightRowStatus = 'valid' | 'empty' | 'unsafe' | 'caution';

export interface PreflightRowDetail {
  /** 1-based data row index (ignoring header). */
  rowNumber: number;
  /** Primary status category for this row. */
  category: PreflightRowStatus;
  /** Human-readable explanation if row is empty, unsafe, or has caution warning. */
  reason?: string;
  /** Raw or trimmed string value from payload column. */
  payload?: string;
}

export interface PreflightReport {
  /** Total number of parsed data rows in the CSV. */
  totalRows: number;
  /** Number of rows with valid, generateable payloads (including caution rows). */
  validCount: number;
  /** Number of rows missing a value in the payload column. */
  emptyCount: number;
  /** Number of rows failing URL safety checks. */
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
}

function defaultValidateConfig(config: QRConfig): string[] {
  const violations: string[] = [];
  if (config.borderText && REGEX_STRICT_CONTROL_CHARS.test(config.borderText)) {
    violations.push('Border Text contains invalid control characters');
  }
  if (config.templateHeadline && REGEX_STRICT_CONTROL_CHARS.test(config.templateHeadline)) {
    violations.push('Template Headline contains invalid control characters');
  }
  if (config.value) {
    if (REGEX_STRICT_CONTROL_CHARS.test(config.value)) {
      violations.push('Value contains invalid control characters');
    }
    if (REGEX_BIDI_CONTROL_CHARS.test(config.value)) {
      violations.push('Value contains hidden text-direction characters');
    }
    if (isDangerousUrl(config.value)) {
      violations.push('Unsafe URL scheme or dangerous payload detected');
    }
  }
  return violations;
}

/**
 * Synchronously categorizes parsed CSV rows into Valid, Empty, Unsafe, and Caution buckets.
 * Operates in browser memory without network calls.
 *
 * @param rows CSV data rows.
 * @param payloadColumn Header name of the column containing QR payloads.
 * @param config Active QR configuration.
 * @param customValidator Optional custom validator function for QR configuration.
 * @returns PreflightReport with detailed categorization metrics and row issues.
 */
export function categorizeCsvRows(
  rows: CsvRow[],
  payloadColumn: string,
  config?: Partial<QRConfig>,
  customValidator?: (config: QRConfig) => string[]
): PreflightReport {
  const details: PreflightRowDetail[] = [];
  const invalidDetails: PreflightRowDetail[] = [];
  const validRows: CsvRow[] = [];
  const validRowIndices: number[] = [];

  let validCount = 0;
  let emptyCount = 0;
  let unsafeCount = 0;
  let cautionCount = 0;

  if (!rows || rows.length === 0 || !payloadColumn) {
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
    };
  }

  const baseConfig: QRConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    value: '',
    type: QRType.URL,
  };

  const validateFn = customValidator ?? defaultValidateConfig;
  const validateCache = new Map<string, string[]>();
  const analyseCache = new Map<string, LinkFinding[]>();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const rawValue = row[payloadColumn] ?? '';
    const trimmedValue = rawValue.trim();

    // 1. Missing payload check
    if (!hasPayload(row, payloadColumn)) {
      emptyCount += 1;
      const detail: PreflightRowDetail = {
        rowNumber,
        category: 'empty',
        reason: `Missing value in payload column '${payloadColumn}'`,
        payload: rawValue,
      };
      details.push(detail);
      invalidDetails.push(detail);
      return;
    }

    // 2. URL safety check
    let violations = validateCache.get(trimmedValue);
    if (!violations) {
      const rowConfig: QRConfig = {
        ...baseConfig,
        value: trimmedValue,
        type: QRType.URL,
      };
      violations = validateFn(rowConfig);
      validateCache.set(trimmedValue, violations);
    }

    if (violations.length > 0) {
      unsafeCount += 1;
      const reason = violations.join(' ');
      const detail: PreflightRowDetail = {
        rowNumber,
        category: 'unsafe',
        reason,
        payload: trimmedValue,
      };
      details.push(detail);
      invalidDetails.push(detail);
      return;
    }

    // 3. Link caution check
    let findings = analyseCache.get(trimmedValue);
    if (!findings) {
      findings = analyseLink(trimmedValue);
      analyseCache.set(trimmedValue, findings);
    }

    const cautions = findings.filter((f) => f.severity === 'caution');
    if (cautions.length > 0) {
      cautionCount += 1;
      validCount += 1;
      const reason = cautions.map((f) => f.message).join(' ');
      const detail: PreflightRowDetail = {
        rowNumber,
        category: 'caution',
        reason,
        payload: trimmedValue,
      };
      details.push(detail);
      invalidDetails.push(detail);
      validRows.push(row);
      validRowIndices.push(index);
      return;
    }

    // 4. Valid row
    validCount += 1;
    const detail: PreflightRowDetail = {
      rowNumber,
      category: 'valid',
      payload: trimmedValue,
    };
    details.push(detail);
    validRows.push(row);
    validRowIndices.push(index);
  });

  return {
    totalRows: rows.length,
    validCount,
    emptyCount,
    unsafeCount,
    cautionCount,
    details,
    invalidDetails,
    validRows,
    validRowIndices,
  };
}
