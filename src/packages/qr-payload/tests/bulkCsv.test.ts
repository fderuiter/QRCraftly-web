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
import { encodeBulkCell, parseCsv } from '@/packages/bulk-csv';

describe('BulkCsvContract', () => {
  const data = (csvContent: string, payloadColumn = '', contentType: 'link' | 'text' = 'link') => ({
    csvContent,
    payloadColumn,
    filenameColumn: '',
    exportFormat: 'png' as const,
    contentType,
  });

  it('previews the first row with a payload, not the whole CSV (#1110)', () => {
    const csv = 'name,url\nA,\nB,https://b.example\nC,https://c.example';
    expect(constructBulkCsvString(data(csv, 'url'))).toBe('https://b.example/');
    expect(constructBulkCsvString(data(csv, 'name', 'text'))).toBe('A');
  });

  it('falls back to the detected payload column when none is chosen', () => {
    expect(constructBulkCsvString(data('id,link\n1,https://a.example'))).toBe('https://a.example/');
  });

  it('previews exactly what the ZIP encodes for that row (#1285)', () => {
    const cells = ['example.com', 'https://example.com/my file.pdf', 'Order no. 5', '"BEGIN:VCARD\nFN:Jane Doe\nEND:VCARD"'];
    for (const contentType of ['link', 'text'] as const) {
      for (const cell of cells) {
        const csv = `qr\n${cell}`;
        const table = parseCsv(csv);
        expect(constructBulkCsvString(data(csv, 'qr', contentType))).toBe(encodeBulkCell(table.rows[0].qr, contentType));
      }
    }
    expect(constructBulkCsvString(data('qr\nexample.com', 'qr'))).toBe('https://example.com/');
    expect(constructBulkCsvString(data('qr\nhttps://example.com/my file.pdf', 'qr'))).toBe('https://example.com/my%20file.pdf');
    expect(constructBulkCsvString(data('qr\n"BEGIN:VCARD\nFN:Jane Doe\nEND:VCARD"', 'qr', 'text'))).toBe(
      'BEGIN:VCARD\nFN:Jane Doe\nEND:VCARD'
    );
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
