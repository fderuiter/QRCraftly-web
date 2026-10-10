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

import { previewRow } from '@/packages/bulk-csv';
import { type BulkCsvData, QRType, type QRGeneratorContract } from '@/types';

/**
 * Constructs the live preview payload: the first row's value in the payload column, encoded
 * exactly as its code in the ZIP is, not the whole CSV, which would overflow a QR code (#1110).
 * Empty when no row has one.
 */
export const constructBulkCsvString = (data: BulkCsvData): string => {
  if (!data) return '';
  return previewRow(data.csvContent || '', data.payloadColumn || '', data.contentType ?? 'link')?.payload ?? '';
};

/**
 * Hydrates BulkCsvData from a raw string.
 */
export const hydrateBulkCsvData = (raw: string): BulkCsvData => {
  return {
    csvContent: raw || '',
    payloadColumn: '',
    filenameColumn: '',
    exportFormat: 'png',
    contentType: 'link',
    exportResolution: 1000,
  };
};

export const BulkCsvContract: QRGeneratorContract<BulkCsvData> = {
  type: QRType.BULK_CSV,
  construct: constructBulkCsvString,
  hydrate: hydrateBulkCsvData,
  matches: () => false,
  validate: () => [],
};
