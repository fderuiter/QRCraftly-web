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

import {
  BULK_CONTACT_FIELDS,
  isContactContentType,
  type BulkContentType,
} from '@/packages/qr-payload';

/** Standard downloadable sample CSV template for link bulk QR code generation. */
export const SAMPLE_CSV_TEMPLATE = `url,filename
https://qrcraftly.com,qrcraftly-website
https://qrcraftly.com/wifi-qr-code,wifi-qr-generator
https://qrcraftly.com/bulk-csv-qr-code,bulk-csv-generator`;

/** Starter CSV template for plain-text bulk QR code generation. */
export const SAMPLE_TEXT_CSV_TEMPLATE = `text,filename
ASSET-2026-001,warehouse-bin-01
ASSET-2026-002,warehouse-bin-02
Welcome to Workshop Room B,room-b-welcome`;

const VCARD_TEMPLATE_HEADER = [...BULK_CONTACT_FIELDS.map((field) => field.header), 'filename'].join(',');

/** Starter CSV template for eleven-field contact card (vCard) bulk QR code generation. */
export const SAMPLE_VCARD_CSV_TEMPLATE = [
  VCARD_TEMPLATE_HEADER,
  'Jane,Doe,Example Studio,Lead Designer,+1-555-0101,jane.doe@example.com,https://example.com/jane,"100 Market St, Suite 400",San Francisco,94105,United States,jane-doe-card',
  'Carlos,Rivera,Example Events,Event Director,+1-555-0102,carlos.rivera@example.com,https://qrcraftly.com,250 King St,Austin,78701,United States,carlos-rivera-card',
].join('\n');

export interface BulkCsvTemplateSpec {
  /** UTF-8 CSV content with starter headers and sample rows. */
  readonly csv: string;
  /** Suggested download file name for the selected content type. */
  readonly fileName: string;
}

/**
 * Resolves the starter CSV template and download file name for the active bulk content type.
 *
 * @param contentType Active bulk content type ('link', 'text', 'vcard', or 'contact').
 * @returns Starter CSV string and file name.
 */
export function getBulkCsvTemplate(contentType: BulkContentType = 'link'): BulkCsvTemplateSpec {
  if (isContactContentType(contentType)) {
    return {
      csv: SAMPLE_VCARD_CSV_TEMPLATE,
      fileName: 'qrcraftly-vcard-template.csv',
    };
  }
  if (contentType === 'text') {
    return {
      csv: SAMPLE_TEXT_CSV_TEMPLATE,
      fileName: 'qrcraftly-text-template.csv',
    };
  }
  return {
    csv: SAMPLE_CSV_TEMPLATE,
    fileName: 'qrcraftly-sample-template.csv',
  };
}
