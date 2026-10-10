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

/**
 * Windows device names, which are reserved with or without an extension. Windows also treats
 * the superscript digits ¹ ² ³ as digits here (`COM¹`), and reserves the console names.
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;

/** Most UTF-8 bytes in a file name on common file systems (ext4, APFS, NTFS in practice). */
const MAX_NAME_BYTES = 255;

const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

/**
 * Cuts `value` to at most `maxChars` code points and `maxBytes` UTF-8 bytes, never inside a
 * character, so no half of a surrogate pair (shown as U+FFFD) is left behind.
 */
function truncateName(value: string, maxChars: number, maxBytes: number): string {
  let out = '';
  let bytes = 0;
  let chars = 0;
  for (const ch of value) {
    const size = utf8Length(ch);
    if (chars + 1 > maxChars || bytes + size > maxBytes) break;
    out += ch;
    bytes += size;
    chars += 1;
  }
  return out;
}

const MAX_EXTENSION_LENGTH = 16;

export interface SanitizeFileNameOptions {
  /** Used when nothing usable is left. */
  fallback?: string;
  /** Maximum length of the result in characters (code points), extension included. Default 200. */
  maxLength?: number;
  /** Maximum length of the result in UTF-8 bytes, extension included. Default 255, the usual file system limit. */
  maxBytes?: number;
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
 * Makes hidden characters visible as `[U+202E]` markers, so a reader can see that text which
 * looks ordinary holds direction overrides or zero-width characters. Tab and line breaks stay.
 * @param value - Untrusted text.
 * @returns The text with every control, zero-width and bidirectional character spelled out.
 */
export function revealInvisibleCharacters(value: string): string {
  return Array.from(value)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code === 0x09 || code === 0x0a || code === 0x0d) return ch;
      return isControl(code) || isInvisible(code) ? `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]` : ch;
    })
    .join('');
}

/**
 * Turns an untrusted name into a safe one:
 * - control characters become `_`, zero-width and bidirectional characters are removed,
 * - `/ \ : * ? " < > |` become `_`, so `../` can never survive,
 * - leading dots (hidden files, `..`) and trailing dots and spaces (which Windows drops) go,
 * - a Windows device name such as `CON` or `nul.txt` gets a `_` prefix,
 * - the length is capped in characters and in UTF-8 bytes, on whole characters, while the
 *   extension is kept.
 * Falls back to `fallback` when nothing usable is left.
 */
export function sanitizeFileName(raw: string, options: SanitizeFileNameOptions = {}): string {
  const { fallback = 'file', maxLength = 200, maxBytes = MAX_NAME_BYTES, stem = false } = options;

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

  if (Array.from(name).length > maxLength || utf8Length(name) > maxBytes) {
    const lastDot = stem ? -1 : name.lastIndexOf('.');
    const extension = lastDot > 0 && name.length - lastDot <= MAX_EXTENSION_LENGTH ? name.slice(lastDot) : '';
    const body = truncateName(
      extension ? name.slice(0, lastDot) : name,
      maxLength - Array.from(extension).length,
      maxBytes - utf8Length(extension)
    );
    name = (body.replace(/[.\s]+$/, '') || fallback) + extension;
  }

  return name || fallback;
}

/** Extensions that can run programs or active content on the device that opens them. */
const RISKY_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'jse', 'wsf', 'hta', 'lnk', 'apk', 'appx',
  'dmg', 'pkg', 'app', 'jar', 'html', 'htm', 'svg', 'xhtml', 'docm', 'xlsm', 'pptm', 'iso', 'img',
  // Windows programs, scripts, shortcuts, installers and disk images (#1305).
  'vbe', 'pif', 'cpl', 'msc', 'reg', 'msp', 'scf', 'ws', 'wsh', 'chm', 'url', 'library-ms',
  'settingcontent-ms', 'application', 'appref-ms', 'msix', 'msixbundle', 'appxbundle', 'ps1xml',
  'psm1', 'psd1', 'vhd', 'vhdx', 'jnlp',
  // Active web documents and Office formats that carry macros.
  'mht', 'mhtml', 'xht', 'shtml', 'dotm', 'xltm', 'xlam', 'potm', 'ppsm', 'ppam',
  // Unix and macOS scripts and launchers.
  'sh', 'command', 'desktop', 'py',
]);

/** MIME types that are active content whatever the extension says. */
const RISKY_MIME_TYPES: ReadonlySet<string> = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/javascript',
  'text/javascript',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/vnd.microsoft.portable-executable',
  'application/x-sh',
  'application/java-archive',
  'application/vnd.android.package-archive',
]);

/** Extensions whose MIME type is well known, used to spot a name and type that disagree. */
const EXTENSION_MIME: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  zip: 'application/zip',
  html: 'text/html',
  htm: 'text/html',
  svg: 'image/svg+xml',
};

/** Extensions that look harmless, so a risky one right after them (`.pdf.exe`) is a disguise. */
const DISGUISE_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp3', 'mp4', 'csv', 'zip',
]);

export interface ReceivedFileAnalysis {
  /** The name the file will be saved under: sanitised, capped, never empty. */
  safeName: string;
  /** True when sanitising changed the name the sender announced. */
  nameChanged: boolean;
  /** Last extension without the dot, lowercase; empty when there is none. */
  extension: string;
  /** MIME type to save with: the announced one, or `application/octet-stream` when it disagrees. */
  mimeType: string;
  /** True when the announced MIME type disagreed with the extension and was replaced. */
  mimeMismatch: boolean;
  /** True when the type can run programs or active content; saving needs a second confirmation. */
  risky: boolean;
  /** True for a harmless-looking extension followed by a risky one, e.g. `photo.jpg.exe`. */
  doubleExtension: boolean;
  /** Short plain-language notes for the person saving the file. */
  notices: string[];
}

/**
 * Looks at the name and MIME type a sender announced for a received file. Nothing is blocked: the
 * result says what the file will be saved as and whether the person should confirm first.
 * @param fileName - The announced name, untrusted.
 * @param mimeType - The announced MIME type, untrusted.
 */
export function analyseReceivedFile(fileName: string, mimeType: string): ReceivedFileAnalysis {
  const safeName = sanitizeFileName(fileName, { fallback: 'received_file' });
  const parts = safeName.toLowerCase().split('.');
  const extensions = parts.length > 1 ? parts.slice(1) : [];
  const extension = extensions[extensions.length - 1] ?? '';
  const previous = extensions.length > 1 ? extensions[extensions.length - 2] : '';

  const claimed = mimeType.split(';')[0].trim().toLowerCase();
  const expected = EXTENSION_MIME[extension];
  const mimeMismatch = Boolean(expected && claimed && claimed !== 'application/octet-stream' && claimed !== expected);

  const doubleExtension = RISKY_EXTENSIONS.has(extension) && DISGUISE_EXTENSIONS.has(previous);
  const risky = RISKY_EXTENSIONS.has(extension) || RISKY_MIME_TYPES.has(claimed);

  const notices: string[] = [];
  if (safeName !== fileName) notices.push('The file name was cleaned: hidden characters, path parts or unsafe symbols were removed.');
  if (doubleExtension) notices.push(`The name ends in ".${previous}.${extension}". The real type is .${extension}.`);
  if (mimeMismatch) notices.push('The file name and its announced type disagree, so it will be saved as a generic binary file.');

  return {
    safeName,
    nameChanged: safeName !== fileName,
    extension,
    mimeType: mimeMismatch ? 'application/octet-stream' : mimeType || 'application/octet-stream',
    mimeMismatch,
    risky,
    doubleExtension,
    notices,
  };
}
