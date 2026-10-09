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

import { hasMixedScripts, toUnicodeHostname } from '@/utils/hostname';
import { BRANDS, CONFUSABLES, MULTI_LABEL_SUFFIXES, SHORTENERS, type Brand } from './data';

/** How much a finding should weigh: `info` is context, `caution` is a reason to stop and check. */
export type LinkFindingSeverity = 'info' | 'caution';

export type LinkFindingCode =
  | 'http'
  | 'userinfo'
  | 'ip-host'
  | 'port'
  | 'shortener'
  | 'mixed-scripts'
  | 'international'
  | 'lookalike'
  | 'brand-in-subdomain'
  | 'brand-in-path'
  | 'deep-subdomain'
  | 'punycode';

/** One observation about a web address. Findings are hints, never a verdict on the site. */
export interface LinkFinding {
  code: LinkFindingCode;
  severity: LinkFindingSeverity;
  /** A plain sentence for the reader. */
  message: string;
}

/** Subdomain levels beyond which an address is unusual enough to mention. */
const DEEP_SUBDOMAIN_LEVELS = 4;
/** Words that, next to a brand name in a path, suggest a sign-in imitation. */
const LOGIN_WORDS = /(?:log-?in|sign-?in|verify|secure|account|update|password|confirm|wallet)/i;
const MIN_BRAND_LENGTH = 4;

/**
 * Splits a hostname into the registrable domain (suffix plus one label) and the labels before it.
 * Uses a compact public-suffix subset, so an unlisted multi-label suffix is read as a plain
 * top-level domain.
 * @param host - A lower-case hostname.
 * @returns The registrable domain, its first label, and the subdomain labels.
 */
function splitHost(host: string): { registrable: string; label: string; subdomains: string[] } {
  const labels = host.split('.');
  let suffixLength = 1;
  for (let length = Math.min(3, labels.length - 1); length >= 2; length--) {
    if (MULTI_LABEL_SUFFIXES.has(labels.slice(-length).join('.'))) {
      suffixLength = length;
      break;
    }
  }
  const registrableStart = Math.max(labels.length - suffixLength - 1, 0);
  return {
    registrable: labels.slice(registrableStart).join('.'),
    label: labels[registrableStart] ?? '',
    subdomains: labels.slice(0, registrableStart),
  };
}

/**
 * Reduces a domain label to the letters a reader would see: confusable characters from other
 * alphabets become their Latin look-alike, `rn` reads as `m`, and a digit swap (`0`, `1`, `5`)
 * reads as the letter. The `1` has two readings, so two skeletons come back.
 * @param label - A domain label, Unicode form.
 * @returns The skeleton readings.
 */
function skeletons(label: string): string[] {
  const mapped = [...label.normalize('NFKC').toLowerCase()].map((char) => CONFUSABLES[char] ?? char).join('');
  const base = mapped.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/5/g, 's');
  return [base.replace(/1/g, 'l'), base.replace(/1/g, 'i')];
}

function brandOwns(brand: Brand, registrable: string): boolean {
  return brand.domains.includes(registrable);
}

function isIpHost(hostname: string): boolean {
  return hostname.startsWith('[') || hostname.split('.').length === 4 && hostname.split('.').every((part) => /^\d{1,3}$/.test(part));
}

/** Tokens of a label, split on hyphens, so `paypal-login` offers `paypal`. */
function tokens(label: string): string[] {
  return label.split('-').filter(Boolean);
}

/**
 * Reads a web address for the signs people use to disguise where a link goes. Pure and offline:
 * it looks only at the text, so it can say a link looks unusual, never that a site is safe.
 * @param url - The address, with or without a scheme.
 * @returns The findings, cautions first. Empty for anything that is not a web address, and for
 * an ordinary one.
 */
export function analyseLink(url: string): LinkFinding[] {
  // Read the address the browser will open: the URL parser drops tabs and line breaks anywhere
  // and percent-encodes spaces after the host, so text with them can still be a working link.
  const text = url.trim().replace(/[\t\n\r]/g, '');
  if (!text) return [];
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/?#]*:\d+(?:[/?#]|$)/.test(text);
  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return [];
  }
  if (!['http:', 'https:', 'ftp:'].includes(parsed.protocol)) return [];

  const findings: LinkFinding[] = [];
  const add = (code: LinkFindingCode, severity: LinkFindingSeverity, message: string) => findings.push({ code, severity, message });
  // A trailing dot names the same site (`example.com.`), so it must not hide the registrable domain.
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  const host = toUnicodeHostname(hostname);

  if (parsed.protocol === 'http:' && hasScheme) {
    add('http', 'caution', 'This link is not encrypted (http). Anything you send on the page can be read on the way.');
  }
  if (parsed.username || parsed.password) {
    add('userinfo', 'caution', `Everything before the @ is a name, not the site. The link really goes to ${host}.`);
  }
  if (isIpHost(hostname)) {
    add('ip-host', 'caution', 'The address is a number instead of a name, which real sites rarely use.');
  } else {
    const { registrable, label, subdomains } = splitHost(host);
    const shortener = SHORTENERS.has(registrable) || SHORTENERS.has(host);
    if (shortener) add('shortener', 'info', 'This is a shortened link, so the address does not show where it leads.');

    if (hasMixedScripts(host)) {
      add('mixed-scripts', 'caution', 'The address mixes letters from different alphabets, a common trick to imitate a well-known site.');
    } else if (host !== hostname) {
      add('international', 'info', `The address uses international characters. Its plain form is ${hostname}.`);
    }

    const labelSkeletons = skeletons(label);
    const lookalike = BRANDS.find(
      (brand) =>
        brand.label.length >= MIN_BRAND_LENGTH &&
        label !== brand.label &&
        !brandOwns(brand, registrable) &&
        labelSkeletons.includes(brand.label)
    );
    if (lookalike) {
      add('lookalike', 'caution', `The name ${label} imitates ${lookalike.label}. The real site is ${lookalike.domains[0]}.`);
    }

    const imitated = BRANDS.find(
      (brand) =>
        brand.label.length >= MIN_BRAND_LENGTH &&
        !brandOwns(brand, registrable) &&
        subdomains.some((sub) => tokens(sub).includes(brand.label))
    );
    if (imitated && !lookalike) {
      add('brand-in-subdomain', 'caution', `The address mentions ${imitated.label}, but the site is ${registrable}.`);
    }
    if (!imitated && !lookalike && LOGIN_WORDS.test(parsed.pathname)) {
      const inPath = BRANDS.find(
        (brand) =>
          brand.label.length >= MIN_BRAND_LENGTH &&
          !brandOwns(brand, registrable) &&
          parsed.pathname.toLowerCase().includes(brand.label)
      );
      if (inPath) add('brand-in-path', 'info', `The path mentions ${inPath.label}, but the site is ${registrable}.`);
    }

    if (subdomains.length >= DEEP_SUBDOMAIN_LEVELS) {
      add('deep-subdomain', 'caution', `The address has ${subdomains.length} name levels before ${registrable}. Only the end of it identifies the site.`);
    }
    if (hostname.split('.').some((part) => part.startsWith('xn--')) && !findings.some((f) => f.code === 'mixed-scripts' || f.code === 'international')) {
      add('punycode', 'info', 'The address uses an encoded international name (xn--).');
    }
  }
  if (parsed.port) add('port', 'info', `The link uses a non-standard port (${parsed.port}).`);

  return findings.sort((a, b) => Number(b.severity === 'caution') - Number(a.severity === 'caution'));
}
