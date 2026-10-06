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

import { QRType } from '@/types';
import { identifyProtocol } from '@/packages/qr-payload';
import { getQRTypeLabel } from '@/data/qrTypeLabels';
import { isDangerousUrl } from '@/utils/security';
import { analyseLink, type LinkFinding } from '@/packages/link-safety';
import { hasMixedScripts, toUnicodeHostname } from '@/utils/hostname';
import { revealInvisibleCharacters } from '@/utils/fileNames';
import { describeContent, type ScanSummaryRow } from './contentNotes';

export type { ScanSummaryRow } from './contentNotes';

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
  /** Things to read before acting on the code, for example a hidden Bcc recipient. */
  cautions: string[];
  /** The text with a password or key replaced by bullets, and hidden characters spelled out. */
  displayText: string;
  /** Like `displayText`, with the secret shown. */
  revealedText: string;
  /** The text with a password or key hidden: what Share sends unless the reader includes it. */
  shareText: string;
  /** True when the code holds a password or key that is hidden until the reader asks. */
  hasSecret: boolean;
  /** The web address, for `http:` and `https:` content that is safe to offer. */
  link: ScanLink | null;
  /**
   * True when the content is a script or data address (`javascript:`, `data:`, `vbscript:`,
   * including obfuscated forms). Only Copy is offered then.
   */
  blocked: boolean;
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
  // The parsed form is what the browser opens, so it is what gets offered and checked.
  return {
    href: url.href,
    host,
    asciiHost: url.hostname,
    secure: url.protocol === 'https:',
    international: host !== url.hostname,
    mixedScripts: hasMixedScripts(host),
    findings: analyseLink(url.href),
  };
}

/**
 * Describes a decoded QR code for the result sheet: its generator type, a readable summary,
 * the real host of a web address, and whether it must be blocked.
 * @param text - The decoded text.
 * @returns The description.
 */
export function describeScan(text: string): ScanDescription {
  const detected = identifyProtocol(text) ?? QRType.TEXT;
  const blocked = isDangerousUrl(text);
  const notes = blocked ? { rows: [], cautions: [], secret: null, redacted: text } : describeContent(detected, text);
  return {
    text,
    type: detected,
    typeLabel: notes.typeLabel ?? getQRTypeLabel(detected),
    summary: notes.rows,
    cautions: notes.cautions,
    shareText: notes.redacted,
    displayText: revealInvisibleCharacters(notes.redacted),
    revealedText: revealInvisibleCharacters(text),
    hasSecret: notes.secret !== null,
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
