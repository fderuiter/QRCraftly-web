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

import { QRType, WifiEncryption } from '@/types';
import { QR_GENERATORS, identifyProtocol } from '@/packages/qr-payload';
import { getQRTypeLabel } from '@/data/qrTypeLabels';
import { isDangerousUrl } from '@/utils/security';
import { analyseLink, type LinkFinding } from '@/packages/link-safety';
import { hasMixedScripts, toUnicodeHostname } from '@/utils/hostname';

/** One line of the readable summary, for example "Network: Cafe guest". */
export interface ScanSummaryRow {
  label: string;
  value: string;
}

/** What a scanned web address really points at. */
export interface ScanLink {
  /** The address to open, exactly as scanned. */
  href: string;
  /** The hostname a person reads, with Punycode decoded. */
  host: string;
  /** The hostname as the browser sends it (`xn--` labels kept). */
  asciiHost: string;
  /** True for `https:`; `http:` links are not encrypted. */
  secure: boolean;
  /** True when the hostname has non-ASCII (internationalised) labels. */
  international: boolean;
  /** True when a label mixes scripts, the usual sign of a lookalike address. */
  mixedScripts: boolean;
  /** Signs the address may not be what it seems, cautions first. Empty for an ordinary address. */
  findings: LinkFinding[];
}

/** A decoded QR code, described for the result sheet. */
export interface ScanDescription {
  /** The decoded text. */
  text: string;
  /** The generator type it loads as. */
  type: QRType;
  /** The type's readable name. */
  typeLabel: string;
  /** A few readable facts about the content. */
  summary: ScanSummaryRow[];
  /** The web address, for `http:` and `https:` content that is safe to offer. */
  link: ScanLink | null;
  /**
   * True when the content is a script or data address (`javascript:`, `data:`, `vbscript:`,
   * including obfuscated forms). Only Copy is offered then.
   */
  blocked: boolean;
}

const WIFI_SECURITY: Record<WifiEncryption, string> = {
  [WifiEncryption.WPA]: 'WPA/WPA2/WPA3',
  [WifiEncryption.WEP]: 'WEP (outdated)',
  [WifiEncryption.NOPASS]: 'None (open network)',
  [WifiEncryption.WPA2_EAP]: 'WPA2 Enterprise',
};

/** Keeps only the rows that have a value. */
function rows(entries: readonly (readonly [label: string, value: string | undefined])[]): ScanSummaryRow[] {
  return entries
    .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '')
    .map(([label, value]) => ({ label, value: value.trim() }));
}

/** A calendar date as the reader's locale writes it, or the raw value when it does not parse. */
function readableDate(value: string): string {
  if (!value) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function summarize(type: QRType, text: string): ScanSummaryRow[] {
  try {
    switch (type) {
      case QRType.WIFI: {
        const wifi = QR_GENERATORS[QRType.WIFI].hydrate(text);
        return rows([
          ['Network', wifi.ssid],
          ['Security', WIFI_SECURITY[wifi.encryption]],
          ['Hidden network', wifi.hidden ? 'Yes' : undefined],
        ]);
      }
      case QRType.VCARD: {
        const card = QR_GENERATORS[QRType.VCARD].hydrate(text);
        return rows([
          ['Name', `${card.firstName} ${card.lastName}`],
          ['Organization', card.organization],
          ['Phone', card.phone],
          ['Email', card.email],
        ]);
      }
      case QRType.EVENT: {
        const event = QR_GENERATORS[QRType.EVENT].hydrate(text);
        return rows([
          ['Event', event.title],
          ['Starts', readableDate(event.startDate)],
          ['Ends', readableDate(event.endDate)],
          ['Location', event.location],
        ]);
      }
      case QRType.EMAIL: {
        const message = QR_GENERATORS[QRType.EMAIL].hydrate(text);
        return rows([
          ['To', message.email],
          ['Subject', message.subject],
        ]);
      }
      case QRType.SMS: {
        const sms = QR_GENERATORS[QRType.SMS].hydrate(text);
        return rows([
          ['To', sms.number],
          ['Message', sms.message],
        ]);
      }
      case QRType.PHONE:
        return rows([['Number', QR_GENERATORS[QRType.PHONE].hydrate(text).number]]);
      case QRType.LOCATION: {
        const place = QR_GENERATORS[QRType.LOCATION].hydrate(text);
        return rows([['Coordinates', place.latitude && place.longitude ? `${place.latitude}, ${place.longitude}` : undefined]]);
      }
      case QRType.PAYMENT: {
        const payment = QR_GENERATORS[QRType.PAYMENT].hydrate(text);
        return rows([
          ['Network', payment.network],
          ['Address', payment.address],
          ['Amount', payment.amount],
        ]);
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/**
 * Reads a web address out of the content, when it is one.
 * @param text - The decoded text.
 * @returns The link, or null for anything that is not an `http:` or `https:` address.
 */
function readLink(text: string): ScanLink | null {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = toUnicodeHostname(url.hostname);
  return {
    href: trimmed,
    host,
    asciiHost: url.hostname,
    secure: url.protocol === 'https:',
    international: host !== url.hostname,
    mixedScripts: hasMixedScripts(host),
    findings: analyseLink(trimmed),
  };
}

/**
 * Describes a decoded QR code for the result sheet: its generator type, a readable summary,
 * the real host of a web address, and whether it must be blocked.
 * @param text - The decoded text.
 * @returns The description.
 */
export function describeScan(text: string): ScanDescription {
  const type = identifyProtocol(text) ?? QRType.TEXT;
  const blocked = isDangerousUrl(text);
  return {
    text,
    type,
    typeLabel: getQRTypeLabel(type),
    summary: blocked ? [] : summarize(type, text),
    link: blocked ? null : readLink(text),
    blocked,
  };
}

/**
 * A short phrase for announcements, such as "URL, example.com" or "WiFi, Cafe guest".
 * @param scan - The description.
 * @returns The phrase.
 */
export function scanHeadline(scan: ScanDescription): string {
  if (scan.blocked) return 'blocked script link';
  const detail = scan.link?.host ?? scan.summary[0]?.value;
  return detail ? `${scan.typeLabel}, ${detail}` : scan.typeLabel;
}
