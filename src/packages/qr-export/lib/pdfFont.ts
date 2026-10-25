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

/**
 * Helvetica metrics and string encoding for the EPS and PDF writers (#1605): advance widths,
 * the WinAnsi glyph names for the EPS font prolog, and PostScript/PDF literal strings.
 */

import { WIN_ANSI_EXTRAS, winAnsiByCode } from './winAnsi';

/** Helvetica advance widths (1/1000 em) for codes 32..126, from the Adobe core font metrics. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Helvetica-Bold advance widths (1/1000 em) for codes 32..126. */
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** `code /glyph put` pairs that give an ISOLatin1 font the WinAnsi extras, for the EPS font prolog. */
export const winAnsiExtraPuts = (): string => WIN_ANSI_EXTRAS.map(([, code, glyph]) => `dup ${code} /${glyph} put`).join(' ');

const widthOf = (code: number, bold: boolean): number => {
  const table = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  if (code >= 32 && code <= 126) return table[code - 32];
  const extra = winAnsiByCode(code);
  if (extra) return extra[bold ? 4 : 3];
  // Accented letters take the width of their base letter.
  const base = String.fromCharCode(code).normalize('NFD').charCodeAt(0);
  return base >= 32 && base <= 126 ? table[base - 32] : 556;
};

/** Width of Latin-1 text set in Helvetica at `fontSize`. */
export const textWidth = (codes: readonly number[], fontSize: number, bold: boolean): number =>
  (codes.reduce((sum, code) => sum + widthOf(code, bold), 0) * fontSize) / 1000;

/** Writes Latin-1 codes as a PostScript/PDF literal string, escaping everything outside printable ASCII. */
export function literalString(codes: readonly number[]): string {
  const body = codes
    .map((code) => {
      if (code === 40 || code === 41 || code === 92) return `\\${String.fromCharCode(code)}`;
      if (code >= 32 && code <= 126) return String.fromCharCode(code);
      return `\\${code.toString(8).padStart(3, '0')}`;
    })
    .join('');
  return `(${body})`;
}
