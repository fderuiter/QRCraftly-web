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
import {
  BulkCsvContract,
  constructBulkCsvString,
  hydrateBulkCsvData,
  autoDetectContactMapping,
  synthesizeVCardPayload,
} from '../index';
import { QRType } from '@/packages/core/types';
import { encodeBulkCell, parseCsv, type BulkContentType, type BulkContactMapping } from '@/packages/bulk-csv';

describe('BulkCsvContract', () => {
  const data = (
    csvContent: string,
    payloadColumn = '',
    contentType: BulkContentType = 'link',
    contactMapping?: BulkContactMapping
  ) => ({
    csvContent,
    payloadColumn,
    filenameColumn: '',
    exportFormat: 'png' as const,
    contentType,
    contactMapping,
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

  describe('autoDetectContactMapping', () => {
    it('detects standard contact headers accurately', () => {
      const headers = ['First Name', 'Last Name', 'Work Phone', 'Email Address', 'Company Name', 'Job Title'];
      const mapping = autoDetectContactMapping(headers);
      expect(mapping.firstName).toBe('First Name');
      expect(mapping.lastName).toBe('Last Name');
      expect(mapping.phone).toBe('Work Phone');
      expect(mapping.email).toBe('Email Address');
      expect(mapping.organization).toBe('Company Name');
      expect(mapping.title).toBe('Job Title');
    });

    it('falls back to generic Name column for firstName when no separate first/last name exists', () => {
      const headers = ['Name', 'Mobile', 'Email', 'Organization'];
      const mapping = autoDetectContactMapping(headers);
      expect(mapping.firstName).toBe('Name');
      expect(mapping.lastName).toBeUndefined();
      expect(mapping.phone).toBe('Mobile');
      expect(mapping.email).toBe('Email');
      expect(mapping.organization).toBe('Organization');
    });

    it('detects email and phone from sample rows when headers are ambiguous', () => {
      const headers = ['ColA', 'ColB', 'ColC'];
      const rows = [
        { ColA: 'Alice', ColB: 'alice@example.com', ColC: '+1-555-0199' },
        { ColB: 'bob@example.com', ColC: '+1-555-0188', ColA: 'Bob' },
      ];
      const mapping = autoDetectContactMapping(headers, rows);
      expect(mapping.email).toBe('ColB');
      expect(mapping.phone).toBe('ColC');
    });
  });

  describe('synthesizeVCardPayload', () => {
    it('synthesizes valid RFC 6350 vCard payload from mapped contact fields', () => {
      const row = {
        fname: 'Jane',
        lname: 'Doe',
        tel: '+1 555 123 4567',
        mail: 'jane.doe@example.com',
        org: 'Acme Corp',
        role: 'Lead Architect',
      };
      const mapping: BulkContactMapping = {
        firstName: 'fname',
        lastName: 'lname',
        phone: 'tel',
        email: 'mail',
        organization: 'org',
        title: 'role',
      };
      const result = synthesizeVCardPayload(row, mapping);
      expect(result.hasAnyData).toBe(true);
      expect(result.hasIdentity).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.payload).toContain('BEGIN:VCARD');
      expect(result.payload).toContain('VERSION:3.0');
      expect(result.payload).toContain('FN:Jane Doe');
      expect(result.payload).toContain('N:Doe;Jane;;;');
      expect(result.payload).toContain('TEL:+1 555 123 4567');
      expect(result.payload).toContain('EMAIL:jane.doe@example.com');
      expect(result.payload).toContain('ORG:Acme Corp');
      expect(result.payload).toContain('TITLE:Lead Architect');
      expect(result.payload).toContain('END:VCARD');
    });

    it('flags row missing required identity when only phone/email is present', () => {
      const row = { phone: '1234567890', email: 'test@example.com' };
      const mapping: BulkContactMapping = { phone: 'phone', email: 'email' };
      const result = synthesizeVCardPayload(row, mapping);
      expect(result.hasAnyData).toBe(true);
      expect(result.hasIdentity).toBe(false);
    });

    it('flags control characters and dangerous URLs in contact fields', () => {
      const row = {
        name: 'Jane\x00Doe',
        email: 'javascript:alert(1)',
        phone: '12345',
      };
      const mapping: BulkContactMapping = {
        firstName: 'name',
        email: 'email',
        phone: 'phone',
      };
      const result = synthesizeVCardPayload(row, mapping);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations.some((v) => v.includes('control'))).toBe(true);
      expect(result.violations.some((v) => v.includes('unsafe') || v.includes('dangerous') || v.includes('Invalid email'))).toBe(true);
    });
  });

  describe('contact mode live preview', () => {
    it('previews synthesized vCard for the first row with contact data', () => {
      const csv = 'First,Last,Email\n,,,\nJane,Doe,jane@example.com\nJohn,Smith,john@example.com';
      const preview = constructBulkCsvString(data(csv, '', 'vcard'));
      expect(preview).toContain('BEGIN:VCARD');
      expect(preview).toContain('FN:Jane Doe');
      expect(preview).toContain('EMAIL:jane@example.com');
    });
  });
});
