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

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkScriptUrl } from '../trustedTypes';

const ORIGIN = 'https://qrcraftly.com';

describe('checkScriptUrl (#1172)', () => {
  it.each([
    '/sw.js',
    '/assets/worker-matrix-abc123.js',
    'https://qrcraftly.com/assets/worker.js',
    'assets/relative.js',
  ])('accepts the same-origin URL %s unchanged', (input) => {
    expect(checkScriptUrl(input, ORIGIN)).toBe(input);
  });

  it.each([
    'https://evil.example/worker.js',
    '//evil.example/worker.js',
    'http://qrcraftly.com/assets/worker.js',
    'https://qrcraftly.com:8443/assets/worker.js',
    'data:text/javascript,postMessage(1)',
  ])('throws for %s, which is from another origin', (input) => {
    expect(() => checkScriptUrl(input, ORIGIN)).toThrow(TypeError);
  });

  it('throws for a URL it cannot parse', () => {
    expect(() => checkScriptUrl('https://[', ORIGIN)).toThrow(/unparsable/);
  });
});

describe('Trusted Types policies (#1172)', () => {
  interface PolicyOptions {
    createScriptURL?: (input: string) => string;
    createHTML?: (input: string) => string;
  }
  let created: Map<string, PolicyOptions>;

  /** A stand-in for the browser factory: it records each policy and wraps HTML in a marker. */
  const stubFactory = () => {
    created = new Map();
    vi.stubGlobal('trustedTypes', {
      createPolicy: (name: string, options: PolicyOptions) => {
        if (created.has(name)) throw new TypeError(`Policy ${name} already exists`);
        created.set(name, options);
        return { createHTML: (input: string) => ({ trusted: options.createHTML?.(input) }) };
      },
    });
  };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a same-origin default script URL policy and the qrcraftly HTML policy, once', async () => {
    stubFactory();
    const { installTrustedTypesPolicies } = await import('../trustedTypes');
    installTrustedTypesPolicies();
    installTrustedTypesPolicies();

    expect([...created.keys()]).toEqual(['default', 'qrcraftly']);
    const defaultPolicy = created.get('default');
    expect(defaultPolicy?.createHTML).toBeUndefined();
    expect(defaultPolicy?.createScriptURL?.('/sw.js')).toBe('/sw.js');
    expect(() => defaultPolicy?.createScriptURL?.('https://evil.example/sw.js')).toThrow(TypeError);
    expect(created.get('qrcraftly')?.createScriptURL).toBeUndefined();
  });

  it('marks reviewed HTML through the qrcraftly policy', async () => {
    stubFactory();
    const { reviewedHtml } = await import('../trustedTypes');
    expect(reviewedHtml('<p>Docs</p>')).toEqual({ trusted: '<p>Docs</p>' });
  });

  it('hands strings back unchanged in a browser without Trusted Types', async () => {
    const { reviewedHtml, installTrustedTypesPolicies } = await import('../trustedTypes');
    expect(() => installTrustedTypesPolicies()).not.toThrow();
    expect(reviewedHtml('<p>Docs</p>')).toBe('<p>Docs</p>');
  });

  it('warns rather than throws when the policies already exist, as after a dev hot reload', async () => {
    stubFactory();
    created.set('default', {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { installTrustedTypesPolicies } = await import('../trustedTypes');
    expect(() => installTrustedTypesPolicies()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('parses markup into an inert document', async () => {
    const { parseInertDocument } = await import('../trustedTypes');
    const doc = parseInertDocument('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>', 'image/svg+xml');
    expect(doc.documentElement.localName).toBe('svg');
    expect(doc.getElementsByTagName('rect')).toHaveLength(1);
  });
});
