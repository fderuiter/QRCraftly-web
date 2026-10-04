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

/** The preview views. Kept apart from the scene drawings so the control costs almost nothing to load. */
export const PREVIEW_VIEWS = [
  { value: 'flat', label: 'Flat' },
  { value: 'poster', label: 'Poster' },
  { value: 'card', label: 'Card' },
  { value: 'table-tent', label: 'Table tent' },
  { value: 'screen', label: 'Screen' },
  { value: 'sticker', label: 'Sticker' },
] as const;

export type PreviewView = (typeof PREVIEW_VIEWS)[number]['value'];
