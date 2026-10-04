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
import { sanitizeFileName, stripInvisibleCharacters, hasInvisibleCharacters, analyseReceivedFile } from './fileNames';
import { sanitizeFileStem } from '@/packages/bulk-csv';

// Built from code points so no bidirectional character appears in this source file.
const u = (...codes: number[]): string => String.fromCharCode(...codes);
const RLO = u(0x202e);
const ZWSP = u(0x200b);
const BOM = u(0xfeff);

describe('sanitizeFileName', () => {
  it('keeps an ordinary name unchanged', () => {
    expect(sanitizeFileName('report final.pdf')).toBe('report final.pdf');
    expect(sanitizeFileName('Café menu.txt')).toBe('Café menu.txt');
  });

  it('removes right-to-left override and other bidirectional controls', () => {
    // "invoice" + RLO + "fdp.exe" would display as "invoiceexe.pdf".
    expect(sanitizeFileName(`invoice${RLO}fdp.exe`)).toBe('invoicefdp.exe');
    expect(sanitizeFileName(`a${u(0x2066)}b${u(0x2069)}c${u(0x200e)}d${u(0x200f)}e${u(0x61c)}f`)).toBe('abcdef');
  });

  it('removes zero-width characters and turns controls into underscores', () => {
    expect(sanitizeFileName(`a${ZWSP}b${BOM}c`)).toBe('abc');
    expect(sanitizeFileName('tab\there')).toBe('tab_here');
    expect(sanitizeFileName(`c1${u(0x85)}control`)).toBe('c1_control');
  });

  it('neutralises path traversal and separators', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeFileName('..\\..\\windows\\system32')).toBe('_.._windows_system32');
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(sanitizeFileName('/etc/passwd')).toBe('_etc_passwd');
  });

  it('drops leading dots and trailing dots and spaces', () => {
    expect(sanitizeFileName('.bashrc')).toBe('bashrc');
    expect(sanitizeFileName('..')).toBe('file');
    expect(sanitizeFileName('photo.jpg. . ')).toBe('photo.jpg');
    expect(sanitizeFileName('  spaced  ')).toBe('spaced');
  });

  it('prefixes Windows reserved device names, with or without an extension', () => {
    for (const name of ['CON', 'nul', 'AUX.txt', 'com1', 'LPT9.log', 'prn.tar.gz']) {
      expect(sanitizeFileName(name).startsWith('_')).toBe(true);
    }
    expect(sanitizeFileName('console.txt')).toBe('console.txt');
    expect(sanitizeFileName('com10.txt')).toBe('com10.txt');
  });

  it('caps the length at 200 and keeps the extension', () => {
    const long = `${'x'.repeat(500)}.pdf`;
    const result = sanitizeFileName(long);
    expect(result).toHaveLength(200);
    expect(result.endsWith('.pdf')).toBe(true);
    expect(sanitizeFileName('y'.repeat(500))).toHaveLength(200);
  });

  it('does not mistake a long suffix for an extension', () => {
    const result = sanitizeFileName(`a.${'z'.repeat(300)}`, { maxLength: 50 });
    expect(result).toHaveLength(50);
  });

  it('falls back when nothing usable is left', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName(`${RLO}${ZWSP}`, { fallback: 'download' })).toBe('download');
    expect(sanitizeFileName('...')).toBe('file');
  });
});

describe('invisible character helpers', () => {
  it('detects and strips them', () => {
    expect(hasInvisibleCharacters('plain')).toBe(false);
    expect(hasInvisibleCharacters(`a${RLO}b`)).toBe(true);
    expect(stripInvisibleCharacters(`a${RLO}b${ZWSP}c`)).toBe('abc');
  });
});

describe('sanitizeFileStem (bulk CSV) covers the extra character classes', () => {
  it('handles C1 controls, bidi characters, trailing dots and spaces', () => {
    expect(sanitizeFileStem(`name${u(0x85)}x`)).toBe('name_x');
    expect(sanitizeFileStem(`a${RLO}b`)).toBe('ab');
    expect(sanitizeFileStem('report. . ')).toBe('report');
  });

  it('prefixes Windows reserved names', () => {
    expect(sanitizeFileStem('CON')).toBe('_CON');
    expect(sanitizeFileStem('NUL')).toBe('_NUL');
    expect(sanitizeFileStem('COM1')).toBe('_COM1');
    expect(sanitizeFileStem('lpt3')).toBe('_lpt3');
    expect(sanitizeFileStem('CONSOLE')).toBe('CONSOLE');
  });

  it('keeps the 100 character cap', () => {
    expect(sanitizeFileStem('x'.repeat(300))).toHaveLength(100);
  });
});

describe('analyseReceivedFile (#1155)', () => {
  it.each(['report.pdf', 'photo.jpg', 'notes.txt', 'data.csv', 'archive.zip', 'README'])('does not flag %s', (name) => {
    const result = analyseReceivedFile(name, 'application/octet-stream');
    expect(result.risky).toBe(false);
    expect(result.doubleExtension).toBe(false);
    expect(result.notices).toEqual([]);
  });

  it.each([
    'setup.exe', 'a.msi', 'a.bat', 'a.cmd', 'a.com', 'a.scr', 'a.ps1', 'a.vbs', 'a.js', 'a.jse', 'a.wsf', 'a.hta', 'a.lnk',
    'a.apk', 'a.appx', 'a.dmg', 'a.pkg', 'a.app', 'a.jar', 'a.html', 'a.htm', 'a.svg', 'a.xhtml', 'a.docm', 'a.xlsm',
    'a.pptm', 'a.iso', 'a.img', 'SETUP.EXE',
  ])('flags %s as risky', (name) => {
    expect(analyseReceivedFile(name, 'application/octet-stream').risky).toBe(true);
  });

  it('flags active MIME types whatever the extension says', () => {
    expect(analyseReceivedFile('notes.dat', 'text/html').risky).toBe(true);
    expect(analyseReceivedFile('notes.dat', 'image/svg+xml; charset=utf-8').risky).toBe(true);
  });

  it('calls out a risky extension hiding behind a harmless one', () => {
    const result = analyseReceivedFile('photo.jpg.exe', 'image/jpeg');
    expect(result.risky).toBe(true);
    expect(result.doubleExtension).toBe(true);
    expect(result.extension).toBe('exe');
    expect(result.notices.join(' ')).toContain('The real type is .exe');
  });

  it('does not call .tar.gz or .min.js a disguise', () => {
    expect(analyseReceivedFile('backup.tar.gz', '').doubleExtension).toBe(false);
    expect(analyseReceivedFile('app.min.js', '').doubleExtension).toBe(false);
  });

  it('saves as a generic binary when the announced type disagrees with the extension', () => {
    const result = analyseReceivedFile('holiday.jpg', 'application/pdf');
    expect(result.mimeMismatch).toBe(true);
    expect(result.mimeType).toBe('application/octet-stream');
    expect(result.notices.join(' ')).toContain('disagree');
    expect(analyseReceivedFile('holiday.jpg', 'image/jpeg').mimeMismatch).toBe(false);
    expect(analyseReceivedFile('holiday.jpg', 'application/octet-stream').mimeMismatch).toBe(false);
    expect(analyseReceivedFile('holiday.jpg', '').mimeType).toBe('application/octet-stream');
  });

  it('sanitises the name and says so', () => {
    const result = analyseReceivedFile(`../a${RLO}b.pdf`, 'application/pdf');
    expect(result.safeName).toBe('_ab.pdf');
    expect(result.nameChanged).toBe(true);
    expect(result.notices[0]).toContain('cleaned');
    expect(analyseReceivedFile('clean.pdf', 'application/pdf').nameChanged).toBe(false);
  });

  it('falls back to a name when none is given', () => {
    expect(analyseReceivedFile('', '').safeName).toBe('received_file');
  });
});
