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

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Escapes a single cell value for RFC 4180 CSV text.
 * Neutralises leading formula characters (=, +, -, @, \t, \r) with a single quote to prevent
 * formula injection in spreadsheets, then wraps fields in double quotes if they contain
 * quotes, commas, or line breaks. Internal quotes are doubled.
 * @param field - Raw value to escape.
 * @returns Escaped CSV field.
 */
export function escapeCsvCell(field: string | number | undefined | null): string {
  const str = String(field ?? '');
  const safe = FORMULA_START.test(str) ? `'${str}` : str;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
