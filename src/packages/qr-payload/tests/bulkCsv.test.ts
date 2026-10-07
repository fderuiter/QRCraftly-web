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

import { describe, it, expect } from 'vitest';
import { BulkCsvContract, constructBulkCsvString, hydrateBulkCsvData } from '../index';
import { QRType } from '@/types';

describe('BulkCsvContract', () => {
  const data = (csvContent: string, payloadColumn = '') => ({
    csvContent,
    payloadColumn,
    filenameColumn: '',
    exportFormat: 'png' as const,
  });

  it('previews the first row with a payload, not the whole CSV (#1110)', () => {
    const csv = 'name,url\nA,\nB,https://b.example\nC,https://c.example';
    expect(constructBulkCsvString(data(csv, 'url'))).toBe('https://b.example');
    expect(constructBulkCsvString(data(csv, 'name'))).toBe('A');
  });

  it('falls back to the detected payload column when none is chosen', () => {
    expect(constructBulkCsvString(data('id,link\n1,https://a.example'))).toBe('https://a.example');
  });

  it('is empty for an empty or unreadable CSV, or one with no payloads', () => {
    expect(constructBulkCsvString(data(''))).toBe('');
    expect(constructBulkCsvString(data('url\n"unterminated'))).toBe('');
    expect(constructBulkCsvString(data('url,name\n,A', 'url'))).toBe('');
  });

  it('hydrates BulkCsvData correctly', () => {
    const raw = 'col1,col2\nval1,val2';
    const hydrated = hydrateBulkCsvData(raw);
    expect(hydrated.csvContent).toBe(raw);
    expect(hydrated.exportFormat).toBe('png');
    expect(hydrated.exportResolution).toBe(1000);
  });

  it('implements BulkCsvContract contract correctly', () => {
    expect(BulkCsvContract.type).toBe(QRType.BULK_CSV);
    expect(BulkCsvContract.matches('col1,col2')).toBe(false);
    expect(BulkCsvContract.validate?.('col1,col2')).toEqual([]);
  });
});
