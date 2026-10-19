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

import type { PreflightReport } from './categorize';
import { allocateFileName, sanitizeFileStem } from './fileNames';
import type { ZipEntry } from './zip';

/** A row left out of the batch: its payload failed the checks, or it could not be drawn. */
export interface SkippedRow {
  /** Data row number as a spreadsheet shows it (blank lines counted, the header not). */
  rowNumber: number;
  reason: string;
}

/** One row the batch draws: the checked payload and the stem its file is named from. */
export interface BatchRow {
  rowNumber: number;
  payload: string;
  fileStem: string;
}

/** File formats a batch can write; each is also the entry's extension. */
export type BatchFormat = 'png' | 'svg' | 'eps' | 'pdf';

/** Options for {@link runBatch}. The caller supplies the drawing, so this module stays free of the renderer. */
export interface RunBatchOptions {
  format: BatchFormat;
  /** Draws one payload as file contents (SVG or EPS text, PNG or PDF bytes). A throw skips that row only, unless `stopOn` says otherwise. */
  render: (payload: string) => Promise<ZipEntry['data']>;
  /** True for an error that would fail every row the same way (a logo that cannot be embedded): the batch stops there. */
  stopOn?: (err: unknown) => boolean;
  /** Plain-language reason for a row whose `render` threw. */
  describeFailure: (err: unknown) => string;
  /** Checked after every row; true stops the batch. */
  isCancelled: () => boolean;
  /** Called after every row with the rows done so far and the rows skipped so far. */
  onProgress?: (done: number, skipped: readonly SkippedRow[]) => void;
  /** Waits between rows so the page can repaint. Defaults to a zero-delay timer. */
  pause?: () => Promise<void>;
}

/** What {@link runBatch} produced. A cancelled or stopped batch keeps its partial entries, which callers discard. */
export interface BatchResult {
  entries: ZipEntry[];
  skipped: SkippedRow[];
  cancelled: boolean;
  /** The error `stopOn` accepted, when the batch stopped on one. */
  stoppedBy?: unknown;
}

const defaultPause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The rows the preflight check left out as unsafe, in row order, with their reasons. */
export function skippedFromReport(report: PreflightReport): SkippedRow[] {
  return report.invalidDetails
    .filter((d) => d.category === 'unsafe')
    .map((d) => ({ rowNumber: d.rowNumber, reason: d.reason || '' }));
}

/**
 * The rows a batch draws: each valid row's checked payload, its spreadsheet row number, and
 * the stem from its file name column (falling back to `qr_<row>`).
 */
export function batchRows(report: PreflightReport, filenameColumn: string, rowNumbers: readonly number[] = []): BatchRow[] {
  return report.validRows.map((row, i) => {
    const index = report.validRowIndices[i];
    const rowNumber = rowNumbers[index] ?? index + 1;
    return {
      rowNumber,
      payload: report.validPayloads[i],
      fileStem: sanitizeFileStem(row[filenameColumn] ?? '', `qr_${rowNumber}`),
    };
  });
}

/**
 * Draws every row into a ZIP entry with a unique file name. A row that cannot be drawn is
 * skipped with a reason and the batch carries on; cancelling stops it after the current row.
 */
export async function runBatch(rows: readonly BatchRow[], options: RunBatchOptions): Promise<BatchResult> {
  const { format, render, stopOn, describeFailure, isCancelled, onProgress, pause = defaultPause } = options;
  const entries: ZipEntry[] = [];
  const skipped: SkippedRow[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const data = await render(row.payload);
      entries.push({ name: allocateFileName(row.fileStem, format, usedNames), data });
    } catch (err) {
      if (stopOn?.(err)) return { entries, skipped, cancelled: false, stoppedBy: err };
      skipped.push({ rowNumber: row.rowNumber, reason: describeFailure(err) });
    }

    if (isCancelled()) return { entries, skipped, cancelled: true };
    onProgress?.(i + 1, skipped);
    await pause();
    if (isCancelled()) return { entries, skipped, cancelled: true };
  }
  return { entries, skipped, cancelled: false };
}

/** The ZIP's file name: `<csv name>-qrcodes.zip`, or `qr-codes-batch.zip` when there is no name. */
export function batchZipName(csvFileName?: string): string {
  if (!csvFileName) return 'qr-codes-batch.zip';
  return `${sanitizeFileStem(csvFileName.replace(/\.[^/.]+$/, ''), 'qr-codes')}-qrcodes.zip`;
}

/** PNG size for a batch: the chosen width, with the height following the design's aspect ratio. */
export function batchPngSize(width: number, aspect: { width: number; height: number }): { width: number; height: number } {
  return { width, height: Math.round((width * aspect.height) / aspect.width) };
}
