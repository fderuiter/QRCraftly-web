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

import { type QRConfig, QRType, WifiEncryption } from '@/types';
import { hydrateWifiData } from '@/packages/qr-payload';
import { resolveEncodedValue } from '@/packages/qr-matrix';
import { getContrastRatio, normalizeHex } from '@/utils/colorUtils';
import { REGEX_BIDI_CONTROL_CHARS, REGEX_STRICT_CONTROL_CHARS } from '@/utils/security';
import { WalletPassError } from './errors';

/** One label and value shown on a pass. */
export interface PassField {
  /** Unique within the pass; letters, digits and `-`. */
  key: string;
  label: string;
  value: string;
}

/** What a pass shows, independent of the wallet: the same content feeds Apple and Google passes. */
export interface PassContent {
  title: string;
  subtitle?: string;
  /** Up to four short fields on the front. */
  fields: PassField[];
  /** Longer fields on the back of an Apple pass, or in the details of a Google pass. */
  backFields: PassField[];
  /** What the code encodes, exactly as the generator encodes it. */
  message: string;
  /** Short text shown under the code, if any. */
  altText?: string;
}

/** Pass colours as `#rrggbb`. */
export interface PassColors {
  foreground: string;
  background: string;
  label: string;
}

/** Longest title, subtitle and field value, in characters. */
export const PASS_TEXT_LIMITS = { title: 60, subtitle: 80, field: 120, backField: 2000 } as const;

const MAX_FRONT_FIELDS = 4;
/** WCAG 2.1 contrast for normal text: pass text must stay readable on its background. */
const MIN_TEXT_CONTRAST = 4.5;

/** Removes control and hidden direction characters, collapses spaces and trims to `limit`. */
export function cleanPassText(text: string | undefined, limit: number): string {
  return (text ?? '').replace(REGEX_STRICT_CONTROL_CHARS, ' ').replace(REGEX_BIDI_CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** Why a content type gets no wallet pass, or `null` when it may have one. */
export function passRefusalReason(type: QRType): string | null {
  if (type === QRType.PAYMENT) return 'Payment codes are not offered as wallet passes: a wallet can show a pass on the lock screen, where anyone holding the phone could use it.';
  if (type === QRType.BULK_CSV) return 'Wallet passes are made one code at a time.';
  return null;
}

const ENCRYPTION_LABELS: Record<string, string> = {
  [WifiEncryption.WPA]: 'WPA/WPA2',
  [WifiEncryption.SAE]: 'WPA3 (SAE)',
  [WifiEncryption.WEP]: 'WEP',
  [WifiEncryption.NOPASS]: 'Open',
  [WifiEncryption.WPA2_EAP]: 'WPA2 Enterprise',
};

function cleanFields(fields: PassField[], limit: number): PassField[] {
  return fields.map((field) => ({ ...field, label: cleanPassText(field.label, 40), value: cleanPassText(field.value, limit) })).filter((field) => field.value);
}

/**
 * Describes the current content as pass fields. A WiFi code shows its network and security on
 * the front and its password on the back; a link goes on the back, where wallets make it
 * tappable; other content goes on the back as text.
 * @param config - The content.
 * @param text - The title and optional subtitle the person chose.
 * @throws WalletPassError for content that gets no pass or that is empty.
 */
export function describePassContent(config: Pick<QRConfig, 'type' | 'value'>, text: { title: string; subtitle?: string }): PassContent {
  const refusal = passRefusalReason(config.type);
  if (refusal) throw new WalletPassError(refusal);
  const message = resolveEncodedValue(config);
  if (!message.trim()) throw new WalletPassError('Enter content before making a pass.');
  const title = cleanPassText(text.title, PASS_TEXT_LIMITS.title);
  if (!title) throw new WalletPassError('Give the pass a title.');

  const fields: PassField[] = [];
  const backFields: PassField[] = [];
  if (config.type === QRType.WIFI) {
    const wifi = hydrateWifiData(config.value);
    fields.push({ key: 'network', label: 'Network', value: wifi.ssid }, { key: 'security', label: 'Security', value: ENCRYPTION_LABELS[wifi.encryption] ?? wifi.encryption });
    if (wifi.password) backFields.push({ key: 'password', label: 'Password', value: wifi.password });
  } else if (config.type === QRType.URL) {
    backFields.push({ key: 'link', label: 'Link', value: message });
  } else {
    backFields.push({ key: 'content', label: 'Content', value: message });
  }
  backFields.push({ key: 'made-with', label: 'Made with', value: 'QRCraftly (qrcraftly.com). The pass was made and signed on your device.' });

  return {
    title,
    subtitle: cleanPassText(text.subtitle, PASS_TEXT_LIMITS.subtitle) || undefined,
    fields: cleanFields(fields, PASS_TEXT_LIMITS.field).slice(0, MAX_FRONT_FIELDS),
    backFields: cleanFields(backFields, PASS_TEXT_LIMITS.backField),
    message,
  };
}

const DEFAULT_COLORS: PassColors = { foreground: '#000000', background: '#ffffff', label: '#000000' };

/**
 * Picks pass colours from the code's design: its dark colour as the pass background and its light
 * colour as the text, when they contrast enough for text (4.5:1); otherwise black on white.
 */
export function passColorsFrom(config: Pick<QRConfig, 'fgColor' | 'bgColor'>): PassColors {
  const dark = normalizeHex(config.fgColor);
  const light = normalizeHex(config.bgColor);
  if (!dark || !light || getContrastRatio(light, dark) < MIN_TEXT_CONTRAST) return DEFAULT_COLORS;
  return { foreground: light, background: dark, label: light };
}
