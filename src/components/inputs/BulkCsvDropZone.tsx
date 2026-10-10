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

import React from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { MAX_BULK_CSV_ROWS } from '@/packages/bulk-csv';

interface BulkCsvDropZoneProps {
  /** The file picker, or a stand-in of the same size while the batch generator loads. */
  children: React.ReactNode;
}

/**
 * The empty state of the Bulk CSV Batch form: what to upload and the file picker. It is
 * pre-rendered by `LazyBulkCsvInput` too, so the page's main text paints with the HTML instead
 * of when the batch generator chunk arrives.
 * @param root0 - Component properties.
 * @param root0.children - The file picker.
 * @returns The drop zone.
 */
export function BulkCsvDropZone({ children }: BulkCsvDropZoneProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-line-strong bg-surface-sunken p-8 text-center">
      <FileSpreadsheet className="size-12 text-accent" aria-hidden="true" />
      <h3 className="mt-3 text-base font-semibold text-fg">Upload CSV or TXT File</h3>
      <p className="mt-1 text-xs text-fg-muted">
        Upload a `.csv` or `.txt` file with a header row. Up to {MAX_BULK_CSV_ROWS} rows are processed, entirely
        in your browser.
      </p>
      {children}
    </div>
  );
}
