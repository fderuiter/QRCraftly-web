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
 * Trusted Types (#1172). The Content Security Policy sets `require-trusted-types-for 'script'`,
 * so a browser that supports Trusted Types refuses a plain string at a script sink. The app has
 * two kinds of sink, and each has one named policy here that never leaves this module:
 *
 * - `qrcraftly-script-url` accepts only same-origin script URLs, for workers and the service worker.
 * - `qrcraftly-inert-markup` passes markup to `DOMParser`, whose documents are inert: their scripts
 *   never run and nothing in them loads until a caller adopts a node into the page. The callers
 *   read shapes out of the document (`sceneReader`) or clean it with `sanitizeSvg` first.
 *
 * Where Trusted Types is missing, the helpers use plain strings: those browsers also ignore the
 * CSP directive.
 */

/** The policy that wraps worker and service worker script URLs. */
export const SCRIPT_URL_POLICY = 'qrcraftly-script-url';
/** The policy that wraps markup for `DOMParser`. */
export const INERT_MARKUP_POLICY = 'qrcraftly-inert-markup';

/** A `TrustedScriptURL` or `TrustedHTML` value: opaque to the app, read only by the browser. */
type TrustedValue = object;

interface TrustedTypePolicy {
  createScriptURL(input: string): TrustedValue;
  createHTML(input: string): TrustedValue;
}

interface TrustedTypePolicyFactory {
  createPolicy(name: string, rules: { createScriptURL?: (input: string) => string; createHTML?: (input: string) => string }): TrustedTypePolicy;
}

function isPolicyFactory(value: unknown): value is TrustedTypePolicyFactory {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'createPolicy') === 'function';
}

function policyFactory(): TrustedTypePolicyFactory | null {
  const factory: unknown = Reflect.get(globalThis, 'trustedTypes');
  return isPolicyFactory(factory) ? factory : null;
}

/**
 * Checks that a script URL resolves to this page's own origin.
 * @param input - An absolute or page-relative URL.
 * @returns The input, unchanged.
 * @throws When the URL points at another origin (or cannot be parsed).
 */
export function assertSameOriginScriptUrl(input: string): string {
  const { origin } = globalThis.location;
  if (new URL(input, origin).origin !== origin) {
    throw new TypeError(`Refused a script URL from another origin: ${input}`);
  }
  return input;
}

// Created on first use, once per realm: creating a policy twice under one name is a CSP violation.
let scriptUrlPolicy: TrustedTypePolicy | null | undefined;
let markupPolicy: TrustedTypePolicy | null | undefined;

function getScriptUrlPolicy(): TrustedTypePolicy | null {
  scriptUrlPolicy ??= policyFactory()?.createPolicy(SCRIPT_URL_POLICY, { createScriptURL: assertSameOriginScriptUrl }) ?? null;
  return scriptUrlPolicy;
}

function getMarkupPolicy(): TrustedTypePolicy | null {
  markupPolicy ??= policyFactory()?.createPolicy(INERT_MARKUP_POLICY, { createHTML: (input) => input }) ?? null;
  return markupPolicy;
}

/**
 * Wraps a same-origin script URL for a script sink.
 * @param url - The script URL; a `URL` object (`new URL('./worker.ts', import.meta.url)`) or a string.
 * @returns A `TrustedScriptURL`, or the URL string where Trusted Types is missing.
 * @throws When the URL points at another origin.
 */
export function trustedScriptUrl(url: string | URL): TrustedValue | string {
  const href = String(url);
  const policy = getScriptUrlPolicy();
  if (policy) return policy.createScriptURL(href);
  // Without Trusted Types the origin is still checked, wherever there is a page origin to check.
  return typeof globalThis.location === 'undefined' ? href : assertSameOriginScriptUrl(href);
}

/**
 * Starts a module worker from a same-origin script URL, through the script URL policy.
 * `Reflect.construct` is used because the DOM types do not yet accept a `TrustedScriptURL`.
 * @param url - The worker script URL, a bundled `?worker&url` import.
 * @returns The worker.
 * @throws When the URL points at another origin, or the browser cannot start the worker.
 */
export function startModuleWorker(url: string | URL): Worker {
  const worker: Worker = Reflect.construct(Worker, [trustedScriptUrl(url), { type: 'module' }]);
  return worker;
}

/**
 * Registers a same-origin service worker script, through the script URL policy.
 * @param container - `navigator.serviceWorker`, or anything with its `register` method.
 * @param url - The service worker script URL.
 * @returns The registration promise.
 */
export function registerServiceWorker(container: { register: (url: string) => Promise<ServiceWorkerRegistration> }, url: string): Promise<ServiceWorkerRegistration> {
  const registration: Promise<ServiceWorkerRegistration> = Reflect.apply(container.register, container, [trustedScriptUrl(url)]);
  return registration;
}

/**
 * Parses markup into an inert document, through the inert markup policy.
 * @param markup - The markup text.
 * @param type - The document type.
 * @returns The parsed document.
 */
export function parseInertDocument(markup: string, type: DOMParserSupportedType): Document {
  const parser = new DOMParser();
  const policy = getMarkupPolicy();
  const document: Document = Reflect.apply(parser.parseFromString, parser, [policy ? policy.createHTML(markup) : markup, type]);
  return document;
}
