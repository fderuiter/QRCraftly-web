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
import React, { useState, useEffect, useMemo, ChangeEvent } from 'react';
import {
  parseCsv,
  createZip,
  sanitizeFileStem,
  allocateFileName,
  CsvParseError,
  MAX_BULK_CSV_ROWS,
  MAX_BULK_CSV_CHARS,
  type CsvRow,
  type CsvTable,
  type ZipEntry,
  previewRow,
  pickColumn,
  hasPayload,
  PAYLOAD_COLUMN_PATTERN,
  FILENAME_COLUMN_PATTERN,
} from '@/packages/bulk-csv';
import { BulkCsvData, QRConfig, QRType } from '@/types';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SelectField } from '../ui/FormFields';
import { useToast } from '../ui/Toast';
import { useQRStoreSelector } from '@/context/QRContext';
import { generateQRSvg, rasterizeSvgToCanvas } from '@/packages/qr-export';
import { validateConfig, describeViolation } from '@/packages/qr-payload';
import { analyseLink } from '@/packages/link-safety';
import { triggerFileDownload } from '@/utils/downloadManager';
import { FileSpreadsheet, Upload, AlertTriangle, Loader2 } from 'lucide-react';

export interface BulkCsvInputProps {
  data: BulkCsvData;
  onChange: (updates: Partial<BulkCsvData>) => void;
}

interface RowError {
  rowIndex: number;
  message: string;
}

/** A row left out of the batch because its payload failed the same checks as the single generator. */
interface SkippedRow {
  /** 1-based data row number (the header is not counted). */
  rowNumber: number;
  reason: string;
}

/** Row count above which the main-thread processing warning is shown. */
const LARGE_BATCH_WARNING_ROWS = 100;
const PNG_EXPORT_SIZE = 1000;

type ParseOutcome = { table: CsvTable; error: null } | { table: null; error: string };

const EMPTY_OUTCOME: ParseOutcome = {
  table: { headers: [], rows: [], totalRows: 0, truncated: false },
  error: null,
};

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
  return value === 'png' || value === 'svg';
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

  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [skippedRows, setSkippedRows] = useState<SkippedRow[]>([]);

  const outcome = useMemo(() => parseContent(data.csvContent), [data.csvContent]);
  const columns = useMemo(() => outcome.table?.headers ?? [], [outcome]);
  const rows = useMemo(() => outcome.table?.rows ?? [], [outcome]);

  const payloadCol = columns.includes(data.payloadColumn)
    ? data.payloadColumn
    : pickColumn(columns, PAYLOAD_COLUMN_PATTERN);
  const filenameCol = columns.includes(data.filenameColumn)
    ? data.filenameColumn
    : pickColumn(columns, FILENAME_COLUMN_PATTERN);
  const exportFormat = data.exportFormat || 'png';
  const rowCount = rows.length;
  const preview = useMemo(() => previewRow(data.csvContent, payloadCol), [data.csvContent, payloadCol]);

  // Rows whose address looks disguised (a lookalike, a shortener, an IP address). Only a hint:
  // they are still generated, and the people who own the file may well mean them.
  const unusualRows = useMemo(() => {
    if (!payloadCol) return [];
    return rows.flatMap((row, index) => {
      const cautions = analyseLink((row[payloadCol] ?? '').trim()).filter((finding) => finding.severity === 'caution');
      return cautions.length > 0 ? [{ rowNumber: index + 1, message: cautions.map((finding) => finding.message).join(' ') }] : [];
    });
  }, [rows, payloadCol]);

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
      const content = await file.text();
      onChange({ csvContent: content, fileName: file.name });
      addToast({ type: 'success', message: `Successfully loaded ${file.name}`, duration: 3000 });
    } catch {
      addToast({ type: 'error', message: `Failed to read file ${file.name}`, duration: 5000 });
    }
  };

  const startBatchGeneration = async (validRowsOnly = false) => {
    if (!payloadCol) {
      addToast({
        type: 'error',
        message: 'Please select a payload column before generating batch.',
        duration: 4000,
      });
      return;
    }

    const currentErrors: RowError[] = [];
    rows.forEach((row, index) => {
      if (!hasPayload(row, payloadCol)) {
        currentErrors.push({
          rowIndex: index + 1,
          message: `Row ${index + 1}: Empty value in payload column '${payloadCol}'`,
        });
      }
    });
    if (!validRowsOnly && currentErrors.length > 0) {
      setRowErrors(currentErrors);
      setShowErrorModal(true);
      return;
    }

    // Every row goes through the same validation as the single generator (script and data links,
    // schemes outside the allowlist, hidden characters). Blocked rows are skipped and listed.
    const skipped: SkippedRow[] = [];
    const targetRows: CsvRow[] = [];
    rows.forEach((row, index) => {
      if (!hasPayload(row, payloadCol)) return;
      const value = (row[payloadCol] ?? '').trim();
      const violations = validateConfig({ ...currentConfig, value, type: QRType.URL });
      if (violations.length > 0) {
        skipped.push({ rowNumber: index + 1, reason: violations.map(describeViolation).join(' ') });
      } else {
        targetRows.push(row);
      }
    });
    setSkippedRows(skipped);
    if (targetRows.length === 0) {
      addToast({
        type: 'error',
        message:
          skipped.length > 0
            ? 'Every row was blocked by the safety checks, so no ZIP was made.'
            : 'No valid rows found to generate QR codes.',
        duration: 5000,
      });
      return;
    }

    setShowErrorModal(false);
    setIsGenerating(true);
    setCompletedCount(0);
    setTotalCount(targetRows.length);

    try {
      const entries: ZipEntry[] = [];
      const usedNames = new Set<string>();

      for (let i = 0; i < targetRows.length; i++) {
        const row = targetRows[i];
        const stem = sanitizeFileStem(row[filenameCol] ?? '', `qr_${i + 1}`);
        const name = allocateFileName(stem, exportFormat, usedNames);
        const rowConfig: QRConfig = {
          ...currentConfig,
          value: (row[payloadCol] ?? '').trim(),
          type: QRType.URL,
        };

        const svgString = await generateQRSvg(rowConfig);
        if (exportFormat === 'svg') {
          entries.push({ name, data: svgString });
        } else {
          const canvas = await rasterizeSvgToCanvas(svgString, PNG_EXPORT_SIZE, PNG_EXPORT_SIZE);
          entries.push({ name, data: await canvasToPngBytes(canvas) });
        }

        setCompletedCount(i + 1);
        // Yield to the main thread so the progress dialog can repaint.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const zipFileName = data.fileName
        ? `${sanitizeFileStem(data.fileName.replace(/\.[^/.]+$/, ''), 'qr-codes')}-qrcodes.zip`
        : 'qr-codes-batch.zip';
      triggerFileDownload(createZip(entries), zipFileName, 'application/zip');

      addToast({
        type: 'success',
        message:
          skipped.length > 0
            ? `Downloaded a ZIP with ${targetRows.length} QR codes. ${skipped.length} unsafe ${skipped.length === 1 ? 'row was' : 'rows were'} skipped.`
            : `Generated and downloaded ZIP with ${targetRows.length} QR codes!`,
        duration: 5000,
      });
    } catch (err) {
      console.error('Batch generation failed:', err);
      addToast({
        type: 'error',
        message: 'Failed to generate batch QR codes. Please try again.',
        duration: 5000,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const fileInput = (label: string) => (
    <input
      type="file"
      aria-label={label}
      accept=".csv, .txt, text/csv, text/plain"
      className="sr-only"
      onChange={handleFileUpload}
    />
  );

  return (
    <div className="space-y-6">
      {!data.csvContent ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-800/50">
          <FileSpreadsheet className="size-12 text-teal-600 dark:text-teal-400" />
          <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white">
            Upload CSV or TXT File
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Upload a `.csv` or `.txt` file with a header row. Up to {MAX_BULK_CSV_ROWS} rows are
            processed, entirely in your browser.
          </p>
          <label className="mt-4 cursor-pointer">
            <span className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-800 focus:ring-2 focus:ring-teal-500 focus:outline-hidden">
              <Upload className="size-4" />
              Choose File
            </span>
            {fileInput('Upload CSV or TXT file')}
          </label>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="size-5 text-teal-600 dark:text-teal-400" />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {data.fileName || 'Uploaded CSV'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {rowCount} rows found • {columns.length} columns detected
                </p>
              </div>
            </div>
            <label className="cursor-pointer text-xs font-medium text-teal-700 hover:underline dark:text-teal-400">
              Change File
              {fileInput('Change CSV or TXT file')}
            </label>
          </div>

          {skippedRows.length > 0 && (
            <Alert variant="warning" title={`${skippedRows.length} ${skippedRows.length === 1 ? 'row was' : 'rows were'} skipped`}>
              <p>These rows were left out of the ZIP because their content failed the safety checks:</p>
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

          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              id="bulk-payload-column"
              label="Payload Column (QR Content)"
              value={payloadCol}
              onChange={(e) => onChange({ payloadColumn: e.target.value })}
            >
              {columns.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </SelectField>

            <SelectField
              id="bulk-filename-column"
              label="Filename Column"
              value={filenameCol}
              onChange={(e) => onChange({ filenameColumn: e.target.value })}
            >
              {columns.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
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
            </SelectField>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-400" data-testid="bulk-preview-row">
            {preview
              ? `Preview: row ${preview.rowNumber} of ${preview.rowCount}. Each row becomes its own QR code in the ZIP.`
              : 'No row has a value in the payload column, so there is nothing to preview.'}
          </p>

          <div className="pt-2">
            <Button
              variant="primary"
              fullWidth
              onClick={() => startBatchGeneration(false)}
              disabled={isGenerating || rowCount === 0}
              className="flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating Batch ZIP...
                </>
              ) : (
                'Generate Batch'
              )}
            </Button>
          </div>
        </div>
      )}

      <Modal
        isOpen={showErrorModal}
        onClose={() => setShowErrorModal(false)}
        title="CSV Row Validation Errors"
      >
        <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
          <div className="flex items-center gap-2 font-semibold text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-5" />
            Found {rowErrors.length} row(s) with missing payload values:
          </div>
          <div className="max-h-48 overflow-y-auto rounded-lg bg-slate-100 p-3 font-mono text-xs dark:bg-slate-800">
            {rowErrors.map((err) => (
              <p key={err.rowIndex} className="text-rose-600 dark:text-rose-400">
                {err.message}
              </p>
            ))}
          </div>
          <p className="text-xs">
            Would you like to skip these invalid rows and generate QR codes for the valid rows?
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" size="sm" onClick={() => setShowErrorModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => startBatchGeneration(true)}>
              Skip Bad Rows & Continue
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isGenerating} onClose={() => {}} title="Generating Batch QR Codes">
        <div className="space-y-4 py-2 text-center">
          <div className="flex justify-center">
            <Loader2 className="size-10 animate-spin text-teal-600 dark:text-teal-400" />
          </div>
          <p
            className="text-base font-semibold text-slate-900 dark:text-white"
            id="batch-progress-status"
            aria-live="polite"
          >
            {completedCount} of {totalCount} QR codes generated
          </p>
          {skippedRows.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {skippedRows.length} unsafe {skippedRows.length === 1 ? 'row' : 'rows'} skipped. The list stays on screen when this finishes.
            </p>
          )}
          <Progress labelledBy="batch-progress-status" value={completedCount} max={totalCount} />
        </div>
      </Modal>
    </div>
  );
};
