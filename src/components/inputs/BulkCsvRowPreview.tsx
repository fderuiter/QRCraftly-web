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
import type { CsvRow, BulkContentType, BulkContactMapping } from '@/packages/bulk-csv';
import { isContactContentType } from '@/packages/bulk-csv';

// Data rows shown in the preview table.
export const PREVIEW_ROW_COUNT = 3;

export interface BulkCsvRowPreviewProps {
  /** Parsed data rows, in file order. */
  rows: CsvRow[];
  /** Spreadsheet row number of each entry in `rows` (blank lines counted). */
  rowNumbers: number[];
  /** Selected Content Column. The table shows nothing without it (in link/text mode). */
  payloadColumn?: string;
  /** Selected File Name Column. */
  filenameColumn?: string;
  /** Batch content type. */
  contentType?: BulkContentType;
  /** Column mapping for contact card mode. */
  contactMapping?: BulkContactMapping;
}

// Cell text cut to a fixed width with an ellipsis. The full value stays in the DOM for screen readers and the tooltip.
const CELL_TEXT_CLASS = 'block max-w-xs truncate';

/**
 * Compact table of the first rows of the uploaded CSV, showing the mapped columns
 * and the File Name Column so the person can check the mapping before generating.
 * Renders from the props only: nothing is parsed, stored or sent here.
 */
export const BulkCsvRowPreview: React.FC<BulkCsvRowPreviewProps> = ({
  rows,
  rowNumbers,
  payloadColumn = '',
  filenameColumn = '',
  contentType = 'link',
  contactMapping,
}) => {
  const sample = rows.slice(0, PREVIEW_ROW_COUNT);
  const isContact = isContactContentType(contentType);

  if (sample.length === 0) return null;
  if (!isContact && !payloadColumn) return null;

  interface PreviewCol {
    name: string;
    role: string;
    isContent: boolean;
  }

  const columnsToShow: PreviewCol[] = [];
  const seenColumns = new Set<string>();

  if (isContact) {
    const contactRoles: { key: keyof BulkContactMapping; label: string }[] = [
      { key: 'firstName', label: 'First Name' },
      { key: 'lastName', label: 'Last Name' },
      { key: 'organization', label: 'Organization' },
      { key: 'title', label: 'Job Title' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' },
    ];

    if (contactMapping) {
      for (const { key, label } of contactRoles) {
        const col = contactMapping[key];
        if (col && !seenColumns.has(col)) {
          seenColumns.add(col);
          columnsToShow.push({ name: col, role: label, isContent: true });
        }
      }
    }

    if (filenameColumn && !seenColumns.has(filenameColumn)) {
      seenColumns.add(filenameColumn);
      columnsToShow.push({ name: filenameColumn, role: 'File name', isContent: false });
    }

    if (columnsToShow.length === 0) return null;
  } else {
    // Single-column link / text mode
    const cols =
      filenameColumn && filenameColumn !== payloadColumn
        ? [payloadColumn, filenameColumn]
        : [payloadColumn];
    for (const col of cols) {
      columnsToShow.push({
        name: col,
        role: col === payloadColumn ? 'Content' : 'File name',
        isContent: col === payloadColumn,
      });
    }
  }

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
            {columnsToShow.map(({ name, role, isContent }) => (
              <th
                key={name}
                scope="col"
                className={`max-w-xs px-3 py-2 text-left font-semibold ${isContent ? 'bg-accent-soft text-accent-strong' : 'text-fg-soft'}`}
              >
                <span className="block truncate" title={name}>
                  {name}
                </span>
                <span className={`block font-medium uppercase ${isContent ? 'text-accent-strong' : 'text-fg-muted'}`}>
                  {role}
                </span>
              </th>
            ))}
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
                {columnsToShow.map(({ name, isContent }) => {
                  const value = row[name] ?? '';
                  return (
                    <td
                      key={name}
                      className={`max-w-xs px-3 py-2 align-top ${isContent ? 'bg-accent-soft text-accent-strong' : 'text-fg'}`}
                    >
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
