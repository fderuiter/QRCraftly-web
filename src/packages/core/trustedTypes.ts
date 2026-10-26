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
 * Trusted Types policies (#1172). The CSP sets `require-trusted-types-for 'script'`, so the browser
 * refuses a plain string at every script URL and HTML sink unless a policy turned it into a trusted
 * value first.
 *
 * - `default` runs on its own whenever a string reaches a script URL sink: each `new Worker(...)`
 *   and the service worker registration. It accepts same-origin URLs only. A named policy would
 *   need a wrapper at each call site, and Vite only bundles a worker written exactly as
 *   `new Worker(new URL('./worker.ts', import.meta.url))`, so the default policy is the one that
 *   fits. It has no `createHTML` or `createScript`, so a string that reaches `innerHTML`, `eval` or
 *   any other HTML or script sink still throws.
 * - `qrcraftly` makes HTML trusted, and only the reviewed call sites below hold it: the inert
 *   `DOMParser` documents of `parseInertDocument`, and `reviewedHtml` for the raw HTML sinks listed
 *   in `tests/xss_sink_inventory.test.ts`.
 *
 * Browsers without Trusted Types also ignore the CSP directive, so every helper hands the string
 * back unchanged there.
 */

/**
 * The names the CSP's `trusted-types` directive allows, in the order it lists them.
 * `qrcraftly-loader` belongs to the inline script that starts each page's scripts
 * (`scripts/defer_page_scripts.js`), which runs before this module loads.
 */
export const TRUSTED_TYPES_POLICY_NAMES = ['default', 'qrcraftly', 'qrcraftly-loader'] as const;

/** The parts of a Trusted Types policy this module uses. */
interface TrustedTypePolicyLike {
  createHTML(input: string): TrustedHTML;
}

interface TrustedTypePolicyOptions {
  createScriptURL?: (input: string) => string;
  createHTML?: (input: string) => string;
}

interface TrustedTypePolicyFactoryLike {
  createPolicy(name: string, options: TrustedTypePolicyOptions): TrustedTypePolicyLike;
}

declare global {
  interface Window {
    /** Missing in browsers without Trusted Types; TypeScript's DOM types do not declare it yet. */
    trustedTypes?: TrustedTypePolicyFactoryLike;
  }
}

/** `DOMParser` as Trusted Types defines it: it accepts trusted HTML as well as a string. */
interface MarkupParser {
  parseFromString(markup: string | TrustedHTML, type: DOMParserSupportedType): Document;
}

/**
 * Checks a script URL against the page's origin.
 * @param input - The URL as the sink received it, absolute or relative.
 * @param origin - The page's origin.
 * @returns The URL unchanged when it is same-origin.
 * @throws When the URL points at another origin or cannot be parsed.
 */
export function checkScriptUrl(input: string, origin: string): string {
  let url: URL;
  try {
    url = new URL(input, origin);
  } catch {
    throw new TypeError(`Trusted Types: refused an unparsable script URL: ${input}`);
  }
  if (url.origin !== origin) throw new TypeError(`Trusted Types: refused a script URL from another origin: ${url.origin}`);
  return input;
}

const identity = (input: string): string => input;

let htmlPolicy: TrustedTypePolicyLike | null = null;
let installed = false;

/**
 * Reads the browser's Trusted Types factory, if it has one.
 * @returns The factory, or `undefined` outside a browser or in a browser without Trusted Types.
 */
function readFactory(): TrustedTypePolicyFactoryLike | undefined {
  return typeof window === 'undefined' ? undefined : window.trustedTypes;
}

/**
 * Creates both policies once per page. Call it before any worker starts; later calls do nothing.
 */
export function installTrustedTypesPolicies(): void {
  if (installed) return;
  installed = true;
  const factory = readFactory();
  if (!factory) return;
  const origin = window.location.origin;
  try {
    factory.createPolicy('default', { createScriptURL: (input) => checkScriptUrl(input, origin) });
    htmlPolicy = factory.createPolicy('qrcraftly', { createHTML: identity });
  } catch (error) {
    // Only a second copy of this module can get here (a dev hot reload): the CSP allows each name once.
    console.warn('[TrustedTypes] Policies already exist:', error);
  }
}

/**
 * Marks markup from a reviewed source as trusted for a raw HTML sink. Every caller is listed in
 * `tests/xss_sink_inventory.test.ts` with the control that makes its markup safe.
 * @param markup - Markup the caller built or sanitised itself.
 * @returns Trusted HTML where the browser has Trusted Types, else the string unchanged.
 */
export function reviewedHtml(markup: string): string | TrustedHTML {
  installTrustedTypesPolicies();
  return htmlPolicy ? htmlPolicy.createHTML(markup) : markup;
}

/**
 * Parses markup into an inert document: `DOMParser` runs no script and loads no resource, so the
 * caller can read or sanitise the result.
 * @param markup - The markup to parse.
 * @param type - The document type, such as `image/svg+xml`.
 * @returns The parsed document.
 */
export function parseInertDocument(markup: string, type: DOMParserSupportedType): Document {
  const parser: MarkupParser = new DOMParser();
  return parser.parseFromString(reviewedHtml(markup), type);
}
