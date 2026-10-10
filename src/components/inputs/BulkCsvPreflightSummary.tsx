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
import { Badge, type BadgeTone } from '../ui/Badge';

/** Badge text per row category. A skipped row is not always a safety problem (it may be too long, say). */
const CATEGORY_LABELS: Readonly<Record<PreflightRowDetail['category'], string>> = {
  valid: 'valid',
  empty: 'empty',
  unsafe: 'skipped',
  caution: 'caution',
};

/** Badge colour per row category. */
const CATEGORY_TONES: Readonly<Record<PreflightRowDetail['category'], BadgeTone>> = {
  valid: 'success',
  empty: 'neutral',
  unsafe: 'danger',
  caution: 'warning',
};

type MetricTone = 'neutral' | 'success' | 'danger' | 'warning';

/** Card and text colours per metric tone. */
const METRIC_TONES: Readonly<Record<MetricTone, { card: string; label: string; value: string }>> = {
  neutral: { card: 'border-line bg-surface', label: 'text-fg-muted', value: 'text-fg' },
  success: { card: 'border-success-line bg-success-soft', label: 'text-success', value: 'text-success' },
  danger: { card: 'border-danger-line bg-danger-soft', label: 'text-danger', value: 'text-danger' },
  warning: { card: 'border-warning-line bg-warning-soft', label: 'text-warning', value: 'text-warning' },
};

/** One count in the metrics grid. */
const Metric: React.FC<{ label: string; value: number; testId: string; tone: MetricTone; icon?: React.ComponentType<{ className?: string }> }> = ({
  label,
  value,
  testId,
  tone,
  icon: Icon,
}) => (
  <div className={`flex flex-col rounded-lg border p-2.5 text-center shadow-2xs ${METRIC_TONES[tone].card}`}>
    <span className={`flex items-center justify-center gap-1 text-xs font-medium ${METRIC_TONES[tone].label}`}>
      {Icon && <Icon className="size-3.5" aria-hidden="true" />}
      {label}
    </span>
    <span className={`mt-1 text-lg font-bold ${METRIC_TONES[tone].value}`} data-testid={testId}>
      {value}
    </span>
  </div>
);

export interface BulkCsvPreflightSummaryProps {
  report: PreflightReport;
}

export const BulkCsvPreflightSummary: React.FC<BulkCsvPreflightSummaryProps> = ({ report }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const hasIssues = report.invalidDetails.length > 0;
  const isAllValid = !hasIssues && report.totalRows > 0;

  return (
    <div className="rounded-xl border border-line bg-surface-sunken p-4 shadow-2xs transition-all" data-testid="preflight-summary-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex items-center gap-2.5">
          <FileSpreadsheet className="size-5 text-accent" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-fg">Preflight Validation Report</h3>
        </div>

        <div className="flex items-center gap-2">
          {isAllValid && (
            <Badge tone="success" className="gap-1.5 px-2.5 font-medium">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              All {report.totalRows} rows valid
            </Badge>
          )}
          {hasIssues && (
            <Badge tone="warning" className="gap-1.5 px-2.5 font-medium">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {report.invalidDetails.length} {report.invalidDetails.length === 1 ? 'row requires' : 'rows require'} attention
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-5" data-testid="preflight-metrics-grid">
        <Metric label="Total Rows" value={report.totalRows} testId="count-total" tone="neutral" />
        <Metric label="Valid" value={report.validCount} testId="count-valid" tone="success" icon={CheckCircle2} />
        <Metric label="Empty" value={report.emptyCount} testId="count-empty" tone="neutral" icon={AlertCircle} />
        {/* Rows left out: their content fails the payload checks */}
        <Metric label="Skipped" value={report.unsafeCount} testId="count-unsafe" tone="danger" icon={XCircle} />
        <Metric label="Caution" value={report.cautionCount} testId="count-caution" tone="warning" icon={AlertTriangle} />
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
            className="flex items-center gap-1.5 text-xs text-fg-soft hover:text-fg"
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
              className="mt-2.5 max-h-60 overflow-y-auto rounded-lg border border-line bg-surface p-3"
            >
              <ul className="space-y-2 text-xs" data-testid="preflight-details-list">
                {report.invalidDetails.map((item: PreflightRowDetail) => (
                  <li
                    key={item.rowNumber}
                    className="flex flex-wrap items-start justify-between gap-2 border-b border-line-subtle pb-2 last:border-0 last:pb-0"
                  >
                    <div className="flex items-start gap-2">
                      <span className="font-mono font-semibold text-fg-soft">Row {item.rowNumber}:</span>
                      <span className="text-fg">{item.reason}</span>
                    </div>

                    <Badge tone={CATEGORY_TONES[item.category]} className="rounded-xs px-1.5 tracking-wider uppercase">
                      {CATEGORY_LABELS[item.category]}
                    </Badge>
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
