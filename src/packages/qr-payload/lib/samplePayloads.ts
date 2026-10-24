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

import { CryptoNetwork, SocialPlatform } from '@/types';
import { QRType, WifiEncryption } from '@/packages/core/types';
import { formatPayload } from './registry';

/**
 * Default type-aware sample fallback payload generator data for all 13 QR types.
 */
export const SAMPLE_PAYLOADS: Record<QRType, string> = {
  [QRType.URL]: 'https://qrcraftly.com',
  [QRType.TEXT]: 'Welcome to QRCraftly! Customize colors, frames, and patterns.',
  [QRType.BULK_CSV]: formatPayload(QRType.BULK_CSV, {
    csvContent: 'url,name\nhttps://qrcraftly.com,QRCraftly',
    payloadColumn: 'url',
    filenameColumn: 'name',
    exportFormat: 'png',
  }),
  [QRType.WIFI]: formatPayload(QRType.WIFI, {
    ssid: 'QRCraftly_Guest',
    password: 'examplepass123',
    encryption: WifiEncryption.WPA,
    hidden: false,
  }),
  [QRType.VCARD]: formatPayload(QRType.VCARD, {
    firstName: 'Jane',
    lastName: 'Doe',
    organization: 'QRCraftly',
    title: 'Product Designer',
    phone: '+1 555-0199',
    email: 'jane.doe@example.com',
    website: 'https://qrcraftly.com',
    street: '123 Tech Lane',
    city: 'San Francisco',
    zip: '94105',
    country: 'USA',
  }),
  [QRType.EMAIL]: formatPayload(QRType.EMAIL, {
    email: 'hello@example.com',
    subject: 'Inquiry',
    body: 'Hello from QRCraftly!',
  }),
  [QRType.PHONE]: formatPayload(QRType.PHONE, {
    number: '+1 555-0199',
  }),
  [QRType.SMS]: formatPayload(QRType.SMS, {
    number: '+1 555-0199',
    message: 'Hello from QRCraftly!',
  }),
  [QRType.PAYMENT]: formatPayload(QRType.PAYMENT, {
    network: CryptoNetwork.BITCOIN,
    address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    amount: '0.01',
    label: 'Coffee',
  }),
  [QRType.EVENT]: formatPayload(QRType.EVENT, {
    title: 'QRCraftly Launch',
    startDate: '2026-10-15T10:00',
    endDate: '2026-10-15T12:00',
    location: 'San Francisco, CA',
    description: 'Sample Event Description',
  }),
  [QRType.LOCATION]: formatPayload(QRType.LOCATION, {
    latitude: '37.7749',
    longitude: '-122.4194',
  }),
  [QRType.MEETING]: formatPayload(QRType.MEETING, {
    url: 'https://meet.example.com/qrcraftly-demo',
  }),
  [QRType.SOCIAL]: formatPayload(QRType.SOCIAL, {
    platform: SocialPlatform.INSTAGRAM,
    handle: 'qrcraftly',
  }),
};

/**
 * Returns the fallback sample payload string for a given QRType.
 *
 * @param type - The QRType enum value.
 * @returns The formatted sample payload string.
 */
export function getSamplePayload(type: QRType): string {
  return SAMPLE_PAYLOADS[type] ?? SAMPLE_PAYLOADS[QRType.URL];
}
