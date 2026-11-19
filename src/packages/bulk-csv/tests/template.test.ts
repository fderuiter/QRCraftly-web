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
  BULK_CONTACT_FIELDS,
  SAMPLE_CSV_TEMPLATE,
  SAMPLE_TEXT_CSV_TEMPLATE,
  SAMPLE_VCARD_CSV_TEMPLATE,
  autoDetectContactMapping,
  categorizeCsvRows,
  getBulkCsvTemplate,
  parseCsv,
} from '../index';

describe('Bulk CSV starter templates', () => {
  it('contains valid headers url and filename in SAMPLE_CSV_TEMPLATE and parses cleanly', () => {
    expect(SAMPLE_CSV_TEMPLATE).toBeDefined();
    expect(SAMPLE_CSV_TEMPLATE).toContain('url,filename');

    const table = parseCsv(SAMPLE_CSV_TEMPLATE);
    expect(table.headers).toEqual(['url', 'filename']);
    expect(table.rows.length).toBeGreaterThan(0);
    expect(table.rows[0]).toHaveProperty('url');
    expect(table.rows[0]).toHaveProperty('filename');
  });

  it('contains valid headers text and filename in SAMPLE_TEXT_CSV_TEMPLATE and parses cleanly', () => {
    const table = parseCsv(SAMPLE_TEXT_CSV_TEMPLATE);
    expect(table.headers).toEqual(['text', 'filename']);
    expect(table.rows.length).toBeGreaterThan(0);
    expect(table.rows[0].text).toBeTruthy();
    expect(table.rows[0].filename).toBeTruthy();
  });

  it('derives SAMPLE_VCARD_CSV_TEMPLATE headers from BULK_CONTACT_FIELDS plus filename and auto-matches all 11 fields', () => {
    const table = parseCsv(SAMPLE_VCARD_CSV_TEMPLATE);
    expect(table.headers).toEqual([...BULK_CONTACT_FIELDS.map((f) => f.header), 'filename']);
    expect(table.rows.length).toBeGreaterThanOrEqual(2);

    const detected = autoDetectContactMapping(table.headers, table.rows);
    for (const field of BULK_CONTACT_FIELDS) {
      expect(detected[field.key]).toBe(field.header);
    }

    const report = categorizeCsvRows(table.rows, '', undefined, undefined, {
      contentType: 'vcard',
      contactMapping: detected,
    });
    expect(report.validCount).toBe(table.rows.length);
    expect(report.emptyCount).toBe(0);
    expect(report.unsafeCount).toBe(0);
    expect(report.cautionCount).toBe(0);
    expect(report.validPayloads[0]).toContain('URL:https://example.com/jane');
    expect(report.validPayloads[0]).toContain('ADR:;;100 Market St\\, Suite 400;San Francisco;;94105;United States');
  });

  it('returns the matching template CSV and download filename via getBulkCsvTemplate', () => {
    expect(getBulkCsvTemplate()).toEqual({
      csv: SAMPLE_CSV_TEMPLATE,
      fileName: 'qrcraftly-sample-template.csv',
    });
    expect(getBulkCsvTemplate('link')).toEqual({
      csv: SAMPLE_CSV_TEMPLATE,
      fileName: 'qrcraftly-sample-template.csv',
    });
    expect(getBulkCsvTemplate('text')).toEqual({
      csv: SAMPLE_TEXT_CSV_TEMPLATE,
      fileName: 'qrcraftly-text-template.csv',
    });
    expect(getBulkCsvTemplate('vcard')).toEqual({
      csv: SAMPLE_VCARD_CSV_TEMPLATE,
      fileName: 'qrcraftly-vcard-template.csv',
    });
    expect(getBulkCsvTemplate('contact')).toEqual({
      csv: SAMPLE_VCARD_CSV_TEMPLATE,
      fileName: 'qrcraftly-vcard-template.csv',
    });
  });
});
