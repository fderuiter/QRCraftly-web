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

import { QRType } from '@/packages/core/types';
import { QR_GENERATORS, type QRPayloadDataMap } from './registry';

/** The QR type's name as screen readers and exported SVG titles give it. */
export function getQrTypeLabel(type: QRType): string {
  switch (type) {
    case QRType.WIFI:
      return 'WiFi Network';
    case QRType.URL:
      return 'URL';
    case QRType.TEXT:
      return 'Text';
    case QRType.EVENT:
      return 'Event';
    case QRType.VCARD:
      return 'Contact';
    case QRType.EMAIL:
      return 'Email';
    case QRType.PHONE:
      return 'Phone';
    case QRType.SMS:
      return 'SMS';
    case QRType.PAYMENT:
      return 'Payment';
    case QRType.LOCATION:
      return 'Location';
    case QRType.MEETING:
      return 'Meeting';
    case QRType.SOCIAL:
      return 'Social';
    case QRType.BULK_CSV:
      return 'Bulk CSV Batch';
    default:
      return type;
  }
}

const DESCRIBERS: { [K in QRType]: (data: QRPayloadDataMap[K]) => string } = {
  [QRType.WIFI]: (data) => data.ssid || '',
  [QRType.URL]: (data) => data.url || '',
  [QRType.TEXT]: (data) => data.text || '',
  [QRType.EVENT]: (data) => data.title || '',
  [QRType.VCARD]: (data) => {
    const nameParts = [data.firstName, data.lastName].filter(Boolean);
    return nameParts.join(' ') || data.organization || '';
  },
  [QRType.EMAIL]: (data) => data.email || '',
  [QRType.PHONE]: (data) => data.number || '',
  [QRType.SMS]: (data) => data.number || '',
  [QRType.PAYMENT]: (data) => data.address || '',
  [QRType.LOCATION]: (data) => (data.latitude && data.longitude ? `${data.latitude}, ${data.longitude}` : ''),
  [QRType.MEETING]: (data) => data.url || '',
  [QRType.SOCIAL]: (data) => (data.handle ? `@${data.handle}` : ''),
  [QRType.BULK_CSV]: (data) => data.fileName || 'Bulk CSV Batch',
};

function describePayload<K extends QRType>(type: K, value: string): string {
  const data = QR_GENERATORS[type].hydrate(value);
  if (!data) return value;
  return DESCRIBERS[type](data);
}

/** A short plain-text description of a payload, such as the network name of a Wi-Fi code. */
export function getQrTypeDescription(type: QRType, value: string): string {
  if (!value) return '';
  if (!Object.prototype.hasOwnProperty.call(QR_GENERATORS, type)) return value;
  try {
    return describePayload(type, value);
  } catch {
    return value;
  }
}
