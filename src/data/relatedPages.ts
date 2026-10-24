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
import { contentRegistry } from '@/data/contentRegistry';
import { LANDING_PAGE_IDS } from '@/data/landingPages';

/** The generator page of each QR type, by registry id. */
export const TYPE_PAGE_TYPES: Readonly<Record<string, QRType>> = {
  index: QRType.URL,
  'text-qr-code': QRType.TEXT,
  'wifi-qr-code': QRType.WIFI,
  'vcard-qr-code': QRType.VCARD,
  'email-qr-code': QRType.EMAIL,
  'phone-qr-code': QRType.PHONE,
  'sms-qr-code': QRType.SMS,
  'event-qr-code': QRType.EVENT,
  'location-qr-code': QRType.LOCATION,
  'meeting-qr-code': QRType.MEETING,
  'payment-qr-code': QRType.PAYMENT,
  'social-qr-code': QRType.SOCIAL,
  'bulk-csv-qr-code': QRType.BULK_CSV,
};

const TYPE_PAGE_IDS = Object.keys(TYPE_PAGE_TYPES);

export interface RelatedPage {
  id: string;
  name: string;
  href: string;
}

/**
 * Picks the other pages of a group to link from a page: the ones that follow it in the group's
 * order, wrapping round, so every page links onward and every page is linked to.
 * @param ids - Registry ids of the group, in order.
 * @param id - Registry id of the current page.
 * @param count - How many pages to return.
 * @returns Related pages, never including the page itself.
 */
function followingPages(ids: readonly string[], id: string, count: number): RelatedPage[] {
  const start = ids.indexOf(id);
  const related: RelatedPage[] = [];
  for (let step = 1; related.length < count && step <= ids.length; step++) {
    const relatedId = ids[(start + step) % ids.length];
    if (relatedId === id) continue;
    related.push({ id: relatedId, name: contentRegistry[relatedId].name, href: relatedId === 'index' ? '/' : `/${relatedId}` });
  }
  return related;
}

/**
 * Picks the other generator pages to link from a page. A generator page links to the generator
 * pages that follow it, and a landing page (#1035, #1037) to the landing pages that follow it.
 * @param id - Registry id of the current page.
 * @param count - How many pages to return.
 * @returns Related pages, never including the page itself.
 */
export function getRelatedTypePages(id: string, count = 4): RelatedPage[] {
  if (TYPE_PAGE_IDS.includes(id)) return followingPages(TYPE_PAGE_IDS, id, count);
  if (LANDING_PAGE_IDS.includes(id)) return followingPages(LANDING_PAGE_IDS, id, count);
  return [];
}

/**
 * Describes the example QR code picture a generator page shows.
 * @param id - Registry id of the page.
 * @returns The picture's address and alt text, or undefined for pages without one.
 */
export function getExampleImage(id: string): { src: string; alt: string } | undefined {
  if (!(id in TYPE_PAGE_TYPES)) return undefined;
  const { name } = contentRegistry[id];
  return {
    src: `/examples/${id}.svg`,
    alt: `Example of a QR code made with the ${name}, built from sample data`,
  };
}
