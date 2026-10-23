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

  it('returns empty string for empty input', async () => {
    const result = await parseExcelToCsv(new Uint8Array(0));
    expect(result).toBe('');
  });
});
