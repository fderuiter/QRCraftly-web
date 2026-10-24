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
 * The WinAnsi text encoding both writers select for Helvetica (#1605). The reader encodes text
 * with it, and the font metrics look up the widths of its extra characters.
 */

/**
 * The WinAnsi characters between 0x80 and 0x9F that Helvetica draws (dashes, curly quotes, the euro sign):
 * character, code, glyph name for the EPS encoding, and width in Helvetica and Helvetica-Bold.
 */
export const WIN_ANSI_EXTRAS: readonly (readonly [string, number, string, number, number])[] = [
  ['€', 0x80, 'Euro', 556, 556],
  ['‚', 0x82, 'quotesinglbase', 222, 278],
  ['ƒ', 0x83, 'florin', 556, 556],
  ['„', 0x84, 'quotedblbase', 333, 500],
  ['…', 0x85, 'ellipsis', 1000, 1000],
  ['†', 0x86, 'dagger', 556, 556],
  ['‡', 0x87, 'daggerdbl', 556, 556],
  ['ˆ', 0x88, 'circumflex', 333, 333],
  ['‰', 0x89, 'perthousand', 1000, 1000],
  ['Š', 0x8a, 'Scaron', 667, 667],
  ['‹', 0x8b, 'guilsinglleft', 333, 333],
  ['Œ', 0x8c, 'OE', 1000, 1000],
  ['Ž', 0x8e, 'Zcaron', 611, 611],
  ['‘', 0x91, 'quoteleft', 222, 278],
  ['’', 0x92, 'quoteright', 222, 278],
  ['“', 0x93, 'quotedblleft', 333, 500],
  ['”', 0x94, 'quotedblright', 333, 500],
  ['•', 0x95, 'bullet', 350, 350],
  ['–', 0x96, 'endash', 556, 556],
  ['—', 0x97, 'emdash', 1000, 1000],
  ['˜', 0x98, 'tilde', 333, 333],
  ['™', 0x99, 'trademark', 1000, 1000],
  ['š', 0x9a, 'scaron', 500, 556],
  ['›', 0x9b, 'guilsinglright', 333, 333],
  ['œ', 0x9c, 'oe', 944, 944],
  ['ž', 0x9e, 'zcaron', 500, 500],
  ['Ÿ', 0x9f, 'Ydieresis', 667, 667],
];

// Searched on use rather than prebuilt: nothing here runs when the module loads, so the bundler can
// keep the vector writers out of the generator's first-load chunk (see `fontProlog` in epsExport.ts).
const winAnsiByChar = (codePoint: number) => WIN_ANSI_EXTRAS.find(([ch]) => ch.codePointAt(0) === codePoint);
export const winAnsiByCode = (code: number) => WIN_ANSI_EXTRAS.find((extra) => extra[1] === code);

/**
 * Converts text to WinAnsi codes, the encoding both writers select for Helvetica
 * (`WinAnsiEncoding` in PDF; ISOLatin1Encoding plus the WinAnsi extras in EPS).
 * @param text - Text to encode.
 * @returns One code per character; characters Helvetica cannot draw become `?`.
 */
export function toLatin1Codes(text: string): number[] {
  return Array.from(text, (ch) => {
    const code = ch.codePointAt(0) ?? 63;
    if ((code >= 32 && code <= 126) || (code >= 0xa0 && code <= 0xff)) return code;
    return winAnsiByChar(code)?.[1] ?? 63;
  });
}
