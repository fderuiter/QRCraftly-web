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

import { CalendarProvider, QRType, SocialPlatform } from '@/types';
import { splitCompoundField } from './rfcHelper';

/**
 * Matches a `geo:` URI the Location form can show in full: two coordinates and nothing else.
 * Altitude, `;u=`, `;crs=` and `?q=` searches have no field, so such codes stay Text (#1282).
 */
export const PLAIN_GEO_URI = /^geo:([-+]?\d{1,3}(?:\.\d+)?),([-+]?\d{1,3}(?:\.\d+)?)$/i;

/** A profile URL the Social form can rebuild exactly: a platform and a handle. */
export interface SocialProfile {
  platform: SocialPlatform;
  handle: string;
}

/** Hosts whose profile URLs the Social form builds, after `www.`, `m.` or `mobile.` is removed. */
const PROFILE_HOSTS: Record<string, SocialPlatform> = {
  'instagram.com': SocialPlatform.INSTAGRAM,
  'x.com': SocialPlatform.TWITTER,
  'twitter.com': SocialPlatform.TWITTER,
  'tiktok.com': SocialPlatform.TIKTOK,
  'linkedin.com': SocialPlatform.LINKEDIN,
  'youtube.com': SocialPlatform.YOUTUBE,
  'facebook.com': SocialPlatform.FACEBOOK,
  'wa.me': SocialPlatform.WHATSAPP,
  'github.com': SocialPlatform.GITHUB,
};

/** First path segments that are pages of the site, not someone's handle. */
const RESERVED_SEGMENTS: Partial<Record<SocialPlatform, ReadonlySet<string>>> = {
  [SocialPlatform.INSTAGRAM]: new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct']),
  [SocialPlatform.TWITTER]: new Set(['i', 'intent', 'home', 'search', 'hashtag', 'share', 'explore', 'settings', 'messages', 'notifications', 'compose', 'login']),
  [SocialPlatform.FACEBOOK]: new Set(['share', 'sharer', 'sharer.php', 'groups', 'events', 'watch', 'photo.php', 'story.php', 'profile.php', 'pages', 'marketplace', 'gaming', 'login']),
  [SocialPlatform.GITHUB]: new Set(['orgs', 'settings', 'marketplace', 'explore', 'topics', 'sponsors', 'features', 'login', 'about', 'pricing', 'enterprise']),
};

const HANDLE_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Reads a social profile link that the Social form can rebuild without losing anything. Posts,
 * share links, searches, short-link hosts and links with a query or fragment are not profiles,
 * so they return `null` and stay Website codes (#1282).
 * @param parsed - The parsed `http`/`https` URL.
 * @returns The platform and handle, or `null`.
 */
export const parseSocialProfile = (parsed: ParsedProtocol): SocialProfile | null => {
  if (parsed.scheme !== 'http' && parsed.scheme !== 'https') return null;
  if (parsed.params.size > 0 || parsed.path.includes('#')) return null;

  const [rawHost, ...rest] = parsed.path.split('/');
  const host = rawHost.toLowerCase().replace(/^(?:www|m|mobile)\./, '');
  const platform = PROFILE_HOSTS[host];
  if (!platform) return null;

  // One trailing slash is fine; empty segments elsewhere are not.
  const segments = rest.length > 0 && rest[rest.length - 1] === '' ? rest.slice(0, -1) : rest;
  if (segments.some((segment) => segment === '')) return null;

  let handle: string | undefined;
  switch (platform) {
    case SocialPlatform.LINKEDIN:
      if (segments.length === 2 && segments[0] === 'in') handle = segments[1];
      break;
    case SocialPlatform.TIKTOK:
    case SocialPlatform.YOUTUBE:
      if (segments.length === 1 && segments[0].startsWith('@')) handle = segments[0].substring(1);
      break;
    case SocialPlatform.WHATSAPP:
      if (segments.length === 1 && /^\d+$/.test(segments[0])) handle = segments[0];
      break;
    default:
      if (segments.length === 1 && !RESERVED_SEGMENTS[platform]?.has(segments[0].toLowerCase())) {
        handle = segments[0];
      }
  }

  return handle && HANDLE_PATTERN.test(handle) ? { platform, handle } : null;
};

/**
 * Reads which web calendar an add-event link is for. Only links that open a new-event form count:
 * a mailbox, a calendar view or any other page of those sites stays a Website code (#1363).
 * @param parsed - The parsed `http`/`https` URL.
 * @returns The calendar provider, or `null`.
 */
export const calendarLinkProvider = (parsed: ParsedProtocol): CalendarProvider | null => {
  if (parsed.scheme !== 'http' && parsed.scheme !== 'https') return null;
  const slash = parsed.path.indexOf('/');
  const host = (slash === -1 ? parsed.path : parsed.path.substring(0, slash)).toLowerCase().replace(/^www\./, '');
  const route = slash === -1 ? '' : parsed.path.substring(slash);

  if ((host === 'calendar.google.com' || host === 'google.com') && /^\/calendar\/(?:render|event)\b/.test(route)) {
    return parsed.params.get('action')?.toUpperCase() === 'TEMPLATE' ? CalendarProvider.GOOGLE : null;
  }
  if (/^\/calendar\/\d+\/deeplink\/compose\b/.test(route)) {
    if (host === 'outlook.live.com') return CalendarProvider.OUTLOOK;
    if (host === 'outlook.office.com' || host === 'outlook.office365.com') return CalendarProvider.OFFICE365;
  }
  if (host === 'calendar.yahoo.com' && parsed.params.get('v') === '60') return CalendarProvider.YAHOO;
  return null;
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
  URL: /^(?:https?|ftp):\/\/[^\s\x00-\x1F\x7F-\x9F\u200B-\u200D\u2060\uFEFF]+$/i,
  // The HTML "valid e-mail address" grammar (RFC 5322 atext local part, so O'Brien works), with at
  // least two domain labels (IDN A-labels such as xn--p1ai included) or an IPv4 address literal (#1273).
  EMAIL: /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+|\[(?:\d{1,3}\.){3}\d{1,3}\])$/,
  PLAIN_TEXT: /^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B\u2060\uFEFF]*$/,
  // Control and hidden zero-width characters in text fields (allowing \t, \n, \r). Zero-width
  // joiner and non-joiner (U+200C, U+200D) are allowed: emoji sequences and Persian need them (#1271).
  TEXT_NO_CONTROL: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B\u2060\uFEFF]/,
  // Wi-Fi names and passwords are not prose, so every zero-width character is refused there:
  // a joiner would make a network name that looks like another one.
  STRICT_NO_CONTROL: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B-\u200D\u2060\uFEFF]/,
  // Text-direction controls (U+061C, U+200E/F, U+202A-202E, U+2066-2069). Real right-to-left text
  // never needs them, but they let `gpj.exe` read as `exe.jpg`. Refused where they are never
  // needed (Wi-Fi, phone, SMS, border and template text) and neutralised on display in the scanner.
  BIDI_CONTROL: /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/,
  PRESERVE_FORMAT_CONTROL: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B\u2060\uFEFF]/,
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
 * Schemes whose query uses RFC 3986 percent-encoding (RFC 6068 mailto, RFC 5724 sms), where `+`
 * is a literal plus and header names are case-insensitive. Web URLs keep form decoding.
 */
const URI_QUERY_SCHEMES = new Set(['mailto', 'sms', 'smsto']);

/**
 * Parses a mailto or sms query into a map keyed by lower-case header name. A `+` stays a plus
 * (`C++` is not `C  `), and the first value of a repeated header wins.
 * @param query - The text after `?`.
 * @returns The decoded headers.
 */
export const parseUriQuery = (query: string): Map<string, string> => {
  const params = new Map<string, string>();
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const header = safeDecodeURIComponent(eq === -1 ? pair : pair.substring(0, eq)).toLowerCase();
    const value = eq === -1 ? '' : safeDecodeURIComponent(pair.substring(eq + 1));
    if (header && !params.has(header)) params.set(header, value);
  }
  return params;
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
    if (query && URI_QUERY_SCHEMES.has(scheme)) {
      parseUriQuery(query).forEach((value, key) => params.set(key, value));
    } else if (query) {
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
  if (lower.startsWith('geo:')) return PLAIN_GEO_URI.test(trimmed) ? QRType.LOCATION : QRType.TEXT;
  if (lower.startsWith('wifi:')) return QRType.WIFI;
  if (/begin:vcard/i.test(trimmed) || /^mecard:/i.test(trimmed)) return QRType.VCARD;
  if (/begin:v(event|calendar)/i.test(trimmed)) return QRType.EVENT;
  if (/^(bitcoin|ethereum|litecoin|solana):/i.test(trimmed)) return QRType.PAYMENT;
  if (/^BCD\r?\n/i.test(trimmed)) return QRType.PAYMENT;
  if (/^(https?:\/\/)?(www\.)?(paypal\.me|cash\.app|venmo\.com)\//i.test(trimmed)) return QRType.PAYMENT;

  const parsed = parseProtocol(trimmed);

  if (parsed) {
    if (parsed.scheme === 'wifi') return QRType.WIFI;
    if (/^(bitcoin|ethereum|litecoin|solana)$/i.test(parsed.scheme)) return QRType.PAYMENT;
    if (PROTOCOL_PREFIXES.MAIL.includes(parsed.scheme + ':')) return QRType.EMAIL;
    if (parsed.scheme === 'matmsg') return QRType.EMAIL;
    if (PROTOCOL_PREFIXES.TEL.includes(parsed.scheme + ':')) return QRType.PHONE;
    if (PROTOCOL_PREFIXES.SMS.includes(parsed.scheme + ':')) return QRType.SMS;

    if (parsed.scheme === 'http' || parsed.scheme === 'https') {
      const pathParts = parsed.path.split('/');
      let domain = pathParts[0].toLowerCase();
      if (domain.startsWith('www.')) {
        domain = domain.substring(4);
      }

      const isDomain = (d: string) => domain === d || domain.endsWith(`.${d}`);
      if (isDomain('paypal.me') || isDomain('cash.app') || isDomain('venmo.com')) {
        return QRType.PAYMENT;
      }

      // Only profile links the Social form can rebuild are Social; posts and shares stay Website.
      if (parseSocialProfile(parsed)) {
        return QRType.SOCIAL;
      }

      if (calendarLinkProvider(parsed)) {
        return QRType.EVENT;
      }

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
  if (type === QRType.URL) {
    const parsed = parseProtocol(raw);
    return parsed !== null && (parsed.scheme === 'http' || parsed.scheme === 'https');
  }
  return false;
};
