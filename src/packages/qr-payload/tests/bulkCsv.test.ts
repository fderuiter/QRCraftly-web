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
  BULK_CONTACT_FIELDS,
  BulkCsvContract,
  constructBulkCsvString,
  constructVCardString,
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

    it('detects email, phone, and website from sample rows when headers are ambiguous', () => {
      const headers = ['ColA', 'ColB', 'ColC', 'ColD'];
      const rows = [
        { ColA: 'Alice', ColB: 'alice@example.com', ColC: '+1-555-0199', ColD: 'https://example.com/alice' },
        { ColB: 'bob@example.com', ColC: '+1-555-0188', ColA: 'Bob', ColD: 'www.example.com/bob' },
      ];
      const mapping = autoDetectContactMapping(headers, rows);
      expect(mapping.email).toBe('ColB');
      expect(mapping.phone).toBe('ColC');
      expect(mapping.website).toBe('ColD');
    });

    it('defines all eleven contact fields in BULK_CONTACT_FIELDS and detects website and postal headers', () => {
      expect(BULK_CONTACT_FIELDS.map((f) => f.key)).toEqual([
        'firstName',
        'lastName',
        'organization',
        'title',
        'phone',
        'email',
        'website',
        'street',
        'city',
        'zip',
        'country',
      ]);
      expect(BULK_CONTACT_FIELDS.filter((f) => f.group === 'core')).toHaveLength(7);
      expect(BULK_CONTACT_FIELDS.filter((f) => f.group === 'postal')).toHaveLength(4);

      const headers = [
        'Given Name',
        'Surname',
        'Employer',
        'Designation',
        'Telephone',
        'E-mail',
        'Company Website',
        'Street Address',
        'Locality',
        'Postcode',
        'Nation',
      ];
      const mapping = autoDetectContactMapping(headers);
      expect(mapping).toEqual({
        firstName: 'Given Name',
        lastName: 'Surname',
        organization: 'Employer',
        title: 'Designation',
        phone: 'Telephone',
        email: 'E-mail',
        website: 'Company Website',
        street: 'Street Address',
        city: 'Locality',
        zip: 'Postcode',
        country: 'Nation',
      });
    });
  });

  describe('synthesizeVCardPayload', () => {
    it('synthesizes valid RFC 6350 vCard payload matching single-card constructVCardString for all 11 fields', () => {
      const row = {
        fname: 'Jane',
        lname: 'Doe',
        tel: '+1 555 123 4567',
        mail: 'jane.doe@example.com',
        org: 'Acme Corp',
        role: 'Lead Architect',
        web: 'https://example.com/jane',
        street: '100 Market St, Suite 4; Floor 2',
        city: 'San Francisco',
        zip: '94105',
        country: 'United States',
      };
      const mapping: BulkContactMapping = {
        firstName: 'fname',
        lastName: 'lname',
        phone: 'tel',
        email: 'mail',
        organization: 'org',
        title: 'role',
        website: 'web',
        street: 'street',
        city: 'city',
        zip: 'zip',
        country: 'country',
      };
      const result = synthesizeVCardPayload(row, mapping);
      expect(result.hasAnyData).toBe(true);
      expect(result.hasIdentity).toBe(true);
      expect(result.violations).toHaveLength(0);

      const expectedSingleCard = constructVCardString({
        firstName: row.fname,
        lastName: row.lname,
        phone: row.tel,
        email: row.mail,
        organization: row.org,
        title: row.role,
        website: row.web,
        street: row.street,
        city: row.city,
        state: '',
        zip: row.zip,
        country: row.country,
        version: '3.0',
      });
      expect(result.payload).toBe(expectedSingleCard);
      expect(result.payload).toContain('URL:https://example.com/jane');
      expect(result.payload).toContain('ADR:;;100 Market St\\, Suite 4\\; Floor 2;San Francisco;;94105;United States');
    });

    it('flags row missing required identity when only phone/email is present', () => {
      const row = { phone: '1234567890', email: 'test@example.com' };
      const mapping: BulkContactMapping = { phone: 'phone', email: 'email' };
      const result = synthesizeVCardPayload(row, mapping);
      expect(result.hasAnyData).toBe(true);
      expect(result.hasIdentity).toBe(false);
    });

    it('flags control characters, BiDi overrides, and dangerous URLs across all contact fields', () => {
      const row = {
        name: 'Jane\x00Doe',
        email: 'javascript:alert(1)',
        phone: '12345',
        web: 'javascript:evil()',
        street: '100 Main\u202E St',
        city: 'Austin\u200B',
        zip: '78701\x07',
        country: 'US\u2066',
      };
      const mapping: BulkContactMapping = {
        firstName: 'name',
        email: 'email',
        phone: 'phone',
        website: 'web',
        street: 'street',
        city: 'city',
        zip: 'zip',
        country: 'country',
      };
      const result = synthesizeVCardPayload(row, mapping);
      expect(result.violations.some((v) => v.includes('First Name contains invalid control'))).toBe(true);
      expect(result.violations.some((v) => v.includes('Website contains unsafe URL scheme'))).toBe(true);
      expect(result.violations.some((v) => v.includes('Street contains hidden text-direction'))).toBe(true);
      expect(result.violations.some((v) => v.includes('City contains invalid control or zero-width'))).toBe(true);
      expect(result.violations.some((v) => v.includes('Postal Code contains invalid control'))).toBe(true);
      expect(result.violations.some((v) => v.includes('Country contains hidden text-direction'))).toBe(true);
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
