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

import React, { useState } from 'react';
import { type PreflightReport, type PreflightRowDetail } from '@/packages/bulk-csv';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
} from 'lucide-react';
import { Button } from '../ui/Button';

/** Badge text per row category. A skipped row is not always a safety problem (it may be too long, say). */
const CATEGORY_LABELS: Readonly<Record<PreflightRowDetail['category'], string>> = {
  valid: 'valid',
  empty: 'empty',
  unsafe: 'skipped',
  caution: 'caution',
};

export interface BulkCsvPreflightSummaryProps {
  report: PreflightReport;
}

export const BulkCsvPreflightSummary: React.FC<BulkCsvPreflightSummaryProps> = ({ report }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const hasIssues = report.invalidDetails.length > 0;
  const isAllValid = !hasIssues && report.totalRows > 0;

  return (
    <div
      className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 shadow-2xs transition-all dark:border-slate-700 dark:bg-slate-800/60"
      data-testid="preflight-summary-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-3 dark:border-slate-700/80">
        <div className="flex items-center gap-2.5">
          <FileSpreadsheet className="size-5 text-teal-600 dark:text-teal-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Preflight Validation Report
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {isAllValid && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
              <CheckCircle2 className="size-3.5" />
              All {report.totalRows} rows valid
            </span>
          )}
          {hasIssues && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
              <AlertTriangle className="size-3.5" />
              {report.invalidDetails.length} {report.invalidDetails.length === 1 ? 'row requires' : 'rows require'} attention
            </span>
          )}
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-5" data-testid="preflight-metrics-grid">
        {/* Total Rows */}
        <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-2.5 text-center shadow-2xs dark:border-slate-700 dark:bg-slate-800">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Rows</span>
          <span className="mt-1 text-lg font-bold text-slate-900 dark:text-white" data-testid="count-total">
            {report.totalRows}
          </span>
        </div>

        {/* Valid Rows */}
        <div className="flex flex-col rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-center shadow-2xs dark:border-emerald-800/60 dark:bg-emerald-950/30">
          <span className="flex items-center justify-center gap-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5" />
            Valid
          </span>
          <span className="mt-1 text-lg font-bold text-emerald-700 dark:text-emerald-300" data-testid="count-valid">
            {report.validCount}
          </span>
        </div>

        {/* Empty Rows */}
        <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-2.5 text-center shadow-2xs dark:border-slate-700 dark:bg-slate-800">
          <span className="flex items-center justify-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
            <AlertCircle className="size-3.5" />
            Empty
          </span>
          <span className="mt-1 text-lg font-bold text-slate-700 dark:text-slate-300" data-testid="count-empty">
            {report.emptyCount}
          </span>
        </div>

        {/* Rows left out: their content fails the payload checks */}
        <div className="flex flex-col rounded-lg border border-rose-200 bg-rose-50/60 p-2.5 text-center shadow-2xs dark:border-rose-800/60 dark:bg-rose-950/30">
          <span className="flex items-center justify-center gap-1 text-xs font-medium text-rose-800 dark:text-rose-300">
            <XCircle className="size-3.5" />
            Skipped
          </span>
          <span className="mt-1 text-lg font-bold text-rose-700 dark:text-rose-300" data-testid="count-unsafe">
            {report.unsafeCount}
          </span>
        </div>

        {/* Caution Warnings */}
        <div className="flex flex-col rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-center shadow-2xs dark:border-amber-800/60 dark:bg-amber-950/30">
          <span className="flex items-center justify-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-3.5" />
            Caution
          </span>
          <span className="mt-1 text-lg font-bold text-amber-700 dark:text-amber-300" data-testid="count-caution">
            {report.cautionCount}
          </span>
        </div>
      </div>

      {hasIssues && (
        <div className="mt-3.5 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            aria-controls="preflight-details-panel"
            data-testid="preflight-expand-toggle"
            className="flex items-center gap-1.5 text-xs text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="size-4" />
                Hide Row Details
              </>
            ) : (
              <>
                <ChevronDown className="size-4" />
                View {report.invalidDetails.length} Problematic {report.invalidDetails.length === 1 ? 'Row' : 'Rows'}
              </>
            )}
          </Button>

          {isExpanded && (
            <div
              id="preflight-details-panel"
              data-testid="preflight-details-panel"
              className="mt-2.5 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/90"
            >
              <ul className="space-y-2 text-xs" data-testid="preflight-details-list">
                {report.invalidDetails.map((item: PreflightRowDetail) => (
                  <li
                    key={item.rowNumber}
                    className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 last:pb-0 dark:border-slate-700/60"
                  >
                    <div className="flex items-start gap-2">
                      <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                        Row {item.rowNumber}:
                      </span>
                      <span className="text-slate-800 dark:text-slate-200">{item.reason}</span>
                    </div>

                    <span
                      className={`inline-flex shrink-0 items-center rounded-xs px-1.5 py-0.5 text-xs font-semibold tracking-wider uppercase ${
                        item.category === 'empty'
                          ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                          : item.category === 'unsafe'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      }`}
                    >
                      {CATEGORY_LABELS[item.category]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
