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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { test, expect } from '@playwright/test';

/**
 * What the deployed host really sends (#1353), checked over HTTP rather than in the checked-in
 * `_headers` file: the security headers on pages, assets, the 404 page and redirects, the CSP on
 * every page, and whether the files the service worker precaches are the files it was built with.
 *
 * Runs only against a deployed site (PLAYWRIGHT_TEST_BASE_URL), because `vite preview` does not
 * apply `_headers`. The Verify Production Deployment job runs it after every merge to main.
 */

const SOURCE_HEADERS = path.join(process.cwd(), 'public', '_headers');

/**
 * Reads the `/*` block of the checked-in `_headers`: every header the host must send on every
 * response. The CSP is added at build time, so it is checked separately.
 * @returns Lower-case header names mapped to their values.
 */
function readGlobalHeaders(): Map<string, string> {
  const headers = new Map<string, string>();
  let inGlobalBlock = false;
  for (const line of fs.readFileSync(SOURCE_HEADERS, 'utf8').split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      inGlobalBlock = line.trim() === '/*';
      continue;
    }
    const separator = line.indexOf(':');
    if (inGlobalBlock && separator > 0) {
      headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
    }
  }
  return headers;
}

/** Fetches a URL as the host answers it, without following redirects or using any cache. */
function fetchRaw(request: APIRequestContext, url: string): Promise<APIResponse> {
  return request.get(url, { maxRedirects: 0, headers: { 'Cache-Control': 'no-cache' } });
}

function expectGlobalHeaders(response: APIResponse, label: string) {
  const sent = response.headers();
  for (const [name, value] of readGlobalHeaders()) {
    expect(sent[name], `${label}: ${name}`).toBe(value);
  }
}

/** Reads the CSP a page declares in its `<meta http-equiv>` tag. */
function readMetaCsp(html: string): string | undefined {
  const tag = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0];
  return tag?.match(/content="([^"]*)"/i)?.[1].replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
}

function expectStrictCsp(csp: string | undefined, label: string) {
  expect(csp, `${label}: Content-Security-Policy`).toBeTruthy();
  const directives = new Map(
    (csp ?? '')
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map((parts) => [parts[0], parts.slice(1)])
  );
  expect(directives.get('default-src'), `${label}: default-src`).toEqual(["'self'"]);
  expect(directives.get('object-src'), `${label}: object-src`).toEqual(["'none'"]);
  expect(directives.get('base-uri'), `${label}: base-uri`).toEqual(["'self'"]);
  expect(directives.get('script-src') ?? [], `${label}: script-src`).not.toContain("'unsafe-inline'");
  expect(directives.get('script-src') ?? [], `${label}: script-src`).not.toContain("'unsafe-eval'");
  expect(csp, `${label}: no third-party origins`).not.toMatch(/https?:\/\//);
}

/** Pages that must answer 200 with the full policy: the shell, a content page and a generator. */
const PAGES = ['/', '/about', '/wifi-qr-code', '/qr-code-scanner'];

test.describe('Production headers and deployment integrity (#1353)', { tag: '@prod' }, () => {
  test.skip(!process.env.PLAYWRIGHT_TEST_BASE_URL, 'Needs a deployed site; vite preview does not apply _headers');
  test.skip(({ browserName }) => browserName !== 'chromium', 'HTTP checks run once');

  test('every page sends the security headers and a CSP identical to its meta tag', async ({ request }) => {
    for (const page of PAGES) {
      const response = await fetchRaw(request, page);
      expect(response.status(), page).toBe(200);
      expectGlobalHeaders(response, page);
      const headerCsp = response.headers()['content-security-policy'];
      expectStrictCsp(headerCsp, page);
      // csp_hash_injector.js writes the same policy to both; a host or edge rule that rewrites
      // one of them would leave the browser enforcing a policy nobody reviewed.
      expect(readMetaCsp(await response.text()), `${page}: meta CSP`).toBe(headerCsp);
    }
  });

  test('assets, the worker, the 404 page and redirects keep the security headers', async ({ request }) => {
    const notFound = await fetchRaw(request, '/this-route-does-not-exist');
    expect(notFound.status()).toBe(404);
    expectGlobalHeaders(notFound, '404 page');
    expectStrictCsp(notFound.headers()['content-security-policy'], '404 page');

    const worker = await fetchRaw(request, '/sw.js');
    expect(worker.status()).toBe(200);
    expectGlobalHeaders(worker, '/sw.js');

    const manifest = await fetchRaw(request, '/manifest.json');
    expect(manifest.status()).toBe(200);
    expectGlobalHeaders(manifest, '/manifest.json');

    // A retired route from _redirects, and a trailing slash the host drops (html_handling).
    const retired = await fetchRaw(request, '/game');
    expect(retired.status()).toBe(301);
    expect(retired.headers()['location']).toBe('/arcade?mode=simulator');
    expectGlobalHeaders(retired, '/game redirect');

    const trailing = await fetchRaw(request, '/about/');
    expect([301, 307, 308]).toContain(trailing.status());
    expect(new URL(trailing.headers()['location'] ?? '', 'https://host.invalid').pathname).toBe('/about');
    expectGlobalHeaders(trailing, '/about/ redirect');
  });

  test('the browser applies the Permissions-Policy the features need', async ({ page }) => {
    // The header must leave the scanner its camera and the Location form its position, and turn
    // the rest off, as the browser reads it on the live site (not only as text in _headers).
    await page.goto('/');
    const allowed = await page.evaluate(() => {
      const policy = (document as Document & { featurePolicy?: { allowsFeature: (feature: string) => boolean } }).featurePolicy;
      if (!policy) return null;
      return Object.fromEntries(['camera', 'geolocation', 'microphone', 'payment'].map((feature) => [feature, policy.allowsFeature(feature)]));
    });
    test.skip(allowed === null, 'This browser does not expose document.featurePolicy');
    expect(allowed).toEqual({ camera: true, geolocation: true, microphone: false, payment: false });
  });

  test('only preview hosts ask search engines not to index them', async ({ request, baseURL }) => {
    const robots = (await fetchRaw(request, '/')).headers()['x-robots-tag'];
    if (new URL(baseURL ?? '').hostname.endsWith('.workers.dev')) {
      expect(robots).toBe('noindex');
    } else {
      expect(robots).toBeUndefined();
    }
  });

  test('serves the build it reports, with the shell the service worker precaches unchanged', async ({ request }) => {
    const versionResponse = await fetchRaw(request, '/version.json');
    // The deploy checks poll this file, so no cache may hold an old copy (#1217).
    expect(versionResponse.headers()['cache-control'], '/version.json Cache-Control').toBe('no-store');
    const info = (await versionResponse.json()) as { commit?: string; version?: string };
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    if (process.env.EXPECTED_COMMIT) expect(info.commit).toBe(process.env.EXPECTED_COMMIT);
    if (process.env.EXPECTED_VERSION) expect(info.version).toBe(process.env.EXPECTED_VERSION);

    // sw.js lists every precached file with the first 8 hex digits of its SHA-256 at build time
    // (#1261). Each one must still be served byte for byte; anything else means production has
    // drifted from the build Workers Builds deployed.
    const worker = await (await fetchRaw(request, '/sw.js')).text();
    const start = worker.indexOf('const PRECACHE_ASSETS = ');
    expect(start, 'sw.js precache manifest').toBeGreaterThan(-1);
    const listStart = worker.indexOf('[', start);
    const listEnd = worker.indexOf('];', listStart);
    const assets = JSON.parse(worker.slice(listStart, listEnd + 1)) as Array<{ url: string; revision: string }>;
    expect(assets.length).toBeGreaterThan(10);

    const drifted: string[] = [];
    for (const asset of assets) {
      const response = await fetchRaw(request, asset.url);
      const digest = crypto.createHash('sha256').update(await response.body()).digest('hex').slice(0, 8);
      if (response.status() !== 200 || digest !== asset.revision) {
        drifted.push(`${asset.url}: status ${response.status()}, sha256 ${digest}, expected ${asset.revision}`);
      }
    }
    expect(drifted).toEqual([]);
  });
});
