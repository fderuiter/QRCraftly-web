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
import { sanitizeFileName, stripInvisibleCharacters, hasInvisibleCharacters } from './fileNames';
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
