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
import { SAMPLE_CSV_TEMPLATE, parseCsv } from '../index';

describe('SAMPLE_CSV_TEMPLATE', () => {
  it('contains valid headers url and filename and parses cleanly', () => {
    expect(SAMPLE_CSV_TEMPLATE).toBeDefined();
    expect(SAMPLE_CSV_TEMPLATE).toContain('url,filename');

    const table = parseCsv(SAMPLE_CSV_TEMPLATE);
    expect(table.headers).toEqual(['url', 'filename']);
    expect(table.rows.length).toBeGreaterThan(0);
    expect(table.rows[0]).toHaveProperty('url');
    expect(table.rows[0]).toHaveProperty('filename');
  });
});
