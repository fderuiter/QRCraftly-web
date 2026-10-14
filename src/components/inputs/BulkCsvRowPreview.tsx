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
import type { CsvRow } from '@/packages/bulk-csv';

// Data rows shown in the preview table.
export const PREVIEW_ROW_COUNT = 3;

export interface BulkCsvRowPreviewProps {
  /** Parsed data rows, in file order. */
  rows: CsvRow[];
  /** Spreadsheet row number of each entry in `rows` (blank lines counted). */
  rowNumbers: number[];
  /** Selected Content Column. The table shows nothing without it. */
  payloadColumn: string;
  /** Selected File Name Column. */
  filenameColumn: string;
}

// Cell text cut to a fixed width with an ellipsis. The full value stays in the DOM for screen readers and the tooltip.
const CELL_TEXT_CLASS = 'block max-w-xs truncate';

/**
 * Compact table of the first rows of the uploaded CSV, showing the Content Column and the File
 * Name Column so the person can check the mapping before generating. The content column is
 * highlighted and labelled in its heading, so the choice does not rely on colour alone.
 * Renders from the props only: nothing is parsed, stored or sent here.
 * @param props - The component props.
 * @param props.rows - Parsed data rows.
 * @param props.rowNumbers - Spreadsheet row numbers of the rows.
 * @param props.payloadColumn - Selected Content Column.
 * @param props.filenameColumn - Selected File Name Column.
 * @returns The preview table, or null when there is no column or row to show.
 */
export const BulkCsvRowPreview: React.FC<BulkCsvRowPreviewProps> = ({ rows, rowNumbers, payloadColumn, filenameColumn }) => {
  const sample = rows.slice(0, PREVIEW_ROW_COUNT);
  if (!payloadColumn || sample.length === 0) return null;

  // A column chosen for both roles is shown once, under the content role.
  const columns = filenameColumn && filenameColumn !== payloadColumn ? [payloadColumn, filenameColumn] : [payloadColumn];
  const roleOf = (column: string) => (column === payloadColumn ? 'Content' : 'File name');

  return (
    <div className="overflow-x-auto rounded-lg border border-line" data-testid="bulk-row-preview">
      <table className="w-full border-collapse text-left text-xs">
        <caption className="border-b border-line-subtle bg-surface-sunken px-3 py-2 text-left text-xs font-medium text-fg-soft">
          {sample.length === 1 ? 'First row' : `First ${sample.length} rows`}
        </caption>
        <thead>
          <tr className="border-b border-line-subtle">
            <th scope="col" className="px-3 py-2 text-left font-semibold text-fg-soft">
              Row
            </th>
            {columns.map((column) => {
              const isContent = column === payloadColumn;
              return (
                <th
                  key={column}
                  scope="col"
                  className={`max-w-xs px-3 py-2 text-left font-semibold ${isContent ? 'bg-accent-soft text-accent-strong' : 'text-fg-soft'}`}
                >
                  <span className="block truncate" title={column}>
                    {column}
                  </span>
                  <span className={`block font-medium uppercase ${isContent ? 'text-accent-strong' : 'text-fg-muted'}`}>{roleOf(column)}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sample.map((row, index) => {
            const rowNumber = rowNumbers[index] ?? index + 1;
            return (
              <tr key={rowNumber} className="border-b border-line-subtle last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-mono font-normal text-fg-muted">
                  {rowNumber}
                </th>
                {columns.map((column) => {
                  const value = row[column] ?? '';
                  const isContent = column === payloadColumn;
                  return (
                    <td key={column} className={`max-w-xs px-3 py-2 align-top ${isContent ? 'bg-accent-soft text-accent-strong' : 'text-fg'}`}>
                      {value.trim() === '' ? (
                        <span className="text-fg-muted italic">blank</span>
                      ) : (
                        <span className={CELL_TEXT_CLASS} title={value}>
                          {value}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
