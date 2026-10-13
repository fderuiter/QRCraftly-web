/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { QRType } from '@/types';

/**
 * One destination in the site-wide primary navigation.
 */
export interface PrimaryNavItem {
  /** Stable identifier. */
  id: 'create' | 'transfer' | 'arcade' | 'about' | 'security';
  /** Visible label, identical on every route family. */
  label: string;
  /** Destination path. */
  href: string;
  /** Pill shown after the label for unfinished features. */
  tag?: 'Beta';
}

/**
 * Canonical route for each QR type's generator page. The type selector links to these,
 * so the URL, metadata and the selected type always come from the same route.
 */
export const QR_TYPE_ROUTES: Record<QRType, string> = {
  [QRType.URL]: '/',
  [QRType.TEXT]: '/text-qr-code',
  [QRType.WIFI]: '/wifi-qr-code',
  [QRType.EVENT]: '/event-qr-code',
  [QRType.VCARD]: '/vcard-qr-code',
  [QRType.EMAIL]: '/email-qr-code',
  [QRType.PHONE]: '/phone-qr-code',
  [QRType.SMS]: '/sms-qr-code',
  [QRType.PAYMENT]: '/payment-qr-code',
  [QRType.LOCATION]: '/location-qr-code',
  [QRType.MEETING]: '/meeting-qr-code',
  [QRType.SOCIAL]: '/social-qr-code',
  [QRType.BULK_CSV]: '/bulk-csv-qr-code',
};

/**
 * The single primary-navigation data model rendered by the app shell header on every route.
 * It feeds both the inline desktop links and the narrow-screen menu. Security, the pledge
 * and the generator list live in the app shell footer.
 */
export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { id: 'create', label: 'Create QR', href: '/' },
  { id: 'transfer', label: 'File Transfer', href: '/file-transfer', tag: 'Beta' },
  { id: 'arcade', label: 'Arcade', href: '/arcade' },
  { id: 'about', label: 'About', href: '/about' },
  { id: 'security', label: 'Security', href: '/security' },
];

/** Generator links listed in the app shell footer, one per QR type route. */
export const GENERATOR_FOOTER_LINKS: readonly (readonly [label: string, href: string])[] = [
  ['URL QR Code', QR_TYPE_ROUTES[QRType.URL]],
  ['Text QR Code', QR_TYPE_ROUTES[QRType.TEXT]],
  ['WiFi QR Code', QR_TYPE_ROUTES[QRType.WIFI]],
  ['vCard QR Code', QR_TYPE_ROUTES[QRType.VCARD]],
  ['Email QR Code', QR_TYPE_ROUTES[QRType.EMAIL]],
  ['Phone QR Code', QR_TYPE_ROUTES[QRType.PHONE]],
  ['SMS QR Code', QR_TYPE_ROUTES[QRType.SMS]],
  ['Payment QR Code', QR_TYPE_ROUTES[QRType.PAYMENT]],
  ['Event QR Code', QR_TYPE_ROUTES[QRType.EVENT]],
  ['Location QR Code', QR_TYPE_ROUTES[QRType.LOCATION]],
  ['Meeting QR Code', QR_TYPE_ROUTES[QRType.MEETING]],
  ['Social QR Code', QR_TYPE_ROUTES[QRType.SOCIAL]],
  ['Bulk CSV QR Codes', QR_TYPE_ROUTES[QRType.BULK_CSV]],
];

/** The tools beyond the generators, listed in the footer, on About and on the 404 page. */
export const TOOL_LINKS: readonly (readonly [label: string, href: string])[] = [
  ['QR Code Scanner', '/qr-code-scanner'],
  ['Send a File', '/file-transfer'],
  ['Receive a File', '/file-transfer/receive'],
  ['QR Arcade', '/arcade'],
  ['QR Code Checker', '/qr-code-checker'],
];

/** The landing pages that open the generator with presets for one job (#1035, #1037), listed in the footer. */
export const USE_CASE_LINKS: readonly (readonly [label: string, href: string])[] = [
  ['Image QR Code', '/mosaic-qr-code'],
  ['QR Code with Logo', '/qr-code-with-logo'],
  ['Google Review QR Code', '/google-review-qr-code'],
  ['Menu QR Code', '/menu-qr-code'],
  ['Instagram QR Code', '/instagram-qr-code'],
  ['WhatsApp QR Code', '/whatsapp-qr-code'],
  ['PDF QR Code', '/pdf-qr-code'],
  ['Static QR Code', '/static-qr-code-generator'],
  ['SVG QR Code', '/svg-qr-code'],
];

const GENERATOR_PATHS = new Set<string>(Object.values(QR_TYPE_ROUTES));

/**
 * Normalises a pathname: strips query/hash and any trailing slash (except for `/`).
 * @param pathname - Raw pathname.
 * @returns The normalised pathname.
 */
export function normalizePathname(pathname: string): string {
  const bare = pathname.split(/[?#]/)[0] || '/';
  return bare.length > 1 ? bare.replace(/\/+$/, '') || '/' : bare;
}

/**
 * Finds the primary destination that owns a pathname, so it can be marked with
 * `aria-current="page"`. Every generator route belongs to "Create QR", and both
 * `/file-transfer` and `/file-transfer/receive` belong to "File Transfer".
 * @param pathname - The current pathname.
 * @returns The owning item's id, or undefined when no primary destination matches.
 */
export function getCurrentPrimaryNavId(pathname: string): PrimaryNavItem['id'] | undefined {
  const path = normalizePathname(pathname);
  if (GENERATOR_PATHS.has(path)) return 'create';
  if (path === '/file-transfer' || path === '/file-transfer/receive') return 'transfer';
  return PRIMARY_NAV_ITEMS.find((item) => item.href === path)?.id;
}
