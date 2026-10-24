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

import { escapeCsvCell } from './csvEscape';

/** An item representing an error or skipped row in bulk CSV processing. */
export interface ErrorLogItem {
  /** 1-based data row number as shown in the spreadsheet. */
  rowNumber: number;
  /** Category of the error or issue (e.g. 'empty', 'unsafe', 'caution', or 'skipped'). */
  category?: string;
  /** Human-readable reason why the row was skipped or failed. */
  reason?: string;
  /** The payload cell content, if available. */
  payload?: string;
}

/**
 * Formats a list of skipped or invalid bulk CSV row items into UTF-8 CSV bytes according to RFC 4180.
 * Includes headers: Row Number, Category, Reason, Payload.
 *
 * @param items List of error or skipped row details.
 * @returns UTF-8 encoded CSV binary data.
 */
export function formatErrorLogCsv(items: readonly ErrorLogItem[]): Uint8Array {
  const headers = ['Row Number', 'Category', 'Reason', 'Payload'];
  const lines: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const item of items) {
    const rowNum = escapeCsvCell(item.rowNumber);
    const category = escapeCsvCell(item.category ?? 'skipped');
    const reasonText = item.reason && item.reason.trim() ? item.reason.trim() : 'Invalid or skipped row';
    const reason = escapeCsvCell(reasonText);
    const payload = escapeCsvCell(item.payload ?? '');
    lines.push(`${rowNum},${category},${reason},${payload}`);
  }

  const csvText = lines.join('\r\n') + '\r\n';
  return new TextEncoder().encode(csvText);
}
