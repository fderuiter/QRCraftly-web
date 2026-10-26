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
 * The contact file reader (#1558), on its own entry so the vCard form loads it with `import()`
 * when a file is dropped or chosen, and no page carries it in its first load.
 */
export { readVCardFile, MAX_VCARD_FILE_BYTES, VCARD_FILE_ERROR_MESSAGES, type VCardFileResult, type VCardFileError } from './lib/vcardFile';
