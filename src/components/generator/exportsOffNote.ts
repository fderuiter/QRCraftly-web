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

/** Id of the empty-preview explanation referenced by disabled export buttons. */
export const EMPTY_STATE_ID = 'qr-empty-state';
/** Id of the explanation shown while a content field holds a refused value (#1279). */
export const REFUSED_STATE_ID = 'qr-refused-state';

/**
 * Why every export is off, as the id of the note that says so; undefined while exports work.
 * @param refused - A field holds a value the form refused.
 * @param isEmpty - The form is empty and the sample is shown.
 */
export function exportsOffNoteId(refused: boolean, isEmpty: boolean): string | undefined {
  if (refused) return REFUSED_STATE_ID;
  return isEmpty ? EMPTY_STATE_ID : undefined;
}
