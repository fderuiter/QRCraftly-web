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

import { QRType, SocialPlatform } from '@/types';
import { splitCompoundField } from './rfcHelper';

export const SOCIAL_DOMAINS: Record<string, SocialPlatform> = {
  'instagram.com': SocialPlatform.INSTAGRAM,
  'x.com': SocialPlatform.TWITTER,
  'twitter.com': SocialPlatform.TWITTER,
  'tiktok.com': SocialPlatform.TIKTOK,
};

export const PROTOCOL_PREFIXES = {
  WEB: ['http://', 'https://'],
  MAIL: ['mailto:', 'matmsg:'],
  SMS: ['sms:', 'smsto:'],
  TEL: ['tel:'],
};

/**
 * Formal containment profiles for validating structured text and emails.
 */
export const CONTAINMENT_PROFILES = {
  URL: /^(?:https?|ftp):\/\/[^\s\x00-\x1F\x7F-\x9F\u200B-\u200D\uFEFF]+$/i,
  EMAIL: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  PLAIN_TEXT: /^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B-\u200D\uFEFF]*$/,
  // General check for zero-width and control characters in text fields (allowing \t, \n, \r)
  STRICT_NO_CONTROL: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B-\u200D\uFEFF]/,
  // Text-direction controls (U+061C, U+200E/F, U+202A-202E, U+2066-2069). Real right-to-left text
  // never needs them, but they let `gpj.exe` read as `exe.jpg`. Refused where they are never
  // needed (Wi-Fi, phone, SMS, border and template text) and neutralised on display in the scanner.
  BIDI_CONTROL: /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/,
  PRESERVE_FORMAT_CONTROL: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B-\u200D\uFEFF]/,
};

export interface ParsedProtocol {
  scheme: string; // The protocol scheme without colon, e.g., 'mailto', 'sms', 'matmsg', 'http'
  path: string; // The target (email, phone, domain, etc.)
  params: Map<string, string>; // Query parameters or matmsg parts
}

/**
 * Splits a string by unescaped semicolons, properly handling backslash escaping.
 * Delegates to splitCompoundField to eliminate duplicate delimiter splitting logic.
 * @param str - The raw semicolon-delimited string.
 * @returns An array of string segments.
 */
export const splitByUnescapedSemicolons = (str: string): string[] => {
  return splitCompoundField(str, ';');
};

/**
 * Percent-encodes characters that would otherwise terminate the path of a
 * `tel:` or `sms:` URI. RFC 3966 requires `#` to be sent as `%23`, because a
 * raw `#` starts a URI fragment and dialers cut the number off there.
 * @param dialString - A phone number that has already been through `cleanPhoneNumber`.
 * @returns The dial string, safe to place in a URI path.
 */
export const encodeDialString = (dialString: string): string => {
  return dialString.replace(/%/g, '%25').replace(/#/g, '%23');
};

/**
 * Decodes percent-escapes in a URI component without throwing on malformed input.
 * @param value - The percent-encoded component.
 * @returns The decoded string, or the input unchanged when it is not valid percent-encoding.
 */
export const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Unescapes a MATMSG value parameter string.
 * @param str - The escaped value string.
 * @returns The unescaped value string.
 */
export const unescapeMatmsgValue = (str: string): string => {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') {
      if (i + 1 < str.length) {
        const nextChar = str[i + 1];
        if (nextChar === ';' || nextChar === '\\') {
          result += nextChar;
          i++;
        } else {
          result += '\\';
        }
      } else {
        result += '\\';
      }
    } else {
      result += str[i];
    }
  }
  return result;
};

/**
 * Safely parses a URI string into its scheme, path, and parameters.
 * Designed to prevent application crashes from malformed input.
 * Does not convert non-web protocols into HTTP URLs.
 */
export const parseProtocol = (raw: string): ParsedProtocol | null => {
  try {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // Special case for MATMSG which uses semicolons and a different format
    if (trimmed.toUpperCase().startsWith('MATMSG:')) {
      const content = trimmed.substring(7);
      const segments = splitByUnescapedSemicolons(content);

      // Pop empty/whitespace-only segments from the end
      while (segments.length > 0 && segments[segments.length - 1].trim() === '') {
        segments.pop();
      }

      const KNOWN_MATMSG_KEYS = new Set(['TO', 'SUB', 'BODY']);
      const params = new Map<string, string>();
      let path = '';

      let activeKey: string | null = null;
      let activeValue = '';

      const flushActive = () => {
        if (activeKey !== null) {
          const unescapedValue = unescapeMatmsgValue(activeValue);
          if (activeKey === 'TO') {
            path = unescapedValue;
          } else {
            params.set(activeKey, unescapedValue);
          }
        }
      };

      for (const segment of segments) {
        const colonIndex = segment.indexOf(':');
        let parsedKeyVal: { key: string; value: string } | null = null;
        if (colonIndex > 0) {
          const potentialKey = segment.substring(0, colonIndex).toUpperCase();
          if (KNOWN_MATMSG_KEYS.has(potentialKey)) {
            parsedKeyVal = { key: potentialKey, value: segment.substring(colonIndex + 1) };
          }
        }

        if (parsedKeyVal !== null) {
          flushActive();
          activeKey = parsedKeyVal.key;
          activeValue = parsedKeyVal.value;
        } else {
          if (activeKey !== null && activeKey !== 'TO') {
            activeValue += ';' + segment;
          }
        }
      }
      flushActive();

      return { scheme: 'matmsg', path, params };
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      return null;
    }

    const scheme = trimmed.substring(0, colonIdx).toLowerCase();
    const content = trimmed.substring(colonIdx + 1);

    // For sms with older smsto format: smsto:number:message
    if (scheme === 'smsto') {
      const colonIndex = content.indexOf(':');
      if (colonIndex !== -1) {
        const path = content.substring(0, colonIndex);
        const message = content.substring(colonIndex + 1);
        const params = new Map<string, string>();
        params.set('body', message);
        return { scheme, path, params };
      }
    }

    let path = content;
    let query = '';

    const qIdx = content.indexOf('?');
    if (qIdx !== -1) {
      path = content.substring(0, qIdx);
      query = content.substring(qIdx + 1);
    }

    // Clean up path for standard urls (remove //)
    if ((scheme === 'http' || scheme === 'https') && path.startsWith('//')) {
      path = path.substring(2);
    }

    const params = new Map<string, string>();
    if (query) {
      try {
        const urlParams = new URLSearchParams(query);
        urlParams.forEach((value, key) => {
          params.set(key, value);
        });
      } catch (_e) {
        // Ignore params if URLSearchParams crashes on malformed query
      }
    }

    return {
      scheme,
      path,
      params,
    };
  } catch (_e) {
    // Proactive validation failure: catch all errors to prevent crashes
    return null;
  }
};

/**
 * Identifies the QR code type from the raw input payload string.
 * @param raw - The raw input payload string to identify.
 * @returns The identified QRType, or null if empty.
 */
export const identifyProtocol = (raw: string): QRType | null => {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('geo:')) return QRType.LOCATION;
  if (lower.startsWith('wifi:')) return QRType.WIFI;
  if (/begin:vcard/i.test(trimmed) || /^mecard:/i.test(trimmed)) return QRType.VCARD;
  if (/begin:v(event|calendar)/i.test(trimmed)) return QRType.EVENT;
  if (/^(bitcoin|ethereum|litecoin|solana):/i.test(trimmed)) return QRType.PAYMENT;

  const parsed = parseProtocol(trimmed);

  if (parsed) {
    if (parsed.scheme === 'wifi') return QRType.WIFI;
    if (/^(bitcoin|ethereum|litecoin|solana)$/i.test(parsed.scheme)) return QRType.PAYMENT;
    if (PROTOCOL_PREFIXES.MAIL.includes(parsed.scheme + ':')) return QRType.EMAIL;
    if (parsed.scheme === 'matmsg') return QRType.EMAIL;
    if (PROTOCOL_PREFIXES.TEL.includes(parsed.scheme + ':')) return QRType.PHONE;
    if (PROTOCOL_PREFIXES.SMS.includes(parsed.scheme + ':')) return QRType.SMS;
    if (parsed.scheme === 'geo') return QRType.LOCATION;

    if (parsed.scheme === 'http' || parsed.scheme === 'https') {
      const pathParts = parsed.path.split('/');
      let domain = pathParts[0].toLowerCase();
      if (domain.startsWith('www.')) {
        domain = domain.substring(4);
      }

      // Find if any known domain is a suffix of the current domain
      const knownSocial = Object.keys(SOCIAL_DOMAINS).find(
        (d) => domain === d || domain.endsWith(`.${d}`)
      );
      if (knownSocial) {
        return QRType.SOCIAL;
      }

      const isDomain = (d: string) => domain === d || domain.endsWith(`.${d}`);
      if (isDomain('zoom.us') || isDomain('teams.microsoft.com') || isDomain('meet.google.com')) {
        return QRType.MEETING;
      }

      return QRType.URL;
    }
  }

  return QRType.TEXT;
};

/**
 * Verifies if a raw string can be successfully hydrated into the specified QR type.
 * @param raw - The raw QR code payload string.
 * @param type - The target QR code type.
 * @returns True if the payload can be hydrated, false otherwise.
 */
export const canHydrate = (raw: string, type: QRType): boolean => {
  const identified = identifyProtocol(raw);
  if (identified === type) return true;
  if (type === QRType.TEXT) return true;
  return false;
};
