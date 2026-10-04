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
 * Cross-platform file name safety, shared by the Bulk CSV archive entries and the file receiver.
 * Names come from people or from a stream a stranger is showing, so they are treated as hostile:
 * the result is safe on Windows, macOS and Linux and displays as what it is.
 */

/** C0 and C1 controls. */
const isControl = (code: number): boolean => code <= 0x1f || (code >= 0x7f && code <= 0x9f);

/**
 * Characters that must never reach a file name besides controls: zero-width characters and
 * bidirectional controls (U+061C, U+200E/F, U+202A-202E, U+2066-2069) that make `invoicefdp.exe`
 * display as `invoiceexe.pdf`.
 */
const isInvisible = (code: number): boolean =>
  code === 0x061c ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2060 && code <= 0x2064) ||
  (code >= 0x2066 && code <= 0x2069) ||
  code === 0xfeff;

/** Characters Windows forbids in names, plus both path separators. */
const RESERVED_CHARS = /[\\/?:*"<>|]/g;

/** Windows device names, which are reserved with or without an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

const MAX_EXTENSION_LENGTH = 16;

export interface SanitizeFileNameOptions {
  /** Used when nothing usable is left. */
  fallback?: string;
  /** Maximum length of the result, extension included. Default 200. */
  maxLength?: number;
  /** Treat the input as a bare stem: a dot is part of the name, not an extension. */
  stem?: boolean;
}

/** Removes control, zero-width and bidirectional characters. */
export function stripInvisibleCharacters(value: string): string {
  return Array.from(value)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return !isControl(code) && !isInvisible(code);
    })
    .join('');
}

/** True when the string contains any control, zero-width or bidirectional character. */
export function hasInvisibleCharacters(value: string): boolean {
  return Array.from(value).some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return isControl(code) || isInvisible(code);
  });
}

/**
 * Turns an untrusted name into a safe one:
 * - control characters become `_`, zero-width and bidirectional characters are removed,
 * - `/ \ : * ? " < > |` become `_`, so `../` can never survive,
 * - leading dots (hidden files, `..`) and trailing dots and spaces (which Windows drops) go,
 * - a Windows device name such as `CON` or `nul.txt` gets a `_` prefix,
 * - the length is capped while the extension is kept.
 * Falls back to `fallback` when nothing usable is left.
 */
export function sanitizeFileName(raw: string, options: SanitizeFileNameOptions = {}): string {
  const { fallback = 'file', maxLength = 200, stem = false } = options;

  // Controls become `_` so a name keeps its word breaks; zero-width and bidi characters vanish.
  const spaced = Array.from(raw, (ch) => (isControl(ch.codePointAt(0) ?? 0) ? '_' : ch)).join('');
  let name = stripInvisibleCharacters(spaced)
    .replace(RESERVED_CHARS, '_')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');

  if (name.length === 0) return fallback;

  // Windows reserves the device name even when an extension follows the first dot.
  const firstDot = name.indexOf('.');
  const base = firstDot === -1 ? name : name.slice(0, firstDot);
  if (WINDOWS_RESERVED.test(base)) name = `_${name}`;

  if (name.length > maxLength) {
    const lastDot = stem ? -1 : name.lastIndexOf('.');
    const extension = lastDot > 0 && name.length - lastDot <= MAX_EXTENSION_LENGTH ? name.slice(lastDot) : '';
    name = (name.slice(0, maxLength - extension.length).replace(/[.\s]+$/, '') || fallback) + extension;
  }

  return name || fallback;
}
