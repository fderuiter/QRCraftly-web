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

/**
 * Turns a CSV cell into a file name stem that is safe on Windows, macOS and Linux: path
 * separators, reserved, control, zero-width and bidirectional characters are removed or become
 * `_`, leading dots and trailing dots or spaces are dropped, Windows device names (`CON`, `NUL`,
 * `COM1` ...) are prefixed, and the result is capped at 100 characters. Falls back to `fallback`
 * when nothing usable is left.
 */
export function sanitizeFileStem(raw: string, fallback = 'qr_code'): string {
  return sanitizeFileName(raw, { fallback, maxLength: MAX_STEM_LENGTH, stem: true });
}

/**
 * Returns `stem.ext`, or `stem_2.ext`, `stem_3.ext`, ... when that name is already in
 * `used` (compared case-insensitively, as on Windows and macOS). Records the name it returns.
 */
export function allocateFileName(stem: string, ext: string, used: Set<string>): string {
  let name = `${stem}.${ext}`;
  let suffix = 2;
  while (used.has(name.toLowerCase())) {
    name = `${stem}_${suffix}.${ext}`;
    suffix += 1;
  }
  used.add(name.toLowerCase());
  return name;
}
