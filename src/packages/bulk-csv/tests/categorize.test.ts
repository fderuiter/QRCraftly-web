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

import { describe, it, expect } from 'vitest';
import { categorizeCsvRows, type CsvRow } from '../index';

describe('categorizeCsvRows Engine', () => {
  it('returns empty report when rows array or payload column is empty', () => {
    const report1 = categorizeCsvRows([], 'URL');
    expect(report1.totalRows).toBe(0);
    expect(report1.validCount).toBe(0);

    const report2 = categorizeCsvRows([{ URL: 'https://example.com' }], '');
    expect(report2.totalRows).toBe(1);
    expect(report2.validCount).toBe(0);
  });

  it('correctly categorizes mixed CSV rows into Valid, Empty, Unsafe, and Caution', () => {
    const rows: CsvRow[] = [
      { URL: 'https://example.com/1', Name: 'Valid 1' },
      { URL: '', Name: 'Empty 1' },
      { URL: '   ', Name: 'Empty 2' },
      { URL: 'javascript:alert(1)', Name: 'Unsafe 1' },
      { URL: 'data:text/html;base64,PHNjcmlwdD4=', Name: 'Unsafe 2' },
      { URL: 'https://paypa1.com/login', Name: 'Caution 1' },
      { URL: 'https://example.com/2', Name: 'Valid 2' },
    ];

    const report = categorizeCsvRows(rows, 'URL');

    expect(report.totalRows).toBe(7);
    expect(report.validCount).toBe(3); // 2 clean valid + 1 caution
    expect(report.emptyCount).toBe(2);
    expect(report.unsafeCount).toBe(2);
    expect(report.cautionCount).toBe(1);

    // invalidDetails should list row numbers 2, 3, 4, 5, 6
    expect(report.invalidDetails).toHaveLength(5);
    expect(report.invalidDetails.map((d) => d.rowNumber)).toEqual([2, 3, 4, 5, 6]);

    const categories = report.invalidDetails.map((d) => d.category);
    expect(categories).toEqual(['empty', 'empty', 'unsafe', 'unsafe', 'caution']);

    // validRows should contain rows 1, 6, 7
    expect(report.validRows).toHaveLength(3);
    expect(report.validRows.map((r) => r.Name)).toEqual(['Valid 1', 'Caution 1', 'Valid 2']);
  });

  it('runs within 50ms for 500 rows (MAX_BULK_CSV_ROWS)', () => {
    const rows: CsvRow[] = Array.from({ length: 500 }, (_, i) => ({
      URL: i % 10 === 0 ? '' : i % 15 === 0 ? 'javascript:alert(1)' : `https://example.com/${i}`,
      Name: `Name_${i}`,
    }));

    const startTime = performance.now();
    const report = categorizeCsvRows(rows, 'URL');
    const duration = performance.now() - startTime;

    expect(report.totalRows).toBe(500);
    expect(duration).toBeLessThan(50);
  });
});
