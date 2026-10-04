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
import { QR_GENERATORS, checkCryptoAddress, parseProtocol } from '@/packages/qr-payload';
import { hasInvisibleCharacters, revealInvisibleCharacters } from '@/utils/fileNames';

/** One line of the readable summary, for example "Network: Cafe guest". */
export interface ScanSummaryRow {
  label: string;
  value: string;
  /** True for a password or key: hidden until the reader chooses to show it. */
  secret?: boolean;
}

/** What a scanned code holds beyond its type: rows for the sheet, cautions to read first. */
export interface ContentNotes {
  rows: ScanSummaryRow[];
  cautions: string[];
  /** The secret value (Wi-Fi password, authenticator key), when the code holds one. */
  secret: string | null;
  /** The text with the secret replaced by bullets. */
  redacted: string;
  /** Replaces the type's readable name, for example "Authenticator key". */
  typeLabel?: string;
}

/** Stands in for a hidden password or key. */
const MASK = '\u2022'.repeat(8);

const WIFI_SECURITY: Record<WifiEncryption, string> = {
  [WifiEncryption.WPA]: 'WPA/WPA2/WPA3',
  [WifiEncryption.WEP]: 'WEP (outdated)',
  [WifiEncryption.NOPASS]: 'None (open network)',
  [WifiEncryption.WPA2_EAP]: 'WPA2 Enterprise',
};

/** Keeps only the rows that have a value. */
export function rows(entries: readonly (readonly [label: string, value: string | undefined, secret?: boolean])[]): ScanSummaryRow[] {
  return entries
    .filter((entry): entry is readonly [string, string, boolean?] => typeof entry[1] === 'string' && entry[1].trim() !== '')
    .map(([label, value, secret]) => (secret ? { label, value: revealInvisibleCharacters(value.trim()), secret } : { label, value: revealInvisibleCharacters(value.trim()) }));
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Splits a recipient list on commas and semicolons, dropping empty entries. */
function recipients(list: string | null | undefined): string[] {
  return (list ?? '')
    .split(/[,;]/)
    .map((entry) => decode(entry).trim())
    .filter(Boolean);
}

/** A readable date, or the raw value when it does not parse. */
function readableDate(value: string): string {
  if (!value) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function emailNotes(text: string): ContentNotes | null {
  const parsed = parseProtocol(text);
  if (!parsed || parsed.scheme !== 'mailto') return null;
  const to = recipients(decode(parsed.path)).concat(recipients(parsed.params.get('to')));
  const cc = recipients(parsed.params.get('cc'));
  const bcc = recipients(parsed.params.get('bcc'));
  const body = parsed.params.get('body') ?? '';
  const cautions: string[] = [];
  if (bcc.length > 0) cautions.push('This message also goes to hidden recipients (Bcc) you cannot see on the sent message.');
  if (cc.length > 0) cautions.push('This message is copied to other people (Cc).');
  if (to.length + cc.length + bcc.length > 1) cautions.push(`This message is addressed to ${to.length + cc.length + bcc.length} people.`);
  if (body) cautions.push('The message text is filled in for you. Read it before you send.');
  return {
    rows: rows([
      ['To', to.join(', ')],
      ['Cc', cc.join(', ')],
      ['Bcc', bcc.join(', ')],
      ['Subject', parsed.params.get('subject') ?? ''],
      ['Message', body],
    ]),
    cautions,
    secret: null, redacted: text,
  };
}

function smsNotes(text: string): ContentNotes | null {
  const parsed = parseProtocol(text);
  if (!parsed || (parsed.scheme !== 'sms' && parsed.scheme !== 'smsto')) return null;
  const numbers = recipients(parsed.path);
  const cautions: string[] = [];
  if (numbers.length > 1) cautions.push(`This text goes to ${numbers.length} numbers at once.`);
  if (numbers.some((number) => /^\d{3,6}$/.test(number))) {
    cautions.push('A short number like this can be a paid service. Check your plan before you send.');
  }
  return {
    rows: rows([
      [numbers.length > 1 ? 'To (all of these)' : 'To', numbers.join(', ')],
      ['Message', parsed.params.get('body') ?? ''],
    ]),
    cautions,
    secret: null, redacted: text,
  };
}

function phoneNotes(text: string): ContentNotes | null {
  const parsed = parseProtocol(text);
  if (!parsed || parsed.scheme !== 'tel') return null;
  const number = decode(parsed.path).trim();
  const cautions: string[] = [];
  if (/^[*#]|[*#]$/.test(number)) {
    cautions.push(
      'This is a dialer code (USSD), not an ordinary phone number. Codes like this can change phone settings, forward calls or move money. Only dial it if you trust where it came from.'
    );
  }
  return { rows: rows([['Number', number]]), cautions, secret: null, redacted: text };
}

function wifiNotes(text: string): ContentNotes {
  const wifi = QR_GENERATORS[QRType.WIFI].hydrate(text);
  const cautions: string[] = [];
  if (wifi.encryption === WifiEncryption.NOPASS) {
    cautions.push('This network has no password. Other people nearby can read what you send over it.');
  } else if (wifi.encryption === WifiEncryption.WEP) {
    cautions.push('WEP is an outdated protection that can be broken in minutes. Treat this network as open.');
  }
  return {
    rows: rows([
      ['Network', wifi.ssid],
      ['Security', WIFI_SECURITY[wifi.encryption]],
      ['Password', wifi.password, true],
      ['Hidden network', wifi.hidden ? 'Yes' : undefined],
    ]),
    cautions,
    secret: wifi.password || null,
    // The password sits in the `P:` field; `\;` inside it is an escaped semicolon.
    redacted: text.replace(/((?:^|;)P:)(?:\\.|[^;\\])*/, `$1${MASK}`),
  };
}

function authenticatorNotes(text: string): ContentNotes | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'otpauth:') return null;
  const secret = url.searchParams.get('secret') ?? '';
  const label = decode(url.pathname.replace(/^\//, ''));
  return {
    rows: rows([
      ['Kind', url.hostname === 'hotp' ? 'Counter-based login code' : 'Time-based login code'],
      ['Account', label],
      ['Issuer', url.searchParams.get('issuer') ?? ''],
      ['Secret key', secret, true],
    ]),
    cautions: [
      'This code holds the secret key for login codes (two-factor authentication). Anyone who sees it can make your codes. Add it only to your own authenticator app and never share it.',
    ],
    secret: secret || null,
    redacted: text.replace(/([?&]secret=)[^&#]*/i, `$1${MASK}`),
    typeLabel: 'Authenticator key',
  };
}

function paymentNotes(text: string): ContentNotes {
  const payment = QR_GENERATORS[QRType.PAYMENT].hydrate(text);
  const check = checkCryptoAddress(payment.network, payment.address);
  const cautions =
    check === 'invalid'
      ? ['The address does not pass its built-in check, so it has a typo or is not a real address. Money sent to it can be lost for good.']
      : [];
  return {
    rows: rows([
      ['Network', payment.network],
      ['Address', payment.address],
      ['Address check', check === 'valid' ? 'Checksum matches' : check === 'invalid' ? 'Checksum does not match' : undefined],
      ['Amount', payment.amount],
    ]),
    cautions,
    secret: null, redacted: text,
  };
}

/**
 * Reads what a scanned non-link code holds: readable rows, cautions to show first, and any
 * secret that must stay hidden until the reader asks for it (#1158).
 * @param type - The code's generator type.
 * @param text - The decoded text.
 * @returns Rows, cautions and the secret.
 */
export function describeContent(type: QRType, text: string): ContentNotes {
  const notes: ContentNotes = authenticatorNotes(text) ?? describeByType(type, text);
  if (hasInvisibleCharacters(text.replace(/[\t\r\n]/g, ''))) {
    notes.cautions.push(
      'This code contains hidden characters, such as ones that reverse the reading direction. They are shown in brackets below, for example [U+202E].'
    );
  }
  return notes;
}

function describeByType(type: QRType, text: string): ContentNotes {
  const empty: ContentNotes = { rows: [], cautions: [], secret: null, redacted: text };
  try {
    switch (type) {
      case QRType.WIFI:
        return wifiNotes(text);
      case QRType.EMAIL:
        return emailNotes(text) ?? { rows: rows([['To', QR_GENERATORS[QRType.EMAIL].hydrate(text).email]]), cautions: [], secret: null, redacted: text };
      case QRType.SMS:
        return smsNotes(text) ?? empty;
      case QRType.PHONE:
        return phoneNotes(text) ?? empty;
      case QRType.PAYMENT:
        return paymentNotes(text);
      case QRType.VCARD: {
        const card = QR_GENERATORS[QRType.VCARD].hydrate(text);
        return { ...empty, rows: rows([['Name', `${card.firstName} ${card.lastName}`], ['Organization', card.organization], ['Phone', card.phone], ['Email', card.email]]) };
      }
      case QRType.EVENT: {
        const event = QR_GENERATORS[QRType.EVENT].hydrate(text);
        return {
          ...empty,
          rows: rows([['Event', event.title], ['Starts', readableDate(event.startDate)], ['Ends', readableDate(event.endDate)], ['Location', event.location]]),
        };
      }
      case QRType.LOCATION: {
        const place = QR_GENERATORS[QRType.LOCATION].hydrate(text);
        return { ...empty, rows: rows([['Coordinates', place.latitude && place.longitude ? `${place.latitude}, ${place.longitude}` : undefined]]) };
      }
      default:
        return empty;
    }
  } catch {
    return empty;
  }
}
