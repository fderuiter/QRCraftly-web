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

import { QRType } from '@/packages/core/types';

/** Human-readable names for QR types, used in announcements and toasts (never raw enum values). */
const QR_TYPE_LABELS: Record<QRType, string> = {
  [QRType.URL]: 'URL',
  [QRType.TEXT]: 'Text',
  [QRType.WIFI]: 'WiFi',
  [QRType.EVENT]: 'Event',
  [QRType.EMAIL]: 'Email',
  [QRType.VCARD]: 'vCard contact',
  [QRType.PHONE]: 'Phone',
  [QRType.SMS]: 'SMS',
  [QRType.PAYMENT]: 'Payment',
  [QRType.LOCATION]: 'Location',
  [QRType.MEETING]: 'Meeting',
  [QRType.SOCIAL]: 'Social',
  [QRType.BULK_CSV]: 'Bulk CSV Batch',
};

/**
 * Returns the human-readable label for a QR type.
 * @param type - The QR type.
 * @returns The display label, falling back to the raw value for unknown types.
 */
export function getQRTypeLabel(type: QRType): string {
  return QR_TYPE_LABELS[type] ?? type;
}
