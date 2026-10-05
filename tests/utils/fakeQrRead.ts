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
 * A made-up read for tests that mock `@/packages/qr-decode`: the given text as a version 1 code at
 * level M, its corners at the four corners of a 21-pixel square.
 */
import type { QrRead } from '@/packages/qr-decode';

export function fakeQrRead(text: string): QrRead {
  const bytes = new TextEncoder().encode(text);
  return {
    text,
    bytes,
    segments: [{ mode: 'byte', eci: null, bytes }],
    version: 1,
    level: 'M',
    mask: 0,
    mirrored: false,
    inverted: false,
    corrected: 0,
    corners: [
      { x: 0, y: 0 },
      { x: 21, y: 0 },
      { x: 21, y: 21 },
      { x: 0, y: 21 },
    ],
    finders: [
      { x: 3.5, y: 3.5 },
      { x: 17.5, y: 3.5 },
      { x: 3.5, y: 17.5 },
    ],
    alignment: null,
    structuredAppend: null,
    fnc1: null,
  };
}
