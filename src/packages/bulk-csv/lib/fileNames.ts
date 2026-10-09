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

import { sanitizeFileName } from '@/utils/fileNames';

const MAX_STEM_LENGTH = 100;
/** Leaves room in the 255-byte name limit for a `_500` suffix and the extension. */
const MAX_STEM_BYTES = 200;

/**
 * Turns a CSV cell into a file name stem that is safe on Windows, macOS and Linux: path
 * separators, reserved, control, zero-width and bidirectional characters are removed or become
 * `_`, leading dots and trailing dots or spaces are dropped, Windows device names (`CON`, `NUL`,
 * `COM1` ...) are prefixed, and the result is capped at 100 characters and 200 UTF-8 bytes, on
 * whole characters. Falls back to `fallback` when nothing usable is left.
 */
export function sanitizeFileStem(raw: string, fallback = 'qr_code'): string {
  return sanitizeFileName(raw, { fallback, maxLength: MAX_STEM_LENGTH, maxBytes: MAX_STEM_BYTES, stem: true });
}

/** The form two names share when a file system treats them as the same file: NFC, lowercase. */
const nameKey = (name: string): string => name.normalize('NFC').toLowerCase();

/**
 * Returns `stem.ext`, or `stem_2.ext`, `stem_3.ext`, ... when that name is already in
 * `used` (compared case-insensitively and after Unicode normalisation, as on Windows and macOS).
 * Records the name it returns.
 */
export function allocateFileName(stem: string, ext: string, used: Set<string>): string {
  let name = `${stem}.${ext}`;
  let suffix = 2;
  while (used.has(nameKey(name))) {
    name = `${stem}_${suffix}.${ext}`;
    suffix += 1;
  }
  used.add(nameKey(name));
  return name;
}
