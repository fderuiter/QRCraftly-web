/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import { Progress } from '../ui/Progress';
import { BulkCsvDropZone } from './BulkCsvDropZone';
import React, { useState, useEffect, useMemo, useCallback, useRef, type ChangeEvent } from 'react';
import {
  parseCsv,
  decodeCsvBytes,
  createZip,
  CsvParseError,
  MAX_BULK_CSV_ROWS,
  MAX_BULK_CSV_CHARS,
  type CsvTable,
  previewRow,
  pickColumn,
  PAYLOAD_COLUMN_WORDS,
  FILENAME_COLUMN_WORDS,
  SAMPLE_CSV_TEMPLATE,
  categorizeCsvRows,
  runBatch,
  batchRows,
  batchZipName,
  batchPngSize,
  skippedFromReport,
  type BulkContentType,
  type SkippedRow,
} from '@/packages/bulk-csv';
import { BulkCsvPreflightSummary } from './BulkCsvPreflightSummary';
import { BulkCsvRowPreview } from './BulkCsvRowPreview';
import { type BulkCsvData, type QRConfig, QRType } from '@/types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SelectField } from '../ui/FormFields';
import { useToast } from '../ui/Toast';
import { useQRStoreSelector } from '@/context/QRContext';
import {
  generateQRSvg,
  rasterizeSvgToCanvas,
  preflightLogoCheck,
  SOCIAL_DIMENSIONS,
  MissingImageError,
  convertSvgToEps,
  convertSvgToPdf,
} from '@/packages/qr-export';
import { QrEncodeError } from '@/packages/qr-matrix';
import { validateConfig, describeViolation } from '@/packages/qr-payload';
import { triggerFileDownload } from '@/utils/downloadManager';
import { FileSpreadsheet, Upload, Download, Loader2, Sparkles, ArrowLeftRight } from 'lucide-react';

export interface BulkCsvInputProps {
  data: BulkCsvData;
  onChange: (updates: Partial<BulkCsvData>) => void;
}

/** Row count above which the main-thread processing warning is shown. */
const LARGE_BATCH_WARNING_ROWS = 100;

type ParseOutcome = { table: CsvTable; error: null } | { table: null; error: string };

const EMPTY_OUTCOME: ParseOutcome = {
  table: { headers: [], rows: [], totalRows: 0, truncated: false, rowNumbers: [], delimiter: ',' },
  error: null,
};

const DELIMITER_NAMES: Readonly<Record<string, string>> = { ';': 'semicolon', '\t': 'tab' };

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

function parseContent(csvContent: string): ParseOutcome {
  if (!csvContent) return EMPTY_OUTCOME;
  try {
    return { table: parseCsv(csvContent, { maxRows: MAX_BULK_CSV_ROWS }), error: null };
  } catch (err) {
    if (err instanceof CsvParseError) return { table: null, error: err.message };
    throw err;
  }
}

function isExportFormat(value: string): value is BulkCsvData['exportFormat'] {
  return value === 'png' || value === 'svg' || value === 'eps' || value === 'pdf';
}

function isContentType(value: string): value is BulkContentType {
  return value === 'link' || value === 'text';
}

/** Plain-language reason a row that passed the checks still could not be turned into an image. */
function describeRowFailure(err: unknown, errorCorrectionLevel: string): string {
  if (err instanceof QrEncodeError && err.kind === 'too-long') {
    return `Too long for a QR code at error correction level ${errorCorrectionLevel}. Shorten it, or pick a lower level in Appearance.`;
  }
  if (err instanceof Error && (err.name === 'MissingImageError' || err.message.toLowerCase().includes('logo'))) {
    return `Custom logo asset could not be rendered: ${err.message}`;
  }
  return 'This row could not be drawn as a QR code.';
}

/**
 * Encodes a canvas as PNG bytes. Uses `toBlob`, and falls back to decoding the
 * data URL where `toBlob` is unavailable or yields nothing (for example jsdom).
 */
async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/png');
    } catch {
      resolve(null);
    }
  });
  if (blob) return new Uint8Array(await blob.arrayBuffer());

  const dataUrl = canvas.toDataURL('image/png');
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/**
 * Bulk CSV Batch input: parses an uploaded CSV in memory, lets the user map the
 * payload and file name columns, and downloads one ZIP of PNG or SVG QR codes.
 * Nothing is persisted or sent over the network.
 */
export const BulkCsvInput: React.FC<BulkCsvInputProps> = ({ data, onChange }) => {
  const currentConfig = useQRStoreSelector((state) => state.config);
  const { addToast } = useToast();

  const [isGenerating, setIsGenerating] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [skippedRows, setSkippedRows] = useState<SkippedRow[]>([]);
  // The running batch checks this after every row, so Cancel or leaving the page stops it.
  const runRef = useRef<{ cancelled: boolean; unmounted: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chooseFile = () => fileInputRef.current?.click();

  const outcome = useMemo(() => parseContent(data.csvContent), [data.csvContent]);
  const columns = useMemo(() => outcome.table?.headers ?? [], [outcome]);
  const rows = useMemo(() => outcome.table?.rows ?? [], [outcome]);
  const rowNumbers = useMemo(() => outcome.table?.rowNumbers ?? [], [outcome]);
  const delimiterName = DELIMITER_NAMES[outcome.table?.delimiter ?? ','];

  const payloadCol = columns.includes(data.payloadColumn)
    ? data.payloadColumn
    : pickColumn(columns, PAYLOAD_COLUMN_WORDS, { exclude: '', rows, kind: 'payload' });
  const filenameCol = columns.includes(data.filenameColumn)
    ? data.filenameColumn
    : pickColumn(columns, FILENAME_COLUMN_WORDS, { exclude: payloadCol, rows, kind: 'filename' });

  const autoPayloadCol = useMemo(
    () => pickColumn(columns, PAYLOAD_COLUMN_WORDS, { exclude: '', rows, kind: 'payload' }),
    [columns, rows]
  );
  const autoFilenameCol = useMemo(
    () => pickColumn(columns, FILENAME_COLUMN_WORDS, { exclude: payloadCol, rows, kind: 'filename' }),
    [columns, rows, payloadCol]
  );

  const isPayloadAutoMatched = !data.payloadColumn || data.payloadColumn === autoPayloadCol;
  const isFilenameAutoMatched = !data.filenameColumn || data.filenameColumn === autoFilenameCol;
  const exportFormat = data.exportFormat || 'png';
  const contentType: BulkContentType = data.contentType ?? 'link';
  const rowCount = rows.length;
  const preview = useMemo(
    () => previewRow(data.csvContent, payloadCol, contentType),
    [data.csvContent, payloadCol, contentType]
  );

  const validateRowConfig = useCallback((cfg: QRConfig) => {
    return validateConfig(cfg).map(describeViolation);
  }, []);

  // The row check reads only the design text (each row brings its own value and type), so
  // colour or size changes don't re-check every row.
  const { borderText, templateHeadline, templateSubtext, frameText } = currentConfig;
  const preflightReport = useMemo(() => {
    if (rows.length === 0 || !payloadCol) return null;
    const designText = { borderText, templateHeadline, templateSubtext, frameText };
    return categorizeCsvRows(rows, payloadCol, designText, validateRowConfig, { contentType, rowNumbers });
  }, [rows, payloadCol, borderText, templateHeadline, templateSubtext, frameText, validateRowConfig, contentType, rowNumbers]);

  // The preview row is left out of the ZIP: say so beside the preview, with the same reason.
  const previewProblem = useMemo(() => {
    if (!preview || !preflightReport) return null;
    return preflightReport.invalidDetails.find((d) => d.rowNumber === preview.rowNumber && d.category === 'unsafe') ?? null;
  }, [preview, preflightReport]);

  const buttonText = useMemo(() => {
    if (isGenerating) return 'Generating ZIP…';
    if (!preflightReport || preflightReport.validCount === 0) return 'No Valid Rows to Generate';
    if (preflightReport.emptyCount > 0 || preflightReport.unsafeCount > 0) {
      return `Generate Batch for ${preflightReport.validCount} Valid Rows`;
    }
    return 'Generate Batch';
  }, [isGenerating, preflightReport]);

  // Rows whose address looks disguised (a lookalike, a shortener, an IP address). Only a hint:
  // they are still generated, and the people who own the file may well mean them.
  const unusualRows = useMemo(
    () =>
      (preflightReport?.invalidDetails ?? [])
        .filter((d) => d.category === 'caution')
        .map((d) => ({ rowNumber: d.rowNumber, message: d.reason ?? '' })),
    [preflightReport]
  );

  // A skipped-rows list belongs to the file and settings it was made from.
  useEffect(() => {
    setSkippedRows([]);
  }, [data.csvContent, payloadCol, contentType]);

  // Leaving the page stops a running batch, so no ZIP downloads on another page.
  useEffect(
    () => () => {
      if (runRef.current) Object.assign(runRef.current, { cancelled: true, unmounted: true });
    },
    []
  );

  // Store the detected column defaults so the selection survives re-renders.
  useEffect(() => {
    if (columns.length === 0) return;
    const updates: Partial<BulkCsvData> = {};
    if (payloadCol !== data.payloadColumn) updates.payloadColumn = payloadCol;
    if (filenameCol !== data.filenameColumn) updates.filenameColumn = filenameCol;
    if (Object.keys(updates).length > 0) onChange(updates);
  }, [columns, payloadCol, filenameCol, data.payloadColumn, data.filenameColumn, onChange]);

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (file.size > MAX_BULK_CSV_CHARS) {
      addToast({
        type: 'error',
        message: `${file.name} is too large. The limit is ${MAX_BULK_CSV_CHARS / (1024 * 1024)} MB.`,
        duration: 5000,
      });
      return;
    }

    try {
      const isExcel =
        /\.(xlsx|xls)$/i.test(file.name) ||
        file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.type === 'application/vnd.ms-excel';

      let content: string;
      if (isExcel) {
        const arrayBuffer = await file.arrayBuffer();
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
          addToast({ type: 'error', message: `Could not read ${file.name}. Choose the file again.`, duration: 5000 });
          return;
        }
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        if (!worksheet || !worksheet['!ref']) {
          addToast({ type: 'error', message: `Could not read ${file.name}. Choose the file again.`, duration: 5000 });
          return;
        }
        content = XLSX.utils.sheet_to_csv(worksheet);
        if (!content || content.trim() === '') {
          addToast({ type: 'error', message: `Could not read ${file.name}. Choose the file again.`, duration: 5000 });
          return;
        }
      } else {
        content = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      }

      onChange({ csvContent: content, fileName: file.name });
      addToast({ type: 'success', message: `Loaded ${file.name}.`, duration: 3000 });
    } catch {
      addToast({ type: 'error', message: `Could not read ${file.name}. Choose the file again.`, duration: 5000 });
    }
  };

  const handleDownloadTemplate = () => {
    const bytes = new TextEncoder().encode(SAMPLE_CSV_TEMPLATE);
    triggerFileDownload(bytes, 'qrcraftly-sample-template.csv', 'text/csv');
  };

  const startBatchGeneration = async () => {
    if (!payloadCol) {
      addToast({
        type: 'error',
        message: 'Pick a Content Column first. It holds what goes in each code.',
        duration: 4000,
      });
      return;
    }

    const report =
      preflightReport || categorizeCsvRows(rows, payloadCol, currentConfig, validateRowConfig, { contentType, rowNumbers });
    const preflightSkipped = skippedFromReport(report);
    setSkippedRows(preflightSkipped);

    if (report.validRows.length === 0) {
      addToast({
        type: 'error',
        message:
          preflightSkipped.length > 0
            ? 'None of the rows can be used, so no ZIP was made. The list says why.'
            : 'No valid rows found to generate QR codes.',
        duration: 5000,
      });
      return;
    }

    const run = { cancelled: false, unmounted: false };
    runRef.current = run;
    setIsGenerating(true);
    setCompletedCount(0);
    setTotalCount(report.validRows.length);

    if (exportFormat === 'png' && (currentConfig.logoUrl || (currentConfig.isBorderEnabled && currentConfig.borderLogoUrl))) {
      const logoCheck = await preflightLogoCheck(currentConfig, { timeoutMs: 3000 });
      if (run.cancelled) {
        // Canceled while the logo was checked: close the progress dialog, which the loop below never opened.
        if (runRef.current === run) {
          runRef.current = null;
          setIsGenerating(false);
        }
        if (!run.unmounted) addToast({ type: 'info', message: 'Batch canceled. No ZIP was made.', duration: 4000 });
        return;
      }
      if (!logoCheck.ok) {
        setIsGenerating(false);
        runRef.current = null;
        addToast({
          type: 'error',
          message: logoCheck.error || 'Could not load custom logo asset from the provided URL. Please check the logo URL or remove the logo before exporting PNG files.',
          duration: 5000,
        });
        return;
      }
    }

    // PNGs keep the design's shape: the chosen resolution is the width, the height follows the format.
    const png = batchPngSize(data.exportResolution || 1000, SOCIAL_DIMENSIONS[currentConfig.socialFormat] ?? { width: 1, height: 1 });
    let remoteLogoOmitted = false;
    // Each row encodes its checked, previewed string as is (the Text type adds no further rewriting).
    const render = async (payload: string) => {
      const svgString = await generateQRSvg(
        { ...currentConfig, value: payload, type: QRType.TEXT },
        {
          onLogoOmitted: () => {
            remoteLogoOmitted = true;
          },
        }
      );
      if (exportFormat === 'png') return canvasToPngBytes(await rasterizeSvgToCanvas(svgString, png.width, png.height));
      if (exportFormat === 'eps') return convertSvgToEps(svgString);
      if (exportFormat === 'pdf') return convertSvgToPdf(svgString);
      return svgString;
    };

    try {
      const result = await runBatch(batchRows(report, filenameCol, rowNumbers), {
        format: exportFormat,
        render,
        // The same custom logo fails vector conversion on every row, so that stops the batch.
        stopOn: (err) => err instanceof MissingImageError,
        // Any other row that cannot be drawn (too long, an image that never loads) costs that row only.
        describeFailure: (err) => describeRowFailure(err, currentConfig.errorCorrectionLevel),
        isCancelled: () => run.cancelled,
        onProgress: (done, drawSkipped) => {
          setCompletedCount(done);
          if (drawSkipped.length > 0) setSkippedRows([...preflightSkipped, ...drawSkipped]);
        },
      });
      const skippedCount = preflightSkipped.length + result.skipped.length;
      if (!run.unmounted && result.skipped.length > 0) setSkippedRows([...preflightSkipped, ...result.skipped]);

      if (result.stoppedBy) {
        addToast({
          type: 'error',
          message: "The logo couldn't be embedded in EPS/PDF files. Upload the logo again, or choose PNG or SVG.",
          duration: 5000,
        });
        return;
      }

      if (result.cancelled) {
        if (!run.unmounted) addToast({ type: 'info', message: 'Batch canceled. No ZIP was made.', duration: 4000 });
        return;
      }

      if (result.entries.length === 0) {
        addToast({
          type: 'error',
          message: 'None of the rows could be drawn as QR codes, so no ZIP was made. The list says why.',
          duration: 5000,
        });
        return;
      }

      triggerFileDownload(createZip(result.entries), batchZipName(data.fileName), 'application/zip');

      if (remoteLogoOmitted) {
        addToast({
          type: 'warning',
          message: 'The logo was left out of these codes because it could not be loaded from its web address. Upload the logo as an image file to include it.',
          duration: 5000,
        });
      } else {
        const made = plural(result.entries.length, 'QR code', 'QR codes');
        addToast({
          type: 'success',
          message:
            skippedCount > 0
              ? `Downloaded a ZIP with ${made}. ${plural(skippedCount, 'row was', 'rows were')} left out.`
              : `Downloaded a ZIP with ${made}.`,
          duration: 5000,
        });
      }
    } catch (err) {
      console.error('Batch generation failed:', err);
      addToast({
        type: 'error',
        message: 'The batch stopped before the ZIP was made. Try again, or try a smaller file.',
        duration: 5000,
      });
    } finally {
      if (runRef.current === run) {
        runRef.current = null;
        setIsGenerating(false);
      }
    }
  };

  const cancelBatch = () => {
    if (runRef.current) runRef.current.cancelled = true;
  };

  return (
    <div className="space-y-6">
      {/* One picker for both buttons; it stays out of the tab order, so focus lands on a visible button. */}
      <input
        ref={fileInputRef}
        type="file"
        aria-label={data.csvContent ? 'Change CSV, TXT, or Excel file' : 'Upload CSV, TXT, or Excel file'}
        accept=".csv, .txt, .xlsx, .xls, text/csv, text/plain, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
        className="sr-only"
        tabIndex={-1}
        onChange={handleFileUpload}
      />
      {!data.csvContent ? (
        <BulkCsvDropZone>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Button type="button" variant="primary" size="md" onClick={chooseFile} className="flex items-center gap-2">
              <Upload className="size-4" aria-hidden="true" />
              Choose File
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={handleDownloadTemplate}
              className="flex items-center gap-2"
            >
              <Download className="size-4" />
              Download Sample Template
            </Button>
          </div>
        </BulkCsvDropZone>
      ) : (
        <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-line-subtle pb-3">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="size-5 text-accent" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-fg">
                  {data.fileName || 'Uploaded CSV'}
                </p>
                <p className="text-xs text-fg-muted">
                  {rowCount} rows found • {columns.length} columns detected
                  {delimiterName && ` • ${delimiterName}-separated`}
                </p>
              </div>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={chooseFile}>
              Change File
            </Button>
          </div>

          {skippedRows.length > 0 && (
            <Alert variant="warning" title={`${skippedRows.length} ${skippedRows.length === 1 ? 'row was' : 'rows were'} skipped`}>
              <p>These rows were left out of the ZIP:</p>
              <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-xs" data-testid="bulk-skipped-rows">
                {skippedRows.map((row) => (
                  <li key={row.rowNumber}>
                    Row {row.rowNumber}: {row.reason}
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          {unusualRows.length > 0 && (
            <Alert variant="info" title={`${unusualRows.length} ${unusualRows.length === 1 ? 'address looks' : 'addresses look'} unusual`}>
              <p>These rows are still included. Check that each one is what you mean:</p>
              <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-xs" data-testid="bulk-unusual-rows">
                {unusualRows.slice(0, 50).map((row) => (
                  <li key={row.rowNumber}>
                    Row {row.rowNumber}: {row.message}
                  </li>
                ))}
              </ul>
              {unusualRows.length > 50 && <p className="mt-1 text-xs">And {unusualRows.length - 50} more.</p>}
            </Alert>
          )}

          {outcome.error && (
            <Alert variant="error" title="Could not read this CSV">
              {outcome.error}
            </Alert>
          )}

          {outcome.table?.truncated && (
            <Alert variant="warning" title="Row limit reached">
              This file has {outcome.table.totalRows} rows. Only the first {MAX_BULK_CSV_ROWS} are
              used in one batch; split the file to generate the rest.
            </Alert>
          )}

          {rowCount > LARGE_BATCH_WARNING_ROWS && (
            <Alert variant="warning" title="Main Thread Processing Warning">
              This CSV file contains {rowCount} rows (exceeding {LARGE_BATCH_WARNING_ROWS} rows).
              Processing large batches directly in the browser may cause brief UI unresponsiveness.
            </Alert>
          )}

          {/* Column Mapping Section */}
          <div className="space-y-4 rounded-xl border border-line bg-surface-sunken p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle pb-3">
              <div>
                <h3 className="text-sm font-semibold text-fg">Column Mapping</h3>
                <p className="text-xs text-fg-muted">Match your CSV columns to QR code content and file names</p>
              </div>
              {columns.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onChange({ payloadColumn: filenameCol, filenameColumn: payloadCol })}
                  className="flex items-center gap-1.5 text-xs"
                  aria-label="Swap payload and filename columns"
                  title="Swap Content and File Name columns"
                >
                  <ArrowLeftRight className="size-3.5" aria-hidden="true" />
                  Swap Columns
                </Button>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 rounded-lg border border-line bg-surface p-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-accent-strong uppercase">QR Content</span>
                  {isPayloadAutoMatched ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong"
                      data-testid="payload-auto-matched-badge"
                    >
                      <Sparkles className="size-3" aria-hidden="true" />
                      Auto-matched
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-xs font-medium text-fg-muted"
                      data-testid="payload-mapped-badge"
                    >
                      Mapped
                    </span>
                  )}
                </div>

                <SelectField
                  id="bulk-payload-column"
                  label="Content Column"
                  value={payloadCol}
                  aria-describedby="bulk-payload-column-desc"
                  onChange={(e) => onChange({ payloadColumn: e.target.value })}
                >
                  {columns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </SelectField>
                <span id="bulk-payload-column-desc" className="sr-only">
                  {isPayloadAutoMatched ? 'Auto-matched column choice' : 'Manually mapped column choice'}
                </span>

                {rows[0]?.[payloadCol] !== undefined && (
                  <div className="rounded bg-surface-sunken p-2 text-xs text-fg-muted" data-testid="bulk-payload-sample-preview">
                    <span className="mb-0.5 block text-xs font-medium tracking-wider text-fg-soft uppercase">Sample Cell</span>
                    <p className="truncate font-mono text-xs text-fg" title={rows[0][payloadCol]}>
                      {rows[0][payloadCol] || <span className="text-fg-muted italic">(empty)</span>}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-line bg-surface p-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-fg-soft uppercase">File Name</span>
                  {isFilenameAutoMatched ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong"
                      data-testid="filename-auto-matched-badge"
                    >
                      <Sparkles className="size-3" aria-hidden="true" />
                      Auto-matched
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-xs font-medium text-fg-muted"
                      data-testid="filename-mapped-badge"
                    >
                      Mapped
                    </span>
                  )}
                </div>

                <SelectField
                  id="bulk-filename-column"
                  label="File Name Column"
                  value={filenameCol}
                  aria-describedby="bulk-filename-column-desc"
                  onChange={(e) => onChange({ filenameColumn: e.target.value })}
                >
                  {columns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </SelectField>
                <span id="bulk-filename-column-desc" className="sr-only">
                  {isFilenameAutoMatched ? 'Auto-matched column choice' : 'Manually mapped column choice'}
                </span>

                {rows[0]?.[filenameCol] !== undefined && (
                  <div className="rounded bg-surface-sunken p-2 text-xs text-fg-muted" data-testid="bulk-filename-sample-preview">
                    <span className="mb-0.5 block text-xs font-medium tracking-wider text-fg-soft uppercase">Sample Cell</span>
                    <p className="truncate font-mono text-xs text-fg" title={rows[0][filenameCol]}>
                      {rows[0][filenameCol] || <span className="text-fg-muted italic">(empty)</span>}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="bulk-content-type"
              label="Content Type"
              value={contentType}
              onChange={(e) => {
                const value = e.target.value;
                if (isContentType(value)) onChange({ contentType: value });
              }}
            >
              <option value="link">Links (web addresses)</option>
              <option value="text">Plain text (exactly as typed)</option>
            </SelectField>

            <SelectField
              id="bulk-export-format"
              label="Image Format"
              value={exportFormat}
              onChange={(e) => {
                const value = e.target.value;
                if (isExportFormat(value)) onChange({ exportFormat: value });
              }}
            >
              <option value="png">PNG Image</option>
              <option value="svg">SVG Vector Image</option>
              <option value="eps">EPS Vector Image</option>
              <option value="pdf">PDF Document</option>
            </SelectField>

            {exportFormat === 'png' && (
              <SelectField
                id="bulk-export-resolution"
                label="PNG Width"
                value={String(data.exportResolution || 1000)}
                onChange={(e) => onChange({ exportResolution: Number(e.target.value) })}
              >
                <option value="500">500px</option>
                <option value="1000">1000px</option>
                <option value="2000">2000px</option>
                <option value="3000">3000px</option>
              </SelectField>
            )}
          </div>

          <BulkCsvRowPreview rows={rows} rowNumbers={rowNumbers} payloadColumn={payloadCol} filenameColumn={filenameCol} />

          {preflightReport && <BulkCsvPreflightSummary report={preflightReport} />}

          <p className="text-xs text-fg-muted" data-testid="bulk-preview-row">
            {preview
              ? `Preview: row ${preview.rowNumber}. Each row becomes its own QR code in the ZIP.`
              : 'No row has a value in the payload column, so there is nothing to preview.'}
            {previewProblem && ` This row is left out of the ZIP: ${previewProblem.reason}`}
          </p>

          <div className="pt-2">
            <Button
              variant="primary"
              fullWidth
              onClick={() => startBatchGeneration()}
              disabled={isGenerating || rowCount === 0 || !preflightReport || preflightReport.validCount === 0}
              className="flex items-center justify-center gap-2"
            >
              {isGenerating && <Loader2 className="size-4 animate-spin" />}
              {buttonText}
            </Button>
          </div>
        </div>
      )}

      <Modal isOpen={isGenerating} onClose={cancelBatch} closeLabel="Cancel batch" title="Generating Batch QR Codes">
        <div className="space-y-4 py-2 text-center">
          <div className="flex justify-center">
            <Loader2 className="size-10 animate-spin text-accent" />
          </div>
          <p
            className="text-base font-semibold text-fg"
            id="batch-progress-status"
            aria-live="polite"
          >
            {completedCount} of {totalCount} QR codes generated
          </p>
          {skippedRows.length > 0 && (
            <p className="text-xs text-warning">
              {plural(skippedRows.length, 'row', 'rows')} left out. The list stays on screen when this finishes.
            </p>
          )}
          <Progress labelledBy="batch-progress-status" value={completedCount} max={totalCount} />
          <Button type="button" variant="outline" size="md" onClick={cancelBatch}>
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
};
