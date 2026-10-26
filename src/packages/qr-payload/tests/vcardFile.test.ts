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

import { describe, expect, it } from 'vitest';
import { constructVCardString, type VCardData } from '../index';
import { readVCardFile, type VCardFileResult } from '../vcardFile';

const fieldsOf = (result: VCardFileResult) => {
  if (!result.ok) throw new Error(`expected fields, got ${result.error}`);
  return result.fields;
};

describe('readVCardFile (#1558)', () => {
  it('reads a vCard 3.0 file with folded lines and escaped characters', () => {
    const fields = fieldsOf(
      readVCardFile(
        [
          'BEGIN:VCARD',
          'VERSION:3.0',
          'N:Doe;Jane;;;',
          'FN:Jane Doe',
          'ORG:Acme\\, Inc.',
          'TITLE:Head of R&D\; Labs',
          'TEL;TYPE=CELL:+1 555 0100',
          'EMAIL:jane@example.com',
          'URL:https://example.com/a-very-long-path-that-the-',
          ' exporter-folded',
          'ADR;TYPE=WORK:;;1 Main St;Springfield;;12345;USA',
          'END:VCARD',
        ].join('\r\n')
      )
    );
    expect(fields).toMatchObject({
      firstName: 'Jane',
      lastName: 'Doe',
      organization: 'Acme, Inc.',
      title: 'Head of R&D; Labs',
      phone: '+1 555 0100',
      email: 'jane@example.com',
      website: 'https://example.com/a-very-long-path-that-the-exporter-folded',
      street: '1 Main St',
      city: 'Springfield',
      zip: '12345',
      country: 'USA',
    });
    expect(fields).not.toHaveProperty('version');
  });

  it('reads vCard 2.1 quoted-printable UTF-8 values, with soft line breaks', () => {
    const fields = fieldsOf(
      readVCardFile(
        [
          'BEGIN:VCARD',
          'VERSION:2.1',
          'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;J=C3=B6rg',
          'ORG;ENCODING=QUOTED-PRINTABLE:Caf=C3=A9 =',
          'du Monde',
          'TEL;CELL:+49 30 1234',
          'END:VCARD',
        ].join('\r\n')
      )
    );
    expect(fields).toMatchObject({ lastName: 'Müller', firstName: 'Jörg', organization: 'Café du Monde', phone: '+49 30 1234' });
  });

  it('reads a vCard 4.0 card with a tel: URI, a property group, social profiles and a byte order mark', () => {
    const fields = fieldsOf(
      readVCardFile(
        '﻿BEGIN:VCARD\nVERSION:4.0\nFN:Ada Lovelace\nTEL;VALUE=uri;TYPE=cell:tel:+44-20-7946-0000\nitem1.EMAIL:ada@example.org\nURL;TYPE=github:https://github.com/ada\nEND:VCARD\n'
      )
    );
    expect(fields).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '+44-20-7946-0000',
      email: 'ada@example.org',
      github: 'https://github.com/ada',
    });
  });

  it('reads only the first card of a file with several', () => {
    const file = 'BEGIN:VCARD\nVERSION:3.0\nN:One;First\nEND:VCARD\nBEGIN:VCARD\nVERSION:3.0\nN:Two;Second\nEMAIL:two@example.com\nEND:VCARD\n';
    expect(fieldsOf(readVCardFile(file))).toMatchObject({ firstName: 'First', lastName: 'One', email: '' });
  });

  it('drops an embedded photo, which the form cannot hold, and keeps a photo link', () => {
    const embedded = 'BEGIN:VCARD\nVERSION:3.0\nN:Doe;Jane\nPHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQ\nEND:VCARD';
    expect(fieldsOf(readVCardFile(embedded)).photo).toBe('');
    const linked = 'BEGIN:VCARD\nVERSION:3.0\nN:Doe;Jane\nPHOTO;VALUE=uri:https://example.com/jane.jpg\nEND:VCARD';
    expect(fieldsOf(readVCardFile(linked)).photo).toBe('https://example.com/jane.jpg');
  });

  it('round-trips a card QRCraftly writes', () => {
    const card: VCardData = {
      version: '3.0',
      firstName: 'Jane',
      lastName: 'Doe',
      organization: 'Acme',
      title: 'CTO',
      phone: '+15550100',
      email: 'jane@example.com',
      website: 'https://example.com/',
      street: '1 Main St',
      city: 'Springfield',
      zip: '12345',
      country: 'USA',
      photo: '',
      linkedin: 'https://linkedin.com/in/jane',
    };
    const { version: _version, ...expected } = card;
    expect(fieldsOf(readVCardFile(constructVCardString(card)))).toMatchObject(expected);
  });

  it.each([
    ['an empty file', ''],
    ['whitespace', '  \n\t '],
    ['a CSV file', 'name,email\nJane,jane@example.com\n'],
    ['a MECARD string, which is not a .vcf file', 'MECARD:N:Doe,Jane;;'],
    ['binary noise', '\u0000\u0001PNG\u001a'],
  ])('says %s is not a contact card', (_name, text) => {
    expect(readVCardFile(text)).toEqual({ ok: false, error: 'not-a-vcard' });
  });

  it('says a card with no contact details is empty', () => {
    expect(readVCardFile('BEGIN:VCARD\nVERSION:3.0\nEND:VCARD\n')).toEqual({ ok: false, error: 'empty' });
    expect(readVCardFile('BEGIN:VCARD\nVERSION:3.0\nN:;;;;\nNOTE:nothing here\n')).toEqual({ ok: false, error: 'empty' });
  });

  it('never throws on malformed lines', () => {
    const malformed = 'BEGIN:VCARD\n:::\n;;;\nN\nEMAIL;ENCODING=QUOTED-PRINTABLE:=ZZ=\nTEL:=\nEND:VCARD';
    expect(() => readVCardFile(malformed)).not.toThrow();
  });
});
