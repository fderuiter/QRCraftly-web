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

import type { Page } from '@playwright/test';

/** Every prerendered route, plus an unknown path for the 404 page. */
export const ROUTES = [
  '/',
  '/text-qr-code',
  '/wifi-qr-code',
  '/vcard-qr-code',
  '/email-qr-code',
  '/phone-qr-code',
  '/sms-qr-code',
  '/payment-qr-code',
  '/event-qr-code',
  '/location-qr-code',
  '/meeting-qr-code',
  '/social-qr-code',
  '/bulk-csv-qr-code',
  '/about',
  '/acknowledgements',
  '/privacy',
  '/support',
  '/guides',
  '/guides/why-qr-codes-stop-working',
  '/guides/static-vs-dynamic-qr-codes',
  '/guides/how-to-print-a-qr-code-that-scans',
  '/guides/qr-code-error-correction-explained',
  '/guides/qr-code-scams-quishing',
  '/security',
  '/file-transfer',
  '/file-transfer/receive',
  '/arcade',
  '/qr-code-scanner',
  '/qr-code-checker',
  '/mosaic-qr-code',
  '/qr-code-with-logo',
  '/google-review-qr-code',
  '/menu-qr-code',
  '/instagram-qr-code',
  '/whatsapp-qr-code',
  '/pdf-qr-code',
  '/this-page-does-not-exist',
] as const;

/**
 * Opens a route and waits until React has hydrated it.
 * @param page - The page.
 * @param path - Route path.
 */
export async function gotoHydrated(page: Page, path: string) {
  await page.goto(path);
  await page.waitForSelector('main[data-hydrated="true"]');
}
