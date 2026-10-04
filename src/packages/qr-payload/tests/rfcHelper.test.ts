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
  foldString,
  unfoldString,
  splitCompoundField,
  formatEventDateTime,
  parseEventDateTime,
  escapeVCardEvent,
  unescapeVCardEvent,
} from '../index';

describe('RFC Helper utilities', () => {
  describe('Line folding and unfolding', () => {
    it('does not fold lines that are shorter than or equal to maxLength', () => {
      const short = 'Short line';
      expect(foldString(short, 20)).toBe('Short line');
    });

    it('folds long lines by inserting a space at the beginning of folded lines with CRLF', () => {
      const long = 'This is a very long line that should definitely be folded by our utility';
      // fold at max 30 octets
      const folded = foldString(long, 30);
      expect(folded).toContain('\r\n ');
      const unfolded = unfoldString(folded);
      expect(unfolded).toBe(long);
    });

    it('preserves multi-line entries character-for-character after folding and unfolding', () => {
      const original = 'BEGIN:VCARD\r\nVERSION:3.0\r\nNOTE:This is an extremely long note field in the vCard that contains extensive details and formatted address lines and notes, and should fold across multiple lines safely per the RFC standard guidelines.\r\nEND:VCARD';
      const folded = foldString(original, 75);
      const unfolded = unfoldString(folded);
      expect(unfolded).toBe(original);
    });

    it('enforces CRLF line endings exclusively for line folding', () => {
      const text = 'TITLE:An extremely long title that has more than seventy five characters to test folding';
      const folded = foldString(text, 50);
      expect(folded).toContain('\r\n ');

      const crlfText = 'TITLE:An extremely long title that has more than seventy five characters to test folding\r\nNOTE:Another long field';
      const foldedCrlf = foldString(crlfText, 50);
      expect(foldedCrlf).toContain('\r\n ');
    });

    it('strictly respects the 75-octet RFC byte limit per folded line using UTF-8 byte counting', () => {
      const encoder = new TextEncoder();
      const multiByteField = 'NOTE:' + 'こんにちは世界'.repeat(10);
      const folded = foldString(multiByteField, 75);
      const lines = folded.split('\r\n');

      for (const line of lines) {
        expect(encoder.encode(line).byteLength).toBeLessThanOrEqual(75);
      }

      const unfolded = unfoldString(folded);
      expect(unfolded).toBe(multiByteField);
    });

    it('preserves multi-byte Unicode characters and emoji surrogate pairs without splitting across folds', () => {
      const encoder = new TextEncoder();
      // "NOTE:" (5 bytes) + 68 'a's (68 bytes) = 73 bytes.
      // Adding 🔥 (4 bytes) would make 77 bytes, exceeding 75 bytes limit.
      // So 🔥 must be placed on the continuation line without splitting its surrogate pair.
      const emojiText = 'NOTE:' + 'a'.repeat(68) + '🔥';
      const folded = foldString(emojiText, 75);
      const lines = folded.split('\r\n');

      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('NOTE:' + 'a'.repeat(68));
      expect(lines[1]).toBe(' 🔥');

      for (const line of lines) {
        expect(encoder.encode(line).byteLength).toBeLessThanOrEqual(75);
      }

      const unfolded = unfoldString(folded);
      expect(unfolded).toBe(emojiText);
    });
  });

  describe('splitCompoundField high-accuracy delimiter parsing', () => {
    it('splits standard compound fields correctly', () => {
      const parts = splitCompoundField('one;two;three');
      expect(parts).toEqual(['one', 'two', 'three']);
    });

    it('handles empty string input', () => {
      expect(splitCompoundField('')).toEqual(['']);
    });

    it('ignores escaped semicolons', () => {
      const parts = splitCompoundField('one\\;stillOne;two');
      expect(parts).toEqual(['one\\;stillOne', 'two']);
    });

    it('identifies unescaped semicolons even when preceded by an even number of backslashes', () => {
      // \\; represents an escaped backslash followed by an unescaped semicolon
      const parts = splitCompoundField('one\\\\;two');
      expect(parts).toEqual(['one\\\\', 'two']);
    });

    it('identifies escaped semicolons when preceded by an odd number of backslashes', () => {
      // \\\\\; represents two escaped backslashes followed by an escaped semicolon
      const parts = splitCompoundField('one\\\\\\;stillOne;two');
      expect(parts).toEqual(['one\\\\\\;stillOne', 'two']);
    });
  });

  describe('Timezone and UTC indicator preservation', () => {
    it('formats and parses local date-times without adjustments', () => {
      const dateStr = '2025-01-01T12:30';
      const formatted = formatEventDateTime(dateStr);
      expect(formatted.value).toBe('20250101T123000');
      expect(formatted.tzid).toBeUndefined();

      const parsed = parseEventDateTime(formatted.value);
      expect(parsed).toBe('2025-01-01T12:30');
    });

    it('formats and parses absolute UTC times accurately', () => {
      const dateStr = '2025-01-01T12:30Z';
      const formatted = formatEventDateTime(dateStr);
      // Since it is UTC, value ends with Z
      expect(formatted.value).toBe('20250101T123000Z');

      const parsed = parseEventDateTime(formatted.value);
      expect(parsed).toBe('2025-01-01T12:30Z');
    });

    it('formats and parses dates with regional timezone (TZID) indicators', () => {
      const dateStr = '2025-01-01T12:30;TZID=America/New_York';
      const formatted = formatEventDateTime(dateStr);
      expect(formatted.value).toBe('20250101T123000');
      expect(formatted.tzid).toBe('America/New_York');

      const parsed = parseEventDateTime(formatted.value, ';TZID=America/New_York');
      expect(parsed).toBe('2025-01-01T12:30;TZID=America/New_York');
    });

    it('formats dates with offset designations using UTC methods and Z suffix', () => {
      const dateStr = '2025-01-01T12:30-05:00';
      const formatted = formatEventDateTime(dateStr);
      // 12:30-05:00 is 17:30 UTC
      expect(formatted.value).toBe('20250101T173000Z');

      const parsed = parseEventDateTime(formatted.value);
      expect(parsed).toBe('2025-01-01T17:30Z');
    });

    it('handles empty, invalid and other edge cases for date formatting and parsing', () => {
      // Empty / undefined inputs
      expect(foldString('')).toBe('');
      expect(unfoldString('')).toBe('');
      expect(formatEventDateTime(undefined)).toEqual({ value: '' });
      expect(formatEventDateTime('')).toEqual({ value: '' });
      expect(parseEventDateTime('')).toBe('');

      // Invalid date formats
      expect(formatEventDateTime('invalid-date')).toEqual({ value: '' });
      expect(formatEventDateTime('2026-01-01\nATTENDEE:mailto:x@example.com').value).toBe('');
      expect(parseEventDateTime('not-matching-regex')).toBe('not-matching-regex');

      // keyParams without TZID
      expect(parseEventDateTime('20250101T123000', ';FOO=bar')).toBe('2025-01-01T12:30');

      // escapeVCardEvent and unescapeVCardEvent edge cases
      expect(escapeVCardEvent(undefined)).toBe('');
      expect(escapeVCardEvent('')).toBe('');
      expect(escapeVCardEvent('hello;world,testing\\backslashes\nand\rnewlines')).toBe('hello\\;world\\,testing\\\\backslashes\\nand\\nnewlines');

      expect(unescapeVCardEvent(undefined)).toBe('');
      expect(unescapeVCardEvent('')).toBe('');
      expect(unescapeVCardEvent('hello\\;world\\,testing\\\\backslashes\\nand\\nnewlines')).toBe('hello;world,testing\\backslashes\nand\nnewlines');
    });
  });
});
