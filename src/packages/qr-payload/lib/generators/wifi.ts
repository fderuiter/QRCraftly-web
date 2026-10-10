/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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
  type WifiData,
  WifiEncryption,
  WifiEapMethod,
  WifiEapPhase2,
  QRType,
  type QRGeneratorContract,
} from '@/types';
import { identifyProtocol } from '../protocol';

const REGEX_ESCAPE_WIFI = /([\\;,":])/g;
const REGEX_UNESCAPE_WIFI = /\\([\\;,":])/g;
const REGEX_PROHIBITED_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B-\u200D\u2060\uFEFF]/;

/**
 * Escapes specific special characters in a WIFI SSID or password string.
 * @param str - The raw SSID or password string, which can be undefined.
 * @returns The escaped WIFI parameter string.
 */
const escapeWifi = (str: string | undefined): string => {
  if (!str) return '';
  return str.replace(REGEX_ESCAPE_WIFI, '\\$1');
};

/**
 * Unescapes escaped special characters in a WIFI SSID or password string.
 * @param str - The escaped WIFI string, which can be undefined.
 * @returns The unescaped WIFI parameter string.
 */
const unescapeWifi = (str: string | undefined): string => {
  if (!str) return '';
  return str.replace(REGEX_UNESCAPE_WIFI, '$1');
};

const isEapMethod = (value: string): value is WifiEapMethod =>
  (Object.values(WifiEapMethod) as string[]).includes(value);

const isEapPhase2 = (value: string): value is WifiEapPhase2 =>
  (Object.values(WifiEapPhase2) as string[]).includes(value);

/**
 * Hydrates WifiData from a raw string.
 */
export const hydrateWifiData = (raw: string): WifiData => {
  const result: WifiData = {
    ssid: '',
    password: '',
    encryption: WifiEncryption.WPA,
    hidden: false,
    eapIdentity: '',
  };

  if (!raw || typeof raw !== 'string') return result;

  if (REGEX_PROHIBITED_CHARS.test(raw)) {
    throw new Error('Payload contains prohibited control or zero-width characters');
  }

  const trimmed = raw.trim();
  if (!trimmed.toUpperCase().startsWith('WIFI:')) return result;

  let content = trimmed.substring(5);
  if (content.endsWith(';;')) {
    content = content.slice(0, -2);
  } else if (content.endsWith(';')) {
    content = content.slice(0, -1);
  }

  const parts: string[] = [];
  let currentPart = '';
  let escaped = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (escaped) {
      currentPart += char;
      escaped = false;
    } else if (char === '\\') {
      currentPart += char;
      escaped = true;
    } else if (char === ';') {
      parts.push(currentPart);
      currentPart = '';
    } else {
      currentPart += char;
    }
  }
  parts.push(currentPart);

  parts.forEach((part) => {
    const splitIndex = part.indexOf(':');
    if (splitIndex <= 0) return;
    const key = part.substring(0, splitIndex);
    const value = part.substring(splitIndex + 1);

    switch (key) {
      case 'S':
        result.ssid = unescapeWifi(value);
        break;
      case 'P':
        result.password = unescapeWifi(value);
        break;
      case 'T': {
        const enc = unescapeWifi(value);
        if (Object.values(WifiEncryption).includes(enc as WifiEncryption)) {
          result.encryption = enc as WifiEncryption;
        }
        break;
      }
      case 'H':
        result.hidden = value.toLowerCase() === 'true';
        break;
      case 'I':
        result.eapIdentity = unescapeWifi(value);
        break;
      case 'E': {
        const method = unescapeWifi(value).toUpperCase();
        if (isEapMethod(method)) {
          result.eapMethod = method;
        }
        break;
      }
      case 'PH2': {
        const phase2 = unescapeWifi(value).toUpperCase();
        if (isEapPhase2(phase2)) {
          result.eapPhase2 = phase2;
        }
        break;
      }
    }
  });

  return result;
};

/**
 * Constructs the `WIFI:` string. A blank network name gives `''` (the `S:` field is required),
 * so the generator shows its sample state instead of a code that joins nothing (#1272).
 */
export const constructWifiString = (data: WifiData): string => {
  if (!data || !data.ssid?.trim()) return '';

  // Validate encryption type to prevent injection
  const encryption = Object.values(WifiEncryption).includes(data.encryption)
    ? data.encryption
    : WifiEncryption.WPA;

  const parts = [`T:${encryption}`, `S:${escapeWifi(data.ssid)}`];

  if (encryption === WifiEncryption.WPA2_EAP) {
    // Android's WIFI parser needs `E:` (EAP method) to join enterprise networks.
    const method = data.eapMethod && isEapMethod(data.eapMethod) ? data.eapMethod : WifiEapMethod.PEAP;
    const phase2 =
      data.eapPhase2 !== undefined && isEapPhase2(data.eapPhase2)
        ? data.eapPhase2
        : WifiEapPhase2.MSCHAPV2;
    parts.push(`E:${method}`);
    // EAP-TLS and EAP-PWD have no inner authentication.
    if (phase2 && method !== WifiEapMethod.TLS && method !== WifiEapMethod.PWD) {
      parts.push(`PH2:${phase2}`);
    }
    parts.push(`I:${escapeWifi(data.eapIdentity)}`);
  }

  if (encryption !== WifiEncryption.NOPASS) {
    parts.push(`P:${escapeWifi(data.password)}`);
  }

  // Only include hidden flag if true, as some scanners fail on H:false
  if (data.hidden) {
    parts.push(`H:true`);
  }

  return `WIFI:${parts.join(';')};;`;
};

export const WifiContract: QRGeneratorContract<WifiData> = {
  type: QRType.WIFI,
  construct: constructWifiString,
  hydrate: hydrateWifiData,
  matches: (raw: string) => identifyProtocol(raw) === QRType.WIFI,
  validate: () => [],
};
