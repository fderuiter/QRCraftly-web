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

export const SafeUrlPipeline = {
  REGEX_URL_UNSAFE_CHARS: /[\x00-\x1F\x7F-\x9F\s\u200B-\u200D\uFEFF]+/g,
  REGEX_CONTROL_CHARS: /[\x00-\x1F\x7F-\x9F\u200B-\u200D\uFEFF]/g,

  DANGEROUS_PROTOCOLS: [
    'javascript:',
    'vbscript:',
    'file:',
    'data:',
    'mk:',
    'blob:',
    'filesystem:',
    'jscript:',
    'wscript:',
    'mocha:',
    'about:',
    // OS and application handlers that can launch programs or install software (#1153).
    'intent:',
    'itms-services:',
    'ms-msdt:',
    'search-ms:',
    'ms-officecmd:',
    'jar:',
    'view-source:',
  ],

  /**
   * Schemes the Website URL and Meeting types accept: those types exist to link to something a
   * person opens, so anything outside this list is refused rather than blocklisted.
   */
  LINK_SCHEME_ALLOWLIST: new Set([
    'http',
    'https',
    'ftp',
    'mailto',
    'tel',
    'sms',
    'smsto',
    'geo',
    'maps',
    'zoommtg',
    'zoomus',
    'msteams',
    'webex',
    'skype',
    'facetime',
    'tg',
    'whatsapp',
  ]),

  decodeHtmlEntities(str: string): string {
    return str.replace(/&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?/g, (_match, hex, dec) => {
      return String.fromCharCode(hex ? parseInt(hex, 16) : parseInt(dec, 10));
    }).replace(/&([a-zA-Z]+);?/g, (match, name) => {
      const namedEntities: Record<string, string> = {
          'colon': ':',
          'tab': '\t',
          'newline': '\n',
          'quot': '"',
          'amp': '&',
          'lt': '<',
          'gt': '>',
      };
      return namedEntities[name.toLowerCase()] || match;
    });
  },

  decodeObfuscation(url: string, maxDepth = 10): string {
    let prev = '';
    let curr = url;
    let depth = maxDepth;

    while (prev !== curr && depth > 0) {
      prev = curr;
      try {
        curr = decodeURIComponent(curr);
      } catch (_e) {
        // Ignored malformed
      }
      curr = this.decodeHtmlEntities(curr);
      depth--;
    }
    return curr;
  },

  isDangerous(url: string | undefined): boolean {
    if (!url) return false;
    let decoded = this.decodeObfuscation(url);
    decoded = decoded.replace(this.REGEX_URL_UNSAFE_CHARS, '').toLowerCase();
    return this.DANGEROUS_PROTOCOLS.some(p => decoded.startsWith(p));
  },

  /**
   * Schemes accepted without a following `//`. Anything else that merely looks like a
   * scheme (`example.com:8080/path`, `localhost:3000`) is really a host and port.
   */
  OPAQUE_SCHEMES: new Set([
    'http',
    'https',
    'ftp',
    'mailto',
    'tel',
    'sms',
    'smsto',
    'geo',
    'matmsg',
    'wifi',
    'urn',
    'magnet',
    'bitcoin',
    'ethereum',
    'litecoin',
    'solana',
    'market',
    'intent',
  ]),

  /**
   * Returns true when the input starts with a real URI scheme: one followed by `//`,
   * or one on the {@link OPAQUE_SCHEMES} allowlist.
   */
  hasExplicitScheme(url: string): boolean {
    const match = /^([a-z][a-z0-9+.-]*):/i.exec(url);
    if (!match) return false;
    if (url.startsWith('//', match[0].length)) return true;
    return this.OPAQUE_SCHEMES.has(match[1].toLowerCase());
  },

  /**
   * Returns the lowercase scheme of a URL that starts with a real one (see {@link hasExplicitScheme}),
   * or null for scheme-less input such as `example.com`.
   */
  getScheme(url: string | undefined): string | null {
    if (!url) return null;
    const stripped = url.replace(this.REGEX_URL_UNSAFE_CHARS, '');
    if (!this.hasExplicitScheme(stripped)) return null;
    const match = /^([a-z][a-z0-9+.-]*):/i.exec(stripped);
    return match ? match[1].toLowerCase() : null;
  },

  normalize(url: string | undefined): string {
    if (!url) return '';
    
    // Replace control and invisible characters but leave spaces for encoding.
    const noControl = url.replace(this.REGEX_CONTROL_CHARS, '');
    
    let parsed = '';
    try {
      if (this.hasExplicitScheme(noControl)) {
        parsed = new URL(noControl).href;
      }
    } catch {}

    if (!parsed && !this.hasExplicitScheme(noControl)) {
      try {
        if (!noControl.startsWith('/') && !noControl.startsWith('?')) {
          parsed = new URL(`https://${noControl}`).href;
        }
      } catch {}
    }

    if (parsed) {
      // after URL parsing, valid spaces were converted to %20.
      // Now we can strip all remaining spaces/whitespaces
      return parsed.replace(/\s+/g, '');
    }

    // Fallback: encodeURI, then strip remaining whitespace
    try {
      return encodeURI(noControl).replace(/\s+/g, '');
    } catch {
      return noControl.replace(/\s+/g, '');
    }
  }
};

/**
 * Normalizes a URL string to ensure it is valid and properly encoded.
 * Uses native URL API to handle spaces and missing protocols. Inputs without a
 * scheme (including `host:port` forms such as `localhost:3000`) default to `https://`.
 */
export const normalizeUrl = (url: string | undefined): string => {
  return SafeUrlPipeline.normalize(url);
};

/**
 * Checks if a string looks like a raw domain or web address that needs normalization.
 * It must not already contain a protocol scheme, and must contain a dot or start with www.
 */
export const shouldNormalizeUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  const hasProtocol = /^[a-z0-9+-.]+:\/\//i.test(url);
  if (hasProtocol) return false;

  const hasDot = url.includes('.');
  const isWww = url.toLowerCase().startsWith('www.');
  // eslint-disable-next-line security/detect-unsafe-regex -- linear: a single optional ':\d+' group, anchored at the start.
  const isLocalhost = /^localhost(?::\d+)?(?:[/?#]|$)/i.test(url);

  return hasDot || isWww || isLocalhost;
};

/**
 * Protocol schemes flagged as potentially hazardous in streaming inputs.
 */
export const DANGEROUS_SCHEMES = SafeUrlPipeline.DANGEROUS_PROTOCOLS;

/**
 * Decodes hexadecimal, decimal, and named HTML entities.
 */
export const decodeHtmlEntities = (str: string): string => {
  return SafeUrlPipeline.decodeHtmlEntities(str);
};

/**
 * Recursively decodes percent-encoded characters and HTML entities up to 10 levels deep.
 * @param input - The obfuscated string to decode.
 * @param maxDepth - The maximum recursion depth limit.
 * @returns The recursively decoded plain text string.
 */
export const recursiveDecode = (input: string, maxDepth = 10): string => {
  let prev = '';
  let curr = input;
  let depth = 0;

  while (curr !== prev && depth < maxDepth) {
    prev = curr;

    // Try percent decoding
    try {
      curr = decodeURIComponent(curr);
    } catch {
      // Fallback: decode only valid percent-encoded hex sequences (%HH)
      curr = curr.replace(/%([0-9a-fA-F]{2})/g, (match, hex) => {
        try {
          return decodeURIComponent(match);
        } catch {
          return String.fromCharCode(parseInt(hex, 16));
        }
      });
    }

    // Try HTML entity decoding
    curr = SafeUrlPipeline.decodeHtmlEntities(curr);
    depth++;
  }

  return curr;
};
