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


import { getGuide } from './guides';
import type { RelatedPage } from './relatedPages';

/**
 * The guides each tool page links to in its body, by registry id (#1309). Each guide is linked
 * from at least three tool pages, so search engines do not see it as reachable only from the
 * `/guides` index. `pageGuides.test.ts` checks both.
 */
export const PAGE_GUIDES: Readonly<Record<string, readonly string[]>> = {
  index: ['why-qr-codes-stop-working', 'static-vs-dynamic-qr-codes', 'how-to-print-a-qr-code-that-scans'],
  'free-forever': ['why-qr-codes-stop-working', 'static-vs-dynamic-qr-codes'],
  'pdf-qr-code': ['why-qr-codes-stop-working', 'static-vs-dynamic-qr-codes'],
  'menu-qr-code': ['how-to-print-a-qr-code-that-scans', 'why-qr-codes-stop-working'],
  'google-review-qr-code': ['static-vs-dynamic-qr-codes', 'how-to-print-a-qr-code-that-scans'],
  'qr-code-with-logo': ['qr-code-error-correction-explained', 'how-to-print-a-qr-code-that-scans'],
  'mosaic-qr-code': ['qr-code-error-correction-explained', 'how-to-print-a-qr-code-that-scans'],
  'bulk-csv-qr-code': ['how-to-print-a-qr-code-that-scans'],
  'payment-qr-code': ['qr-code-scams-quishing'],
  'qr-code-scanner': ['qr-code-scams-quishing', 'why-qr-codes-stop-working'],
  'qr-code-checker': ['qr-code-scams-quishing', 'how-to-print-a-qr-code-that-scans', 'qr-code-error-correction-explained'],
  arcade: ['qr-code-error-correction-explained'],
};

/**
 * Lists the guides a page links to.
 * @param id - Registry id of the page.
 * @returns Links to the page's guides, empty for pages without any.
 */
export function getPageGuides(id: string): RelatedPage[] {
  return (PAGE_GUIDES[id] ?? []).flatMap((slug) => {
    const guide = getGuide(slug);
    return guide ? [{ id: `guides/${slug}`, name: guide.shortTitle, href: `/guides/${slug}` }] : [];
  });
}
