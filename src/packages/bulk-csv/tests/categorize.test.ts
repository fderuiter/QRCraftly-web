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
import {
  categorizeCsvRows,
  escapeCsvCell,
  formatPreflightReportCsv,
  preflightReportFileName,
  type CsvRow,
  type PreflightRowDetail,
  type PreflightReport,
} from '../index';

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

  it('visits each of 500 rows (MAX_BULK_CSV_ROWS) exactly once', () => {
    const rows: CsvRow[] = Array.from({ length: 500 }, (_, i) => ({
      URL: i % 10 === 0 ? '' : i % 15 === 0 ? 'javascript:alert(1)' : `https://example.com/${i}`,
      Name: `Name_${i}`,
    }));

    const report = categorizeCsvRows(rows, 'URL');
    const allRowNumbers = Array.from({ length: 500 }, (_, i) => i + 1);

    expect(report.totalRows).toBe(500);

    // Every row lands in exactly one bucket: none skipped, none counted twice.
    expect(report.validCount + report.emptyCount + report.unsafeCount).toBe(500);
    expect(report.details.map((d) => d.rowNumber)).toEqual(allRowNumbers);

    // Valid row indices plus the empty/unsafe row indices partition 0..499 with no repeats.
    const rejectedIndices = report.details
      .filter((d) => d.category === 'empty' || d.category === 'unsafe')
      .map((d) => d.rowNumber - 1);
    expect(new Set(report.validRowIndices).size).toBe(report.validRowIndices.length);
    expect(report.validRowIndices).toHaveLength(report.validCount);
    expect([...report.validRowIndices, ...rejectedIndices].sort((a, b) => a - b)).toEqual(
      allRowNumbers.map((n) => n - 1)
    );
  });

  it('checks the string that is encoded, not the raw cell (#1285)', () => {
    const rows: CsvRow[] = [{ URL: 'https://example.com/my file.pdf' }, { URL: 'example.com' }];
    const seen: string[] = [];
    const report = categorizeCsvRows(rows, 'URL', {}, (cfg) => {
      seen.push(`${cfg.type}:${cfg.value}`);
      return [];
    });
    expect(seen).toEqual(['URL:https://example.com/my%20file.pdf', 'URL:https://example.com/']);
    expect(report.validPayloads).toEqual(['https://example.com/my%20file.pdf', 'https://example.com/']);
  });

  it('checks plain text as Text and keeps it as typed', () => {
    const vcard = 'BEGIN:VCARD\nFN:Jane Doe\nEND:VCARD';
    const seen: string[] = [];
    const report = categorizeCsvRows([{ qr: `  ${vcard}  ` }], 'qr', {}, (cfg) => {
      seen.push(cfg.type);
      return [];
    }, { contentType: 'text' });
    expect(seen).toEqual(['TEXT']);
    expect(report.validPayloads).toEqual([vcard]);
  });

  it('reports the spreadsheet row numbers it is given (#1291)', () => {
    const report = categorizeCsvRows([{ URL: 'https://example.com' }, { URL: 'javascript:alert(1)' }], 'URL', {}, undefined, {
      rowNumbers: [1, 4],
    });
    expect(report.invalidDetails.map((d) => d.rowNumber)).toEqual([4]);
  });
});

describe('escapeCsvCell', () => {
  it('escapes quotes, commas, and line breaks according to RFC 4180', () => {
    expect(escapeCsvCell('hello, world')).toBe('"hello, world"');
    expect(escapeCsvCell('hello "world"')).toBe('"hello ""world"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
    expect(escapeCsvCell('plain text')).toBe('plain text');
  });

  it('prevents spreadsheet formula injection by prefixing formula start characters', () => {
    expect(escapeCsvCell('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    expect(escapeCsvCell('+12345678')).toBe("'+12345678");
    expect(escapeCsvCell('-100')).toBe("'-100");
    expect(escapeCsvCell('@admin')).toBe("'@admin");
    expect(escapeCsvCell('\ttab')).toBe("'\ttab");
  });

  it('handles quotes and formula injection together', () => {
    expect(escapeCsvCell('=CMD("calc")')).toBe('"\'=CMD(""calc"")"');
    expect(escapeCsvCell('=1+1,2')).toBe('"\'=1+1,2"');
  });
});

describe('formatPreflightReportCsv', () => {
  it('formats PreflightRowDetail[] into RFC 4180 CSV string with headers', () => {
    const details: PreflightRowDetail[] = [
      { rowNumber: 2, category: 'empty', reason: "Missing value in payload column 'URL'", payload: '' },
      { rowNumber: 5, category: 'unsafe', reason: 'Unsafe URL scheme or dangerous payload detected', payload: 'javascript:alert(1)' },
      { rowNumber: 8, category: 'caution', reason: 'Lookalike domain detected', payload: 'https://paypa1.com/login' },
    ];

    const csv = formatPreflightReportCsv(details);
    const lines = csv.split('\r\n');

    expect(lines[0]).toBe('Row,Status,Reason,Payload');
    expect(lines[1]).toBe("2,empty,Missing value in payload column 'URL',");
    expect(lines[2]).toBe('5,unsafe,Unsafe URL scheme or dangerous payload detected,javascript:alert(1)');
    expect(lines[3]).toBe('8,caution,Lookalike domain detected,https://paypa1.com/login');
  });

  it('accepts PreflightReport object directly', () => {
    const report: PreflightReport = {
      totalRows: 3,
      validCount: 1,
      emptyCount: 1,
      unsafeCount: 1,
      cautionCount: 0,
      details: [
        { rowNumber: 1, category: 'valid', payload: 'https://example.com' },
        { rowNumber: 2, category: 'empty', reason: 'Missing payload', payload: '' },
        { rowNumber: 3, category: 'unsafe', reason: 'Unsafe payload', payload: 'javascript:void(0)' },
      ],
      invalidDetails: [
        { rowNumber: 2, category: 'empty', reason: 'Missing payload', payload: '' },
        { rowNumber: 3, category: 'unsafe', reason: 'Unsafe payload', payload: 'javascript:void(0)' },
      ],
      validRows: [],
      validRowIndices: [],
      validPayloads: [],
    };

    const csv = formatPreflightReportCsv(report);
    expect(csv).toContain('Row,Status,Reason,Payload');
    expect(csv).toContain('1,valid,,https://example.com');
    expect(csv).toContain('2,empty,Missing payload,');
    expect(csv).toContain('3,unsafe,Unsafe payload,javascript:void(0)');
  });
});

describe('preflightReportFileName', () => {
  it('derives sanitized preflight report file name from source file name', () => {
    expect(preflightReportFileName('my-batch.csv')).toBe('my-batch-preflight-report.csv');
    expect(preflightReportFileName('qr_data_2026.xlsx.csv')).toBe('qr_data_2026.xlsx-preflight-report.csv');
  });

  it('falls back to default report file name when file name is missing or invalid', () => {
    expect(preflightReportFileName()).toBe('qrcraftly-preflight-report.csv');
    expect(preflightReportFileName('')).toBe('qrcraftly-preflight-report.csv');
    expect(preflightReportFileName('   ')).toBe('qrcraftly-preflight-report.csv');
    expect(preflightReportFileName('noextension')).toBe('qrcraftly-preflight-report.csv');
    expect(preflightReportFileName('///.csv')).toBe('qrcraftly-preflight-report.csv');
  });
});

