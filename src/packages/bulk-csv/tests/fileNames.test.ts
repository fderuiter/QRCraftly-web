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
import { sanitizeFileStem } from '../index';

// Built from code points so no bidirectional character appears in this source file.
const u = (...codes: number[]): string => String.fromCharCode(...codes);
const RLO = u(0x202e);

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
