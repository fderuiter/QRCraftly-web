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

/**
 * Validates an International Bank Account Number (IBAN) according to ISO 13616
 * using mod-97 checksum logic with BigInt arithmetic.
 *
 * @param iban - The IBAN string to validate.
 * @returns True if the IBAN is structurally valid and passes mod-97 check.
 */
export function isValidIban(iban: string): boolean {
  if (typeof iban !== 'string') {
    return false;
  }

  // Strip whitespace and convert to uppercase
  const cleaned = iban.replace(/\s+/g, '').toUpperCase();

  // Country IBAN lengths range from 15 to 34 characters
  if (cleaned.length < 15 || cleaned.length > 34) {
    return false;
  }

  // Country code must be two uppercase ASCII letters
  if (!/^[A-Z]{2}/.test(cleaned)) {
    return false;
  }

  // IBAN must consist solely of uppercase alphanumeric characters
  if (!/^[A-Z0-9]+$/.test(cleaned)) {
    return false;
  }

  // ISO 13616 check-digit algorithm:
  // Move first 4 characters (country code + check digits) to the end
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);

  // Convert each letter to digits (A=10, B=11, ..., Z=35)
  let numericStr = '';
  for (let i = 0; i < rearranged.length; i++) {
    const charCode = rearranged.charCodeAt(i);
    if (charCode >= 65 && charCode <= 90) {
      numericStr += (charCode - 55).toString();
    } else {
      numericStr += rearranged[i];
    }
  }

  try {
    return BigInt(numericStr) % 97n === 1n;
  } catch {
    return false;
  }
}
