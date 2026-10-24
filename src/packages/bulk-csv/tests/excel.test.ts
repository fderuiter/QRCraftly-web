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
import { readFileSync } from 'node:fs';
import { parseExcelToCsv } from '../index';

function createStoredZip(files: { name: string; content: string }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const cdHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const contentBytes = new TextEncoder().encode(file.content);

    const localHeader = new Uint8Array(30 + nameBytes.length + contentBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint32(10, 0, true);
    view.setUint32(14, 0, true);
    view.setUint32(18, contentBytes.length, true);
    view.setUint32(22, contentBytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);
    localHeader.set(contentBytes, 30 + nameBytes.length);

    parts.push(localHeader);

    const cdEntry = new Uint8Array(46 + nameBytes.length);
    const cdView = new DataView(cdEntry.buffer);
    cdView.setUint32(0, 0x02014b50, true);
    cdView.setUint16(4, 20, true);
    cdView.setUint16(6, 20, true);
    cdView.setUint16(8, 0, true);
    cdView.setUint16(10, 0, true);
    cdView.setUint32(12, 0, true);
    cdView.setUint32(16, 0, true);
    cdView.setUint32(20, contentBytes.length, true);
    cdView.setUint32(24, contentBytes.length, true);
    cdView.setUint16(28, nameBytes.length, true);
    cdView.setUint16(30, 0, true);
    cdView.setUint16(32, 0, true);
    cdView.setUint16(34, 0, true);
    cdView.setUint16(36, 0, true);
    cdView.setUint32(38, 0, true);
    cdView.setUint32(42, offset, true);
    cdEntry.set(nameBytes, 46);

    cdHeaders.push(cdEntry);
    offset += localHeader.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const cd of cdHeaders) {
    parts.push(cd);
    cdSize += cd.length;
  }

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, cdStart, true);
  eocdView.setUint16(20, 0, true);

  parts.push(eocd);

  const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const part of parts) {
    result.set(part, pos);
    pos += part.length;
  }
  return result;
}

describe('Excel WebAssembly Parser', () => {
  it('returns empty string for plain text/CSV input passed to excel parser', async () => {
    const text = 'URL,Name\nhttps://example.com,Test';
    const result = await parseExcelToCsv(new TextEncoder().encode(text));
    expect(result).toBe('');
  });

  it('parses valid .xlsx workbook zip', async () => {
    const zip = createStoredZip([
      {
        name: 'xl/worksheets/sheet1.xml',
        content:
          '<worksheet><sheetData><row><c t="inlineStr"><is><t>URL</t></is></c><c t="inlineStr"><is><t>Name</t></is></c></row><row><c t="inlineStr"><is><t>https://example.com/excel1</t></is></c><c t="inlineStr"><is><t>Excel1</t></is></c></row></sheetData></worksheet>',
      },
    ]);
    const result = await parseExcelToCsv(zip);
    expect(result).toBe('URL,Name\nhttps://example.com/excel1,Excel1');
  });

  it('parses multi-sheet workbooks by extracting the first sheet', async () => {
    const zip = createStoredZip([
      {
        name: 'xl/worksheets/sheet1.xml',
        content:
          '<worksheet><sheetData><row><c t="inlineStr"><is><t>Sheet1_Col</t></is></c></row></sheetData></worksheet>',
      },
      {
        name: 'xl/worksheets/sheet2.xml',
        content:
          '<worksheet><sheetData><row><c t="inlineStr"><is><t>Sheet2_Col</t></is></c></row></sheetData></worksheet>',
      },
    ]);
    const result = await parseExcelToCsv(zip);
    expect(result).toBe('Sheet1_Col');
  });

  it('handles empty workbooks / empty sheet XML', async () => {
    const zip = createStoredZip([
      {
        name: 'xl/worksheets/sheet1.xml',
        content: '<worksheet><sheetData/></worksheet>',
      },
    ]);
    const result = await parseExcelToCsv(zip);
    expect(result).toBe('');
  });

  it('parses HTML table .xls format', async () => {
    const html = '<table><tr><td>Website</td><td>Label</td></tr><tr><td>https://example.com</td><td>Sample</td></tr></table>';
    const result = await parseExcelToCsv(new TextEncoder().encode(html));
    expect(result).toBe('Website,Label\nhttps://example.com,Sample');
  });

  it('returns empty string for legacy binary .xls OLE2 header bytes', async () => {
    const ole2Bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const result = await parseExcelToCsv(ole2Bytes);
    expect(result).toBe('');
  });

  it('returns empty string for corrupt zip file without sheet XML', async () => {
    const corruptZip = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x00,
      0x00, 0x00, 0x72, 0x65, 0x61, 0x64, 0x6d, 0x65, 0x2e, 0x74, 0x78, 0x74,
    ]);
    const result = await parseExcelToCsv(corruptZip);
    expect(result).toBe('');
  });

  it('returns empty string for empty input', async () => {
    const result = await parseExcelToCsv(new Uint8Array(0));
    expect(result).toBe('');
  });

  it('parses a DEFLATE-compressed .xlsx written by a reference encoder (same CSV as the Rust test)', async () => {
    // Fixture written by Python's zipfile with ZIP_DEFLATED, not by a spreadsheet app.
    // crates/excel-parse/tests/deflated_workbook.rs checks the same expected CSV.
    const fixture = new Uint8Array(
      readFileSync(new URL('../../../../crates/excel-parse/tests/fixtures/deflated-workbook.xlsx', import.meta.url)),
    );
    const result = await parseExcelToCsv(fixture);
    expect(result).toBe(
      [
        'Name,URL,,Score',
        '"Smith, Jane",https://example.com/?a=1&b=2,,42',
        '"Say ""hi""",https://example.com/inline,,7.5',
        'Tom & Jerry,,,0',
      ].join('\n'),
    );
  });
});
