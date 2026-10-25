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
 * The configurations every export round-trip test decodes (#1610): the default look, a logo
 * over the centre at error correction H, and a vCard with non-ASCII text.
 */
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { QRErrorCorrectionLevel, QRStyle, QRType, type QRConfig } from '@/packages/core/types';
import { constructVCardString } from '@/packages/qr-payload';

const base: QRConfig = {
  ...(DEFAULT_CONFIG as QRConfig),
  value: 'https://qrcraftly.com/round-trip',
  type: QRType.URL,
  style: QRStyle.STANDARD,
  fgColor: '#000000',
  bgColor: '#ffffff',
  eyeColor: '#000000',
  gradientType: 'none',
  logoUrl: null,
  isBorderEnabled: false,
  frameStyle: 'none',
};

/** A 1 x 1 PNG; the tests' image loaders stand in for its pixels. */
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const EXPORT_CASES: { name: string; config: QRConfig }[] = [
  { name: 'the default style', config: base },
  {
    name: 'a logo at error correction H',
    config: { ...base, logoUrl: LOGO, errorCorrectionLevel: QRErrorCorrectionLevel.H },
  },
  {
    name: 'a vCard with non-ASCII text',
    config: {
      ...base,
      type: QRType.VCARD,
      value: constructVCardString({
        firstName: 'Zoë',
        lastName: 'Müller-Ødegård',
        organization: 'Café Ünïcode 東京',
        title: '',
        phone: '+4930123456',
        email: 'zoe@example.com',
        website: '',
        street: 'Straße 1',
        city: 'München',
        zip: '80331',
        country: 'Deutschland',
      }),
    },
  },
];
