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
import { parseExcelToCsv } from '../index';

describe('Excel WebAssembly Parser', () => {
  it('parses plain text/CSV passthrough', async () => {
    const text = 'URL,Name\nhttps://example.com,Test';
    const result = await parseExcelToCsv(new TextEncoder().encode(text));
    expect(result).toBe('URL,Name\nhttps://example.com,Test');
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
});
