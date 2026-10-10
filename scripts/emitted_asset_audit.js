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

/**
 * Emitted asset audit (#1351): the last postbuild step reads what will really ship in
 * `dist/client` and fails the build on anything a dependency or build tool could have slipped in.
 *
 * - HTML may load scripts, styles, frames, images and media from this site only. Plain links
 *   (`<a href>`, `rel="canonical"`) are navigation and stay allowed.
 * - CSS may not `@import` or `url()` another origin.
 * - JavaScript may not open a WebSocket, and every `http(s)://` host it names must be on the
 *   reviewed list below. A new host fails the build until someone checks why it is there.
 * - No file may hold a credential (the strict patterns from `secret-scanner.js`) or a private key.
 *
 * `bundle_ast_audit.js` checks which code may call `fetch`; this script checks the finished files,
 * after every step that rewrites HTML.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AWS_REGEX, GCP_REGEX, GITHUB_REGEX, STRIPE_REGEX } from './secret-scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLIENT_DIR = path.join(__dirname, '..', 'dist', 'client');

/**
 * Hosts the shipped JavaScript may name, each with why. Naming a host is not a request: these
 * are link targets, payload formats, namespaces and library error messages. The bundle audit and
 * the E2E network fixture stop real requests.
 */
export const REVIEWED_HOSTS = {
  'www.w3.org': 'XML namespaces in SVG rendering and export',
  'qrcraftly.com': 'Canonical links, share text and sample payloads',
  'github.com': 'Links to the source, licences and issues',
  'vike.dev': 'Error messages in the Vike client router',
  'react.dev': 'Error messages in React',
  'www.qrcode.com': 'Links to the QR code trademark and spec pages',
  'www.iso.org': 'Links to the ISO/IEC 18004 standard',
  'calendar.google.com': 'Event QR links that open Google Calendar',
  'calendar.yahoo.com': 'Event QR links that open Yahoo Calendar',
  'wa.me': 'WhatsApp payload links',
  'x.com': 'Social profile payload links',
  'instagram.com': 'Social profile payload links',
  'facebook.com': 'Social profile payload links',
  'linkedin.com': 'Social profile payload links',
  'tiktok.com': 'Social profile payload links',
  'youtube.com': 'Social profile payload links',
  'paypal.me': 'Payment payload links',
  'venmo.com': 'Payment payload links',
  'cash.app': 'Payment payload links',
  'zoom.us': 'Sample meeting link',
  'example.com': 'Placeholder text',
  'meet.example.com': 'Placeholder text',
  'consumer.ftc.gov': 'Scam-reporting links in the safety guide',
  'www.ic3.gov': 'Scam-reporting links in the safety guide',
  'support.qr-code-generator.com': 'Source cited in a guide',
};

const EXTERNAL_URL = /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const LOCAL_SCHEMES = /^\s*(?:data|blob):/i;

/** Tags and attributes that make the browser load something when the page opens. */
const LOADING_ATTRIBUTES = {
  script: ['src'],
  img: ['src', 'srcset'],
  iframe: ['src'],
  frame: ['src'],
  embed: ['src'],
  object: ['data'],
  source: ['src', 'srcset'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  input: ['src'],
  image: ['href', 'xlink:href'],
  use: ['href', 'xlink:href'],
  form: ['action'],
  base: ['href'],
};

/** `<link rel>` values that load a resource rather than describe a page. */
const LOADING_LINK_RELS = new Set(['stylesheet', 'preload', 'modulepreload', 'prefetch', 'preconnect', 'dns-prefetch', 'icon', 'apple-touch-icon', 'manifest', 'prerender']);

const SECRET_PATTERNS = [
  ['AWS access key', AWS_REGEX],
  ['Stripe key', STRIPE_REGEX],
  ['GitHub token', GITHUB_REGEX],
  ['Google API key', GCP_REGEX],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

/**
 * Reads the attributes of one start tag.
 * @param {string} source - The text between the tag name and `>`.
 * @returns {Map<string, string>} Lower-case attribute names mapped to their values.
 */
function readAttributes(source) {
  const attributes = new Map();
  for (const match of source.matchAll(/([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/**
 * Whether an attribute value loads from another origin. `srcset` lists several URLs.
 * @param {string} name - Attribute name.
 * @param {string} value - Attribute value.
 * @returns {boolean} True when any URL in it is external.
 */
function loadsExternal(name, value) {
  const urls = name === 'srcset' ? value.split(',').map((part) => part.trim().split(/\s+/)[0] ?? '') : [value];
  return urls.some((url) => EXTERNAL_URL.test(url) && !LOCAL_SCHEMES.test(url));
}

/**
 * Finds tags in an HTML file that load something from another origin.
 * @param {string} html - File contents.
 * @param {string} file - Path for the report.
 * @returns {Array<{file: string, rule: string, detail: string}>} Violations.
 */
export function auditHtml(html, file) {
  const violations = [];
  for (const match of html.matchAll(/<([a-z][a-z0-9:-]*)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    const attributes = readAttributes(match[2]);
    if (tag === 'link') {
      const rels = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
      const href = attributes.get('href') ?? '';
      if (rels.some((rel) => LOADING_LINK_RELS.has(rel)) && loadsExternal('href', href)) {
        violations.push({ file, rule: 'external-resource', detail: `<link rel="${attributes.get('rel')}" href="${href}">` });
      }
      continue;
    }
    if (tag === 'meta' && (attributes.get('http-equiv') ?? '').toLowerCase() === 'refresh') {
      violations.push({ file, rule: 'meta-refresh', detail: match[0] });
      continue;
    }
    for (const name of LOADING_ATTRIBUTES[tag] ?? []) {
      const value = attributes.get(name);
      if (value !== undefined && loadsExternal(name, value)) {
        violations.push({ file, rule: 'external-resource', detail: `<${tag} ${name}="${value}">` });
      }
    }
  }
  return violations;
}

/**
 * Finds `@import` or `url()` of another origin in a stylesheet.
 * @param {string} css - File contents.
 * @param {string} file - Path for the report.
 * @returns {Array<{file: string, rule: string, detail: string}>} Violations.
 */
export function auditCss(css, file) {
  const violations = [];
  for (const match of css.matchAll(/(?:@import\s+(?:url\()?|url\()\s*['"]?([^'")\s;]+)/gi)) {
    if (loadsExternal('url', match[1])) violations.push({ file, rule: 'external-resource', detail: match[0] });
  }
  return violations;
}

/**
 * Lists the hosts a script names and flags WebSocket URLs and hosts nobody has reviewed.
 * @param {string} code - File contents.
 * @param {string} file - Path for the report.
 * @param {Record<string, string>} [reviewed] - Allowed hosts.
 * @returns {Array<{file: string, rule: string, detail: string}>} Violations.
 */
export function auditScript(code, file, reviewed = REVIEWED_HOSTS) {
  const violations = [];
  const seen = new Set();
  for (const match of code.matchAll(/\b(https?|wss?):\/\/([a-z0-9][a-z0-9.-]*[a-z0-9])/gi)) {
    const scheme = match[1].toLowerCase();
    const host = match[2].toLowerCase();
    if (scheme.startsWith('ws')) {
      violations.push({ file, rule: 'websocket', detail: match[0] });
    } else if (!Object.hasOwn(reviewed, host) && !seen.has(host)) {
      seen.add(host);
      violations.push({ file, rule: 'unreviewed-host', detail: host });
    }
  }
  return violations;
}

/**
 * Finds credentials and private keys.
 * @param {string} text - File contents.
 * @param {string} file - Path for the report.
 * @returns {Array<{file: string, rule: string, detail: string}>} Violations.
 */
export function auditSecrets(text, file) {
  return SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => ({ file, rule: 'secret', detail: name }));
}

/**
 * Lists every file under a directory.
 * @param {string} dir - Directory.
 * @returns {string[]} Absolute paths.
 */
function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.txt', '.xml', '.webmanifest', '.svg', '.map']);

/**
 * Audits a built client directory.
 * @param {string} clientDir - The `dist/client` directory.
 * @returns {Array<{file: string, rule: string, detail: string}>} Every violation found.
 */
export function auditClientDir(clientDir) {
  const violations = [];
  for (const full of listFiles(clientDir)) {
    const file = path.relative(clientDir, full).split(path.sep).join('/');
    const extension = path.extname(full).toLowerCase();
    const textual = TEXT_EXTENSIONS.has(extension) || ['_headers', '_redirects'].includes(path.basename(full));
    if (!textual) continue;
    const text = fs.readFileSync(full, 'utf8');
    violations.push(...auditSecrets(text, file));
    if (extension === '.html') violations.push(...auditHtml(text, file));
    if (extension === '.css') violations.push(...auditCss(text, file));
    if (extension === '.js' || extension === '.mjs') violations.push(...auditScript(text, file));
  }
  return violations;
}

function main() {
  const clientDir = process.env.EMITTED_ASSET_CLIENT_DIR || DEFAULT_CLIENT_DIR;
  if (!fs.existsSync(clientDir)) {
    console.error(`❌ [Emitted Asset Audit] ${clientDir} does not exist. Run the build first.`);
    process.exit(1);
  }
  const violations = auditClientDir(clientDir);
  if (violations.length === 0) {
    console.log('✅ [Emitted Asset Audit] No external resources, unreviewed hosts or secrets in the build.');
    return;
  }
  console.error(`❌ [Emitted Asset Audit] ${violations.length} problem(s) in the build output:`);
  for (const v of violations) console.error(`  ${v.file}: ${v.rule}: ${v.detail}`);
  console.error('Fix: load resources from this site only and never ship credentials. If a new host is a');
  console.error('link or payload format rather than a request, add it to REVIEWED_HOSTS in');
  console.error('scripts/emitted_asset_audit.js with the reason, and say why in the PR.');
  process.exit(1);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
